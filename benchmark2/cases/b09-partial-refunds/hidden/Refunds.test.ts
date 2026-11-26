import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
});

async function PaidOrder(Amounts: string[], Total?: string) {
  const OrderId = await NewOrder(A.CompanyId, Customer, Total ?? Amounts.reduce((S, V) => S + Math.round(Number(V) * 100), 0) / 100 + "");
  const Payments: number[] = [];
  for (const Amount of Amounts) {
    const Res = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount, Method: "Card" } });
    expect(Res.Status).toBe(201);
    Payments.push(Res.Body.Data.Id);
  }
  return { OrderId, Payments };
}

function Refund(PaymentId: number, Amount: unknown, Token = A.Token) {
  return Call("POST", `/Payments/${PaymentId}/Refunds`, { Token, Body: { Amount, Reason: "مرتجع" } });
}

async function Summary(PaymentId: number) {
  const Res = await Call("GET", `/Payments/${PaymentId}/Refunds`, { Token: A.Token });
  expect(Res.Status).toBe(200);
  return Res.Body.Data;
}

async function Status(OrderId: number) {
  const [Row] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  return Row.Status;
}

test("partial refunds add up to the piaster", async () => {
  const { OrderId, Payments } = await PaidOrder(["100.00"]);
  for (let I = 0; I < 3; I++) expect((await Refund(Payments[0], "33.33")).Status).toBe(201);
  let S = await Summary(Payments[0]);
  expect(S.RefundedAmount).toBe("99.99");
  expect(S.RefundableAmount).toBe("0.01");
  expect(S.Items.length).toBe(3);
  expect(await Status(OrderId)).toBe("Paid");
  const Over = await Refund(Payments[0], "0.02");
  expect(Over.Status).toBe(409);
  expect((await Refund(Payments[0], "0.01")).Status).toBe(201);
  S = await Summary(Payments[0]);
  expect(S.RefundedAmount).toBe("100.00");
  expect(S.RefundableAmount).toBe("0.00");
  expect(await Status(OrderId)).toBe("Refunded");
  expect((await Refund(Payments[0], "0.01")).Status).toBe(409);
});

test("invalid refund amounts are rejected without side effects", async () => {
  const { Payments } = await PaidOrder(["50.00"]);
  for (const Bad of ["10.005", "-5.00", "0", "0.00", "abc", "", 0.1 + 0.2, "1e1", null]) {
    const Res = await Refund(Payments[0], Bad);
    expect(Res.Status).toBe(400);
  }
  expect((await Summary(Payments[0])).RefundedAmount).toBe("0.00");
  const Ok = await Refund(Payments[0], "10.5");
  expect(Ok.Status).toBe(201);
  expect((await Summary(Payments[0])).RefundedAmount).toBe("10.50");
});

test("concurrent refunds cannot exceed the payment", async () => {
  const { Payments } = await PaidOrder(["100.00"]);
  const Results = await Promise.all(Array.from({ length: 10 }, () => Refund(Payments[0], "15.00")));
  expect(Results.filter((R) => R.Status === 201).length).toBe(6);
  expect(Results.filter((R) => R.Status === 409).length).toBe(4);
  const S = await Summary(Payments[0]);
  expect(S.RefundedAmount).toBe("90.00");
  expect(S.RefundableAmount).toBe("10.00");
  const [Row] = await Sql<{ Sum: string }>(`SELECT coalesce(sum("Amount"),0)::text AS "Sum" FROM "Refunds"`);
  expect(Row.Sum).toBe("90.00");
});

test("an order is refunded only when every payment on it is fully refunded", async () => {
  const { OrderId, Payments } = await PaidOrder(["60.00", "54.00"]);
  expect(await Status(OrderId)).toBe("Paid");
  expect((await Refund(Payments[0], "60.00")).Status).toBe(201);
  expect(await Status(OrderId)).toBe("Paid");
  expect((await Refund(Payments[1], "53.99")).Status).toBe(201);
  expect(await Status(OrderId)).toBe("Paid");
  expect((await Refund(Payments[1], "0.01")).Status).toBe(201);
  expect(await Status(OrderId)).toBe("Refunded");
});

test("another company's payment cannot be refunded or inspected", async () => {
  const { Payments } = await PaidOrder(["20.00"]);
  const B = await NewCompany();
  expect((await Refund(Payments[0], "5.00", B.Token)).Status).toBe(404);
  expect((await Call("GET", `/Payments/${Payments[0]}/Refunds`, { Token: B.Token })).Status).toBe(404);
  expect((await Summary(Payments[0])).RefundedAmount).toBe("0.00");
});
