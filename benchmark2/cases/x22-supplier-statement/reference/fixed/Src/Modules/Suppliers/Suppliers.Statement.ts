import { and, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { PurchaseOrders, SupplierPayments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { RecordAudit } from "../../Lib/Audit";
import { GetSupplier } from "./Suppliers.Service";

export async function PaySupplier(CompanyId: number, UserId: number, SupplierId: number, Input: { Amount: string; Method: string; Note?: string }) {
  if (ToPiasters(Input.Amount) <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  await GetSupplier(CompanyId, SupplierId);
  const [Payment] = await Db.insert(SupplierPayments)
    .values({ CompanyId, SupplierId, Amount: FromPiasters(ToPiasters(Input.Amount)), Method: Input.Method, Note: Input.Note })
    .returning();
  await RecordAudit({ CompanyId, UserId, Action: "Pay", Entity: "Supplier", EntityId: SupplierId });
  return Payment;
}

export async function SupplierStatement(CompanyId: number, SupplierId: number) {
  const Supplier = await GetSupplier(CompanyId, SupplierId);
  const Rows = await Db.execute<{ Type: string; Id: number; Amount: string; Date: Date }>(sql`
    SELECT 'Purchase' AS "Type", ${PurchaseOrders.Id} AS "Id", ${PurchaseOrders.Total}::text AS "Amount", ${PurchaseOrders.ReceivedAt} AS "Date"
    FROM ${PurchaseOrders}
    WHERE ${PurchaseOrders.CompanyId} = ${CompanyId} AND ${PurchaseOrders.SupplierId} = ${SupplierId} AND ${PurchaseOrders.Status} = 'Received'
    UNION ALL
    SELECT 'Payment', ${SupplierPayments.Id}, ${SupplierPayments.Amount}::text, ${SupplierPayments.PaidAt}
    FROM ${SupplierPayments}
    WHERE ${SupplierPayments.CompanyId} = ${CompanyId} AND ${SupplierPayments.SupplierId} = ${SupplierId}
    ORDER BY 4, 1 DESC, 2
  `);
  let Purchases = 0;
  let Paid = 0;
  const Entries = Rows.rows.map((R) => {
    if (R.Type === "Purchase") Purchases += ToPiasters(R.Amount);
    else Paid += ToPiasters(R.Amount);
    return { Type: R.Type, Id: R.Id, Amount: R.Amount, Date: new Date(R.Date).toISOString() };
  });
  return {
    Supplier: { Id: Supplier.Id, Name: Supplier.Name },
    TotalPurchases: FromPiasters(Purchases),
    TotalPaid: FromPiasters(Paid),
    Balance: FromPiasters(Purchases - Paid),
    Entries,
  };
}
