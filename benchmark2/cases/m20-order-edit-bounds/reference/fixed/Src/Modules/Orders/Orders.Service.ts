import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers, OrderItems, Orders, Payments, Products } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";
import { GetSetting } from "../Settings/Settings.Service";

type OrderInput = { CustomerId: number; Items: { ProductId: number; Quantity: number }[] };

export async function CreateOrder(CompanyId: number, Input: OrderInput) {
  const TaxPercent = await GetSetting<number>("Tax.RatePercent", 14);
  return Db.transaction(async (Tx) => {
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
    return { ...Order, Items };
  });
}

export async function GetOrder(CompanyId: number, Id: number) {
  const [Row] = await Db.select({ Order: Orders, Customer: { Id: Customers.Id, Name: Customers.Name } })
    .from(Orders)
    .innerJoin(Customers, eq(Customers.Id, Orders.CustomerId))
    .where(and(eq(Orders.Id, Id), eq(Orders.CompanyId, CompanyId)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Order not found");
  const Items = await Db.select().from(OrderItems).where(eq(OrderItems.OrderId, Id)).orderBy(OrderItems.Id);
  return { ...Row.Order, Customer: Row.Customer, Items };
}

export async function ListOrders(CompanyId: number, Page: number, PageSize: number) {
  const Where = eq(Orders.CompanyId, CompanyId);
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

export async function CancelOrder(CompanyId: number, Id: number) {
  return Db.transaction(async (Tx) => {
    const [Order] = await Tx.update(Orders)
      .set({ Status: "Cancelled" })
      .where(and(eq(Orders.Id, Id), eq(Orders.CompanyId, CompanyId), eq(Orders.Status, "Pending")))
      .returning();
    if (!Order) {
      const [Exists] = await Tx.select({ Id: Orders.Id }).from(Orders).where(and(eq(Orders.Id, Id), eq(Orders.CompanyId, CompanyId)));
      if (!Exists) throw new AppError(404, "NOT_FOUND", "Order not found");
      throw new AppError(409, "INVALID_STATUS", "Only pending orders can be cancelled");
    }
    const Items = await Tx.select().from(OrderItems).where(eq(OrderItems.OrderId, Id));
    for (const Item of Items) {
      await Tx.update(Products).set({ Stock: sql`${Products.Stock} + ${Item.Quantity}` }).where(eq(Products.Id, Item.ProductId));
    }
    return Order;
  });
}

const MaxOrderTotal = 100_000_000;

export async function EditOrderItems(CompanyId: number, Id: number, Input: { Items: { ProductId: number; Quantity: number }[]; Note?: string }) {
  const TaxPercent = await GetSetting<number>("Tax.RatePercent", 14);
  await Db.transaction(async (Tx) => {
    const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, Id), eq(Orders.CompanyId, CompanyId)));
    if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
    const [Paid] = await Tx.select({ Id: Payments.Id }).from(Payments).where(eq(Payments.OrderId, Id)).limit(1);
    if (Order.Status !== "Pending" || Paid) throw new AppError(409, "INVALID_STATUS", "Only unpaid pending orders can be edited");
    const Current = await Tx.select().from(OrderItems).where(eq(OrderItems.OrderId, Id));
    const Ids = [...new Set([...Current.map((L) => L.ProductId), ...Input.Items.map((I) => I.ProductId)])];
    const Found = await Tx.select()
      .from(Products)
      .where(and(eq(Products.CompanyId, CompanyId), inArray(Products.Id, Ids)));
    const ById = new Map(Found.map((P) => [P.Id, P]));
    for (const Item of Input.Items) {
      const P = ById.get(Item.ProductId);
      if (!P || !P.IsActive) throw new AppError(404, "NOT_FOUND", `Product ${Item.ProductId} not found`);
    }
    const Lines = Input.Items.map((I) => {
      const UnitPrice = ToPiasters(ById.get(I.ProductId)!.Price);
      return { ProductId: I.ProductId, Quantity: I.Quantity, UnitPrice, LineTotal: UnitPrice * I.Quantity };
    });
    const Subtotal = Lines.reduce((S, L) => S + L.LineTotal, 0);
    const Tax = Math.round((Subtotal * TaxPercent) / 100);
    if (Subtotal + Tax > MaxOrderTotal) throw new AppError(422, "ORDER_TOO_LARGE", "Order total may not exceed 1,000,000.00");
    const Delta = new Map<number, number>();
    for (const L of Current) Delta.set(L.ProductId, (Delta.get(L.ProductId) ?? 0) - L.Quantity);
    for (const L of Lines) Delta.set(L.ProductId, (Delta.get(L.ProductId) ?? 0) + L.Quantity);
    for (const [ProductId, Change] of Delta) {
      if (Change === 0) continue;
      const [Ok] = await Tx.update(Products)
        .set({ Stock: sql`${Products.Stock} - ${Change}` })
        .where(and(eq(Products.Id, ProductId), sql`${Products.Stock} - ${Change} >= 0`))
        .returning({ Id: Products.Id });
      if (!Ok) throw new AppError(409, "OUT_OF_STOCK", `Product ${ProductId} is out of stock`);
    }
    await Tx.delete(OrderItems).where(eq(OrderItems.OrderId, Id));
    await Tx.insert(OrderItems).values(
      Lines.map((L) => ({ OrderId: Id, ProductId: L.ProductId, Quantity: L.Quantity, UnitPrice: FromPiasters(L.UnitPrice), LineTotal: FromPiasters(L.LineTotal) })),
    );
    await Tx.update(Orders)
      .set({ Subtotal: FromPiasters(Subtotal), Tax: FromPiasters(Tax), Total: FromPiasters(Subtotal + Tax), ...(Input.Note !== undefined ? { Note: Input.Note } : {}) })
      .where(eq(Orders.Id, Id));
  });
  return GetOrder(CompanyId, Id);
}
