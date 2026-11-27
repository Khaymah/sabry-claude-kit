import { and, asc, eq } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Orders, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

function Share(Cumulative: number, Tax: number, Total: number) {
  return Total === 0 ? 0 : Math.floor((Cumulative * Tax * 2 + Total) / (2 * Total));
}

async function Breakdown(CompanyId: number, OrderId: number) {
  const [Order] = await Db.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  const Rows = await Db.select().from(Payments).where(and(eq(Payments.OrderId, OrderId), eq(Payments.Status, "Completed"))).orderBy(asc(Payments.Id));
  const Total = ToPiasters(Order.Total);
  const Tax = ToPiasters(Order.Tax);
  let Cumulative = 0;
  const Lines = Rows.map((P) => {
    const Before = Share(Cumulative, Tax, Total);
    Cumulative += ToPiasters(P.Amount);
    const Vat = Share(Cumulative, Tax, Total) - Before;
    return { PaymentId: P.Id, Amount: P.Amount, Method: P.Method, VatAmount: FromPiasters(Vat), NetAmount: FromPiasters(ToPiasters(P.Amount) - Vat), CreatedAt: P.CreatedAt };
  });
  return { Order, Lines, Paid: Cumulative, Total };
}

export async function GetReceipt(CompanyId: number, PaymentId: number) {
  const [Payment] = await Db.select().from(Payments).where(and(eq(Payments.Id, PaymentId), eq(Payments.CompanyId, CompanyId)));
  if (!Payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
  const { Order, Lines } = await Breakdown(CompanyId, Payment.OrderId);
  const Line = Lines.find((L) => L.PaymentId === PaymentId);
  if (!Line) throw new AppError(404, "NOT_FOUND", "Payment not found");
  return { ...Line, OrderId: Order.Id };
}

export async function GetInvoice(CompanyId: number, OrderId: number) {
  const { Order, Lines, Paid, Total } = await Breakdown(CompanyId, OrderId);
  return {
    OrderId: Order.Id,
    Subtotal: Order.Subtotal,
    Discount: Order.Discount,
    Tax: Order.Tax,
    Total: Order.Total,
    Payments: Lines,
    Balance: FromPiasters(Total - Paid),
  };
}
