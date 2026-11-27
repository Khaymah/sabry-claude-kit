import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Customers, OrderItems, Orders, Payments, Products } from "../../Database/Schema";
import { RecordAudit } from "../../Lib/Audit";
import { ScopedBranch, type AuthContext } from "../../Middleware/Auth";
import { BranchForWrite } from "../Branches/Branches.Service";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";
import { GetSetting } from "../Settings/Settings.Service";

type OrderInput = { CustomerId: number; BranchId?: number; Items: { ProductId: number; Quantity: number }[] };

export function OrderScope(Auth: AuthContext, Id?: number) {
  const Own = ScopedBranch(Auth);
  return and(
    eq(Orders.CompanyId, Auth.CompanyId),
    Id === undefined ? undefined : eq(Orders.Id, Id),
    Own === null ? undefined : eq(Orders.BranchId, Own),
  );
}

export async function LockOrder(Tx: Transaction, Auth: AuthContext, Id: number) {
  const [Order] = await Tx.select().from(Orders).where(OrderScope(Auth, Id)).for("update");
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  return Order;
}

export async function CreateOrder(Auth: AuthContext, Input: OrderInput) {
  const CompanyId = Auth.CompanyId;
  const TaxPercent = await GetSetting<number>("Tax.RatePercent", 14);
  return Db.transaction(async (Tx) => {
    const BranchId = await BranchForWrite(Auth, Input.BranchId, Tx);
    const [Customer] = await Tx.select({ Id: Customers.Id })
      .from(Customers)
      .where(and(eq(Customers.Id, Input.CustomerId), eq(Customers.CompanyId, CompanyId)));
    if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");

    const Lines: { ProductId: number; Quantity: number; UnitPrice: number; LineTotal: number }[] = [];
    for (const Item of Input.Items) {
      const [Product] = await Tx.update(Products)
        .set({ Stock: sql`${Products.Stock} - ${Item.Quantity}` })
        .where(
          and(
            eq(Products.Id, Item.ProductId),
            eq(Products.CompanyId, CompanyId),
            eq(Products.IsActive, true),
            sql`${Products.Stock} >= ${Item.Quantity}`,
          ),
        )
        .returning({ Price: Products.Price });
      if (!Product) {
        const [Exists] = await Tx.select({ Id: Products.Id })
          .from(Products)
          .where(and(eq(Products.Id, Item.ProductId), eq(Products.CompanyId, CompanyId), eq(Products.IsActive, true)));
        if (!Exists) throw new AppError(404, "NOT_FOUND", `Product ${Item.ProductId} not found`);
        throw new AppError(409, "OUT_OF_STOCK", `Product ${Item.ProductId} is out of stock`);
      }
      const UnitPrice = ToPiasters(Product.Price);
      Lines.push({ ProductId: Item.ProductId, Quantity: Item.Quantity, UnitPrice, LineTotal: UnitPrice * Item.Quantity });
    }

    const Subtotal = Lines.reduce((Sum, L) => Sum + L.LineTotal, 0);
    const Tax = Math.round((Subtotal * TaxPercent) / 100);
    const [Order] = await Tx.insert(Orders)
      .values({
        CompanyId,
        BranchId,
        CustomerId: Input.CustomerId,
        Subtotal: FromPiasters(Subtotal),
        Tax: FromPiasters(Tax),
        Total: FromPiasters(Subtotal + Tax),
      })
      .returning();
    const Items = await Tx.insert(OrderItems)
      .values(
        Lines.map((L) => ({
          OrderId: Order.Id,
          ProductId: L.ProductId,
          Quantity: L.Quantity,
          UnitPrice: FromPiasters(L.UnitPrice),
          LineTotal: FromPiasters(L.LineTotal),
        })),
      )
      .returning();
    await RecordAudit({ CompanyId, UserId: Auth.UserId, Action: "Order.Create", Entity: "Order", EntityId: Order.Id, BranchId }, Tx);
    return { ...Order, Items };
  });
}

export async function GetOrder(Auth: AuthContext, Id: number) {
  const [Row] = await Db.select({ Order: Orders, Customer: { Id: Customers.Id, Name: Customers.Name } })
    .from(Orders)
    .innerJoin(Customers, eq(Customers.Id, Orders.CustomerId))
    .where(OrderScope(Auth, Id));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Order not found");
  const Items = await Db.select().from(OrderItems).where(eq(OrderItems.OrderId, Id)).orderBy(OrderItems.Id);
  return { ...Row.Order, Customer: Row.Customer, Items };
}

export async function ListOrders(Auth: AuthContext, Page: number, PageSize: number) {
  const Where = OrderScope(Auth);
  const Rows = await Db.select({ Order: Orders, Customer: { Id: Customers.Id, Name: Customers.Name } })
    .from(Orders)
    .innerJoin(Customers, eq(Customers.Id, Orders.CustomerId))
    .where(Where)
    .orderBy(desc(Orders.CreatedAt), desc(Orders.Id))
    .limit(PageSize)
    .offset((Page - 1) * PageSize);
  const Ids = Rows.map((R) => R.Order.Id);
  const AllItems = Ids.length
    ? await Db.select().from(OrderItems).where(inArray(OrderItems.OrderId, Ids)).orderBy(OrderItems.Id)
    : [];
  const [{ Total }] = await Db.select({ Total: count() }).from(Orders).where(Where);
  const Items = Rows.map((R) => ({
    ...R.Order,
    Customer: R.Customer,
    Items: AllItems.filter((I) => I.OrderId === R.Order.Id),
  }));
  return { Items, ...PageMeta(Page, PageSize, Total) };
}

export async function CancelOrder(Auth: AuthContext, Id: number) {
  return Db.transaction(async (Tx) => {
    const Current = await LockOrder(Tx, Auth, Id);
    if (Current.Status !== "Pending") throw new AppError(409, "INVALID_STATUS", "Only pending orders can be cancelled");
    const [Order] = await Tx.update(Orders).set({ Status: "Cancelled" }).where(eq(Orders.Id, Id)).returning();
    const Items = await Tx.select().from(OrderItems).where(eq(OrderItems.OrderId, Id));
    for (const Item of Items) {
      await Tx.update(Products).set({ Stock: sql`${Products.Stock} + ${Item.Quantity}` }).where(eq(Products.Id, Item.ProductId));
    }
    await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "Order.Cancel", Entity: "Order", EntityId: Id, BranchId: Order.BranchId }, Tx);
    return Order;
  });
}

export async function PayOrder(Auth: AuthContext, Id: number, Method: string) {
  return Db.transaction(async (Tx) => {
    const Order = await LockOrder(Tx, Auth, Id);
    if (Order.Status !== "Pending") throw new AppError(409, "INVALID_STATUS", "Order is not awaiting payment");
    const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
      .from(Payments)
      .where(and(eq(Payments.OrderId, Order.Id), eq(Payments.Status, "Completed")));
    const Remaining = ToPiasters(Order.Total) - ToPiasters(Paid);
    const Payment = Remaining > 0
      ? (await Tx.insert(Payments).values({ CompanyId: Auth.CompanyId, OrderId: Order.Id, Amount: FromPiasters(Remaining), Method }).returning())[0]
      : null;
    const [Updated] = await Tx.update(Orders).set({ Status: "Paid" }).where(eq(Orders.Id, Order.Id)).returning();
    await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "Order.Pay", Entity: "Order", EntityId: Order.Id, BranchId: Order.BranchId }, Tx);
    return { Order: Updated, Payment };
  });
}
