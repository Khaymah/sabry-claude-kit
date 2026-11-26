import { beforeEach, expect, test } from "bun:test";
import { Call, Cancel, Charge, Created, Credit, CreditOrder, NewCompany, NewCustomer, NewOrder, NewProduct, OrderStatus, Pay, Reset, SetLimit, Sql, Statement, WriteOff } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;
let Product: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
  Product = await NewProduct(A.CompanyId, { Price: "25.00", Stock: 10 });
  await SetLimit(A.Token, Customer, "500.00");
});

async function RealCreditOrder(Quantity: number) {
  const Res = await Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: Customer, Items: [{ ProductId: Product, Quantity }] } });
  expect(Res.Status).toBe(201);
  expect(Created).toContain((await Charge(A.Token, Res.Body.Data.Id)).Status);
  return { Id: Res.Body.Data.Id as number, Total: Res.Body.Data.Total as string };
}

const Stock = async () => (await Sql<{ Stock: number }>(`SELECT "Stock" FROM "Products" WHERE "Id" = $1`, [Product]))[0].Stock;

test("r07: returning an unpaid credit order cancels it, restores stock and removes the debt", async () => {
  const Kept = await RealCreditOrder(1);
  const Returned = await RealCreditOrder(4);
  expect(await Stock()).toBe(5);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "142.50" });
  const Res = await Cancel(A.Token, Returned.Id);
  expect(Res.Status).toBe(200);
  expect(await OrderStatus(Returned.Id)).toBe("Cancelled");
  expect(await Stock()).toBe(9);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: Kept.Total, Available: "471.50" });
  const Entries = (await Statement(A.Token, Customer)).Body.Data.Entries;
  const Last = Entries[Entries.length - 1];
  expect(Last).toMatchObject({ Type: "Cancellation", OrderId: Returned.Id, Balance: "28.50" });
  expect(Math.abs(Number(Last.Amount))).toBe(114);
  const PayRes = await Pay(A.Token, Customer, "28.50");
  expect(PayRes.Body.Data.Allocations).toEqual([{ OrderId: Kept.Id, Amount: "28.50" }]);
});

test("r07: a double-clicked return restores stock and debt once", async () => {
  const Order = await RealCreditOrder(2);
  const Results = await Promise.all([Cancel(A.Token, Order.Id), Cancel(A.Token, Order.Id)]);
  expect(Results.filter((R) => R.Status === 200).length).toBe(1);
  expect(Results.filter((R) => R.Status === 409).length).toBe(1);
  expect(await Stock()).toBe(10);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "0.00", Available: "500.00" });
  const Entries = (await Statement(A.Token, Customer)).Body.Data.Entries;
  expect(Entries.filter((E: any) => E.Type === "Cancellation").length).toBe(1);
});

test("r07: partly repaid or written-off credit orders are not returned, plain pending ones still are", async () => {
  const Partly = await RealCreditOrder(2);
  await Pay(A.Token, Customer, "10.00");
  expect((await Cancel(A.Token, Partly.Id)).Status).toBe(409);
  expect(await OrderStatus(Partly.Id)).toBe("OnCredit");
  const Lost = await RealCreditOrder(1);
  await WriteOff(A.Token, Lost.Id);
  expect((await Cancel(A.Token, Lost.Id)).Status).toBe(409);
  expect(await Stock()).toBe(7);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "47.00" });
  const B = await NewCompany();
  const Fresh = await RealCreditOrder(1);
  expect((await Cancel(B.Token, Fresh.Id)).Status).toBe(404);
  expect(await OrderStatus(Fresh.Id)).toBe("OnCredit");
  const Plain = await NewOrder(A.CompanyId, Customer, "10.00");
  expect((await Cancel(A.Token, Plain)).Status).toBe(200);
  expect(await OrderStatus(Plain)).toBe("Cancelled");
});
