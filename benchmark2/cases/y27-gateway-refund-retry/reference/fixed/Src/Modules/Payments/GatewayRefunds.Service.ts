import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { Db } from "../../Database/Db";
import { GatewayRefunds, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { MoneyString } from "../Products/Products.Schema";
import { GetSetting } from "../Settings/Settings.Service";

export const GatewayRefundBody = z.object({ Amount: MoneyString });

const Sleep = (Ms: number) => new Promise((R) => setTimeout(R, Ms));

type Outcome = { Kind: "Ok"; Ref: string } | { Kind: "Rejected" } | { Kind: "Unknown" };

async function CallGateway(Key: string, ChargeId: string, Amount: number): Promise<Outcome> {
  const BaseUrl = await GetSetting<string>("Gateway.BaseUrl", "");
  const ApiKey = await GetSetting<string>("Gateway.ApiKey", "");
  const TimeoutMs = await GetSetting<number>("Gateway.TimeoutMs", 5000);
  const MaxAttempts = Math.max(1, await GetSetting<number>("Gateway.MaxAttempts", 3));
  const RetryDelayMs = await GetSetting<number>("Gateway.RetryDelayMs", 200);
  for (let Attempt = 1; Attempt <= MaxAttempts; Attempt++) {
    const Controller = new AbortController();
    const Timer = setTimeout(() => Controller.abort(), TimeoutMs);
    try {
      const Res = await fetch(`${BaseUrl.replace(/\/$/, "")}/v1/refunds`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ApiKey}`, "Idempotency-Key": Key, "Content-Type": "application/json" },
        body: JSON.stringify({ ChargeId, Amount }),
        signal: Controller.signal,
      });
      if (Res.ok) return { Kind: "Ok", Ref: String(((await Res.json()) as { Id: string }).Id) };
      if (Res.status !== 429 && Res.status < 500) return { Kind: "Rejected" };
    } catch {
    } finally {
      clearTimeout(Timer);
    }
    if (Attempt < MaxAttempts) await Sleep(RetryDelayMs * Attempt);
  }
  return { Kind: "Unknown" };
}

export async function RefundThroughGateway(CompanyId: number, PaymentId: number, AmountText: string) {
  const Amount = ToPiasters(AmountText);
  if (Amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  const Claim = await Db.transaction(async (Tx) => {
    const [Payment] = await Tx.select().from(Payments).where(and(eq(Payments.Id, PaymentId), eq(Payments.CompanyId, CompanyId)));
    if (!Payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
    if (Payment.Method !== "Card" || !Payment.ProviderRef) throw new AppError(409, "NOT_A_CARD_PAYMENT", "Only card payments are refunded through the gateway");
    const Rows = await Tx.select().from(GatewayRefunds).where(eq(GatewayRefunds.PaymentId, PaymentId));
    const Open = Rows.find((R) => R.Status === "InProgress" || R.Status === "Unknown");
    if (Open?.Status === "InProgress") throw new AppError(409, "REFUND_IN_PROGRESS", "A refund for this payment is in progress");
    if (Open && Open.Amount !== Amount) throw new AppError(409, "REFUND_PENDING", "A previous refund is still unconfirmed; retry it with the same amount");
    const Done = Rows.filter((R) => R.Status === "Succeeded").reduce((S, R) => S + R.Amount, 0);
    if (!Open && Amount > ToPiasters(Payment.Amount) - Done) throw new AppError(409, "REFUND_EXCEEDS_PAYMENT", "Amount exceeds the refundable balance");
    if (Open) {
      await Tx.update(GatewayRefunds).set({ Status: "InProgress" }).where(eq(GatewayRefunds.Id, Open.Id));
      return { Row: Open, Payment, Done };
    }
    const [Row] = await Tx.insert(GatewayRefunds).values({ CompanyId, PaymentId, Amount, IdempotencyKey: crypto.randomUUID(), Status: "InProgress" }).returning();
    return { Row, Payment, Done };
  });
  const Outcome = await CallGateway(Claim.Row.IdempotencyKey, Claim.Payment.ProviderRef!, Amount);
  if (Outcome.Kind === "Ok") {
    await Db.update(GatewayRefunds).set({ Status: "Succeeded", ProviderRef: Outcome.Ref }).where(eq(GatewayRefunds.Id, Claim.Row.Id));
    return { RefundId: Outcome.Ref, Amount: FromPiasters(Amount), RefundableAmount: FromPiasters(ToPiasters(Claim.Payment.Amount) - Claim.Done - Amount) };
  }
  if (Outcome.Kind === "Rejected") {
    await Db.update(GatewayRefunds).set({ Status: "Failed" }).where(eq(GatewayRefunds.Id, Claim.Row.Id));
    throw new AppError(502, "GATEWAY_REJECTED", "The gateway rejected the refund");
  }
  await Db.update(GatewayRefunds).set({ Status: "Unknown" }).where(eq(GatewayRefunds.Id, Claim.Row.Id));
  throw new AppError(504, "GATEWAY_TIMEOUT", "The gateway did not answer; the refund may still go through");
}
