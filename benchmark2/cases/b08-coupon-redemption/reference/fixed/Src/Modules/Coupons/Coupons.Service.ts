import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Coupons, Orders, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, PercentOf, ToPiasters } from "../../Lib/Money";
import { GetSetting } from "../Settings/Settings.Service";

export async function CreateCoupon(CompanyId: number, Input: { Code: string; DiscountPercent: number; MaxUses: number; ExpiresAt?: string }) {
  const [Existing] = await Db.select({ Id: Coupons.Id }).from(Coupons).where(and(eq(Coupons.CompanyId, CompanyId), eq(Coupons.Code, Input.Code)));
  if (Existing) throw new AppError(409, "COUPON_EXISTS", "Coupon code already exists");
  const [Coupon] = await Db.insert(Coupons)
    .values({ CompanyId, Code: Input.Code, DiscountPercent: Input.DiscountPercent, MaxUses: Input.MaxUses, ExpiresAt: Input.ExpiresAt ? new Date(Input.ExpiresAt) : null })
    .returning();
  return Coupon;
}

export async function ApplyCoupon(CompanyId: number, OrderId: number, Code: string) {
  const TaxPercent = await GetSetting<number>("Tax.RatePercent", 14);
  return Db.transaction(async (Tx) => {
    const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
    if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
    const [Coupon] = await Tx.select().from(Coupons).where(and(eq(Coupons.CompanyId, CompanyId), eq(Coupons.Code, Code)));
    if (!Coupon) throw new AppError(404, "NOT_FOUND", "Coupon not found");
    if (Order.Status !== "Pending") throw new AppError(409, "INVALID_STATUS", "Order is not pending");
    if (Order.CouponId !== null) throw new AppError(409, "COUPON_ALREADY_APPLIED", "Order already has a coupon");
    const [HasPayment] = await Tx.select({ Id: Payments.Id }).from(Payments).where(eq(Payments.OrderId, OrderId)).limit(1);
    if (HasPayment) throw new AppError(409, "INVALID_STATUS", "Order already has payments");
    if (Coupon.ExpiresAt && Coupon.ExpiresAt.getTime() <= Now().getTime()) throw new AppError(409, "COUPON_EXPIRED", "Coupon expired");
    const [Used] = await Tx.update(Coupons)
      .set({ UsedCount: sql`${Coupons.UsedCount} + 1` })
      .where(and(eq(Coupons.Id, Coupon.Id), lt(Coupons.UsedCount, Coupons.MaxUses)))
      .returning({ Id: Coupons.Id });
    if (!Used) throw new AppError(409, "COUPON_EXHAUSTED", "Coupon has no uses left");
    const Subtotal = ToPiasters(Order.Subtotal);
    const Discount = PercentOf(Subtotal, Coupon.DiscountPercent);
    const Tax = PercentOf(Subtotal - Discount, TaxPercent);
    const [Updated] = await Tx.update(Orders)
      .set({ CouponId: Coupon.Id, Discount: FromPiasters(Discount), Tax: FromPiasters(Tax), Total: FromPiasters(Subtotal - Discount + Tax) })
      .where(and(eq(Orders.Id, OrderId), isNull(Orders.CouponId)))
      .returning();
    if (!Updated) throw new AppError(409, "COUPON_ALREADY_APPLIED", "Order already has a coupon");
    return Updated;
  });
}
