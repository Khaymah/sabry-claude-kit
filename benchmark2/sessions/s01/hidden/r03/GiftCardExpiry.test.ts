import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
});

afterEach(() => {
  setSystemTime();
});

test("r03: a gift card expires one year after it is issued", async () => {
  const Start = Date.now();
  const Card = (await Call("POST", "/GiftCards", { Token: A.Token, Body: { Amount: "100.00" } })).Body.Data;
  const Expires = new Date((await Call("GET", `/GiftCards/${Card.Code}`, { Token: A.Token })).Body.Data.ExpiresAt).getTime();
  expect(Math.abs(Expires - (Start + 365 * 86400_000))).toBeLessThan(2 * 86400_000);
  const OrderId = await NewOrder(A.CompanyId, Customer, "10.00");
  setSystemTime(new Date(Start + 300 * 86400_000));
  const Early = await NewOrder(A.CompanyId, Customer, "5.00");
  expect((await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId: Early, Amount: "5.00", Method: "GiftCard", GiftCardCode: Card.Code } })).Status).toBe(201);
  setSystemTime(new Date(Start + 370 * 86400_000));
  const Late = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "10.00", Method: "GiftCard", GiftCardCode: Card.Code } });
  expect(Late.Status).toBe(409);
  expect(Late.Body.Error.Code).toBe("GIFT_CARD_EXPIRED");
});
