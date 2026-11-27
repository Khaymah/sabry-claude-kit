import { afterEach, beforeEach, expect, test } from "bun:test";
import { Call, InstallSms, NewCompany, NewCustomer, Reset, RestoreFetch, SmsCalls, SmsSettings, Sql } from "../_Support";

beforeEach(async () => {
  await Reset();
  await SmsSettings();
  InstallSms("ok");
});

afterEach(() => RestoreFetch());

async function OldOrder(CompanyId: number, CustomerId: number, Status = "Pending", DaysAgo = 5) {
  await Sql(
    `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total","CreatedAt") VALUES ($1,$2,$3,'10','1.40','11.40', now() - ($4 || ' days')::interval)`,
    [CompanyId, CustomerId, Status, String(DaysAgo)],
  );
}

test("r04: a shop's reminder run only texts its own customers", async () => {
  const A = await NewCompany();
  const B = await NewCompany();
  const Ca = await NewCustomer(A.CompanyId, { Phone: "01000000001" });
  const Cb = await NewCustomer(B.CompanyId, { Phone: "01000000002" });
  await OldOrder(A.CompanyId, Ca);
  await OldOrder(A.CompanyId, Ca);
  await OldOrder(B.CompanyId, Cb);
  await OldOrder(A.CompanyId, Ca, "Paid");
  await OldOrder(A.CompanyId, Ca, "Pending", 1);
  const Res = await Call("POST", "/Jobs/PaymentReminders", { Token: A.Token });
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Sent).toBe(2);
  expect(SmsCalls.map((C) => C.Body.To)).toEqual(["01000000001", "01000000001"]);
});
