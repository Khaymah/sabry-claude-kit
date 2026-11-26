import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers, OrderItems, Orders, Products } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, PercentOf, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";
import { GetSetting } from "../Settings/Settings.Service";

type OrderInput = { CustomerId: number; Items: { ProductId: number; Quantity: number; DiscountPercent?: number }[] };

export async function CreateOrder(CompanyId: number, Input: OrderInput) {
  const TaxPercent = await GetSetting<number>("Tax.RatePercent", 14);
  return Db.transaction(async (Tx) => {
    const [Customer] = await Tx.select({ Id: Customers.Id })
      .from(Customers)
      .where(and(eq(Customers.Id, Input.CustomerId), eq(Customers.CompanyId, CompanyId)));
    if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");

    const Lines: { ProductId: number; Quantity: number; UnitPrice: number; LineTotal: number }[] = [];
    let Subtotal = 0;
    let Discount = 0;
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
      const Gross = UnitPrice * Item.Quantity;
      const LineDiscount = PercentOf(Gross, Item.DiscountPercent ?? 0);
      Subtotal += Gross;
      Discount += LineDiscount;
      Lines.push({ ProductId: Item.ProductId, Quantity: Item.Quantity, UnitPrice, LineTotal: Gross - LineDiscount });
    }

    const Tax = PercentOf(Subtotal - Discount, TaxPercent);
    const [Order] = await Tx.insert(Orders)
      .values({
        CompanyId,
        CustomerId: Input.CustomerId,
        Subtotal: FromPiasters(Subtotal),
        Discount: FromPiasters(Discount),
        Tax: FromPiasters(Tax),
        Total: FromPiasters(Subtotal - Discount + Tax),
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
