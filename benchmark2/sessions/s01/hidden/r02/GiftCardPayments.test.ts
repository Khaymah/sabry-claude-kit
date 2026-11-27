import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
});

const Issue = async (Amount: string, Token = A.Token) => (await Call("POST", "/GiftCards", { Token, Body: { Amount } })).Body.Data.Code as string;
const Pay = (OrderId: number, Amount: string, GiftCardCode: string, Token = A.Token) =>
  Call("POST", "/Payments", { Token, Body: { OrderId, Amount, Method: "GiftCard", GiftCardCode } });
const Balance = async (Code: string) => (await Call("GET", `/GiftCards/${Code}`, { Token: A.Token })).Body.Data.Balance;

test("r02: paying with a gift card spends its balance", async () => {
  const Code = await Issue("100.00");
  const OrderId = await NewOrder(A.CompanyId, Customer, "60.00");
  const Res = await Pay(OrderId, "60.00", Code);
  expect(Res.Status).toBe(201);
  expect(await Balance(Code)).toBe("40.00");
  const [O] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  expect(O.Status).toBe("Paid");
});

test("r02: a card without enough balance is refused and nothing is recorded", async () => {
  const Code = await Issue("30.00");
  const OrderId = await NewOrder(A.CompanyId, Customer, "60.00");
  const Res = await Pay(OrderId, "60.00", Code);
  expect(Res.Status).toBe(409);
  expect(Res.Body.Error.Code).toBe("INSUFFICIENT_BALANCE");
  expect(await Balance(Code)).toBe("30.00");
  const [C] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Payments"`);
  expect(C.N).toBe(0);
});

test("r02: simultaneous payments never overdraw a card", async () => {
  const Code = await Issue("100.00");
  const Orders = [await NewOrder(A.CompanyId, Customer, "40.00"), await NewOrder(A.CompanyId, Customer, "40.00"), await NewOrder(A.CompanyId, Customer, "40.00")];
  const Results = await Promise.all(Orders.map((Id) => Pay(Id, "40.00", Code)));
  expect(Results.filter((R) => R.Status === 201).length).toBe(2);
  expect(await Balance(Code)).toBe("20.00");
  const [S] = await Sql<{ S: string }>(`SELECT coalesce(sum("Amount"),0)::text AS "S" FROM "Payments"`);
  expect(S.S).toBe("80.00");
});

test("r02: another shop's card cannot pay", async () => {
  const B = await NewCompany();
  const Code = await Issue("100.00", B.Token);
  const OrderId = await NewOrder(A.CompanyId, Customer, "10.00");
  expect((await Pay(OrderId, "10.00", Code)).Status).toBe(404);
  expect((await Call("GET", `/GiftCards/${Code}`, { Token: B.Token })).Body.Data.Balance).toBe("100.00");
});
