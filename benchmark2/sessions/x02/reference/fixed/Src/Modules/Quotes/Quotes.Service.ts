import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { OrderItems, Orders, Products, QuoteLines, QuoteVersions, Quotes } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { AddDays, HalfUp, MaxPiasters, PiastersText, TextPiasters, Today } from "../../Lib/Sales";
import { GetSetting } from "../Settings/Settings.Service";
import { PricesOn, RequireCustomer } from "../PriceLists/PriceLists.Service";
import { ThresholdFor } from "../CustomerGroups/CustomerGroups.Service";
import { ValidityDays } from "../QuoteSettings/QuoteSettings.Service";
import type { AuthContext } from "../../Middleware/Auth";

type Executor = Transaction | typeof Db;
type ItemInput = { ProductId: number; Quantity: number; DiscountPercent?: number };
type QuoteRow = typeof Quotes.$inferSelect;

const Open = ["Draft", "PendingApproval", "Approved"];

export function EffectiveStatus(Quote: { Status: string; ValidUntil: string }, Day = Today()) {
  return Open.includes(Quote.Status) && Quote.ValidUntil < Day ? "Expired" : Quote.Status;
}

async function Price(Ex: Executor, CompanyId: number, CustomerId: number, Items: ItemInput[], TaxPercent: number) {
  const Ids = [...new Set(Items.map((I) => I.ProductId))];
  const Rows = await PricesOn(Ex, CompanyId, CustomerId, Today(), Ids);
  const Map_ = new Map(Rows.map((R) => [Number(R.ProductId), TextPiasters(R.Price)]));
  if (Map_.size !== Ids.length) throw new AppError(404, "NOT_FOUND", "Product not found");
  const Lines = Items.map((I) => {
    const Unit = Map_.get(I.ProductId)!;
    const Bp = BigInt(Math.round((I.DiscountPercent ?? 0) * 100));
    const LineTotal = HalfUp(Unit * BigInt(I.Quantity) * (10000n - Bp), 10000n);
    return { ProductId: I.ProductId, Quantity: I.Quantity, DiscountPercent: PiastersText(Bp), UnitPrice: PiastersText(Unit), LineTotal };
  });
  const Subtotal = Lines.reduce((S, L) => S + L.LineTotal, 0n);
  const Tax = HalfUp(Subtotal * BigInt(Math.round(TaxPercent * 100)), 10000n);
  const Total = Subtotal + Tax;
  if (Total > MaxPiasters) throw new AppError(400, "VALIDATION_ERROR", "Quote total is too large");
  return {
    Lines: Lines.map((L) => ({ ...L, LineTotal: PiastersText(L.LineTotal) })),
    Subtotal: PiastersText(Subtotal),
    Tax: PiastersText(Tax),
    Total: PiastersText(Total),
  };
}

async function WriteVersion(Tx: Transaction, QuoteId: number, Version: number, Priced: Awaited<ReturnType<typeof Price>>) {
  const [Row] = await Tx.insert(QuoteVersions)
    .values({ QuoteId, Version, Subtotal: Priced.Subtotal, Tax: Priced.Tax, Total: Priced.Total, CreatedAt: Now() })
    .returning({ Id: QuoteVersions.Id });
  await Tx.insert(QuoteLines).values(Priced.Lines.map((L) => ({ QuoteVersionId: Row.Id, ...L })));
}

async function Lock(Tx: Transaction, CompanyId: number, Id: number) {
  const [Quote] = await Tx.select().from(Quotes).where(and(eq(Quotes.Id, Id), eq(Quotes.CompanyId, CompanyId))).for("update");
  if (!Quote) throw new AppError(404, "NOT_FOUND", "Quote not found");
  return Quote;
}

async function CurrentVersion(Ex: Executor, Quote: QuoteRow) {
  const [Version] = await Ex.select()
    .from(QuoteVersions)
    .where(and(eq(QuoteVersions.QuoteId, Quote.Id), eq(QuoteVersions.Version, Quote.Version)));
  const Lines = await Ex.select().from(QuoteLines).where(eq(QuoteLines.QuoteVersionId, Version.Id)).orderBy(asc(QuoteLines.Id));
  return { Version, Lines };
}

function LineView(L: typeof QuoteLines.$inferSelect) {
  return { ProductId: L.ProductId, Quantity: L.Quantity, DiscountPercent: L.DiscountPercent, UnitPrice: L.UnitPrice, LineTotal: L.LineTotal };
}

export async function GetQuote(CompanyId: number, Id: number) {
  const [Quote] = await Db.select().from(Quotes).where(and(eq(Quotes.Id, Id), eq(Quotes.CompanyId, CompanyId)));
  if (!Quote) throw new AppError(404, "NOT_FOUND", "Quote not found");
  const { Version, Lines } = await CurrentVersion(Db, Quote);
  return {
    Id: Quote.Id,
    CustomerId: Quote.CustomerId,
    SalespersonId: Quote.SalespersonId,
    Status: EffectiveStatus(Quote),
    Version: Quote.Version,
    ValidUntil: Quote.ValidUntil,
    ApprovedBy: Quote.ApprovedBy,
    OrderId: Quote.OrderId,
    Subtotal: Version.Subtotal,
    Tax: Version.Tax,
    Total: Version.Total,
    Items: Lines.map(LineView),
    CreatedAt: Quote.CreatedAt,
  };
}

export async function ListVersions(CompanyId: number, Id: number) {
  const [Quote] = await Db.select({ Id: Quotes.Id }).from(Quotes).where(and(eq(Quotes.Id, Id), eq(Quotes.CompanyId, CompanyId)));
  if (!Quote) throw new AppError(404, "NOT_FOUND", "Quote not found");
  const Versions = await Db.select().from(QuoteVersions).where(eq(QuoteVersions.QuoteId, Id)).orderBy(asc(QuoteVersions.Version));
  const Lines = Versions.length
    ? await Db.select().from(QuoteLines).where(inArray(QuoteLines.QuoteVersionId, Versions.map((V) => V.Id))).orderBy(asc(QuoteLines.Id))
    : [];
  return {
    Items: Versions.map((V) => ({
      Version: V.Version,
      Subtotal: V.Subtotal,
      Tax: V.Tax,
      Total: V.Total,
      CreatedAt: V.CreatedAt,
      Items: Lines.filter((L) => L.QuoteVersionId === V.Id).map(LineView),
    })),
  };
}

const TaxRate = () => GetSetting<number>("Tax.RatePercent", 14);

export async function CreateQuote(Auth: AuthContext, Input: { CustomerId: number; Items: ItemInput[] }) {
  const TaxPercent = await TaxRate();
  const Id = await Db.transaction(async (Tx) => {
    await RequireCustomer(Tx, Auth.CompanyId, Input.CustomerId);
    const Priced = await Price(Tx, Auth.CompanyId, Input.CustomerId, Input.Items, TaxPercent);
    const Days = await ValidityDays(Tx, Auth.CompanyId);
    const [Quote] = await Tx.insert(Quotes)
      .values({
        CompanyId: Auth.CompanyId,
        CustomerId: Input.CustomerId,
        SalespersonId: Auth.UserId,
        ValidUntil: AddDays(Today(), Days),
        CreatedAt: Now(),
      })
      .returning({ Id: Quotes.Id });
    await WriteVersion(Tx, Quote.Id, 1, Priced);
    return Quote.Id;
  });
  return GetQuote(Auth.CompanyId, Id);
}

export async function ReviseQuote(CompanyId: number, Id: number, Items: ItemInput[]) {
  const TaxPercent = await TaxRate();
  await Db.transaction(async (Tx) => {
    const Quote = await Lock(Tx, CompanyId, Id);
    if (EffectiveStatus(Quote) !== "Draft") throw new AppError(409, "INVALID_STATUS", "Only draft quotes can be revised");
    const Priced = await Price(Tx, CompanyId, Quote.CustomerId, Items, TaxPercent);
    const Days = await ValidityDays(Tx, CompanyId);
    await WriteVersion(Tx, Id, Quote.Version + 1, Priced);
    await Tx.update(Quotes).set({ Version: Quote.Version + 1, ValidUntil: AddDays(Today(), Days) }).where(eq(Quotes.Id, Id));
  });
  return GetQuote(CompanyId, Id);
}

export async function SubmitQuote(CompanyId: number, Id: number) {
  await Db.transaction(async (Tx) => {
    const Quote = await Lock(Tx, CompanyId, Id);
    if (EffectiveStatus(Quote) !== "Draft") throw new AppError(409, "INVALID_STATUS", "Only draft quotes can be submitted");
    const { Version } = await CurrentVersion(Tx, Quote);
    const Customer = await RequireCustomer(Tx, CompanyId, Quote.CustomerId);
    const Threshold = await ThresholdFor(Tx, CompanyId, Customer.GroupId);
    const NeedsApproval = TextPiasters(Version.Total) > TextPiasters(Threshold);
    await Tx.update(Quotes)
      .set(NeedsApproval ? { Status: "PendingApproval" } : { Status: "Approved", ApprovedAt: Now() })
      .where(eq(Quotes.Id, Id));
  });
  return GetQuote(CompanyId, Id);
}

export async function ApproveQuote(Auth: AuthContext, Id: number) {
  await Db.transaction(async (Tx) => {
    const Quote = await Lock(Tx, Auth.CompanyId, Id);
    if (Quote.SalespersonId === Auth.UserId) throw new AppError(403, "FORBIDDEN", "You cannot approve your own quote");
    if (EffectiveStatus(Quote) !== "PendingApproval") throw new AppError(409, "INVALID_STATUS", "Quote is not awaiting approval");
    await Tx.update(Quotes).set({ Status: "Approved", ApprovedBy: Auth.UserId, ApprovedAt: Now() }).where(eq(Quotes.Id, Id));
  });
  return GetQuote(Auth.CompanyId, Id);
}

export async function ConvertQuote(CompanyId: number, Id: number) {
  await Db.transaction(async (Tx) => {
    const Quote = await Lock(Tx, CompanyId, Id);
    if (EffectiveStatus(Quote) !== "Approved") throw new AppError(409, "INVALID_STATUS", "Only approved quotes can be converted");
    const { Version, Lines } = await CurrentVersion(Tx, Quote);
    for (const Line of Lines) {
      const [Moved] = await Tx.update(Products)
        .set({ Stock: sql`${Products.Stock} - ${Line.Quantity}` })
        .where(and(eq(Products.Id, Line.ProductId), eq(Products.CompanyId, CompanyId), sql`${Products.Stock} >= ${Line.Quantity}`))
        .returning({ Id: Products.Id });
      if (!Moved) throw new AppError(409, "OUT_OF_STOCK", `Product ${Line.ProductId} is out of stock`);
    }
    const [Order] = await Tx.insert(Orders)
      .values({ CompanyId, CustomerId: Quote.CustomerId, Subtotal: Version.Subtotal, Tax: Version.Tax, Total: Version.Total, CreatedAt: Now() })
      .returning({ Id: Orders.Id });
    await Tx.insert(OrderItems).values(
      Lines.map((L) => ({ OrderId: Order.Id, ProductId: L.ProductId, Quantity: L.Quantity, UnitPrice: L.UnitPrice, LineTotal: L.LineTotal })),
    );
    await Tx.update(Quotes).set({ Status: "Converted", OrderId: Order.Id }).where(eq(Quotes.Id, Id));
  });
  return GetQuote(CompanyId, Id);
}
