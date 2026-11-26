import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

function Typed(Code: string) {
  const Lower = Code.toLowerCase();
  return ` ${Lower.slice(0, 4)}-${Lower.slice(4, 8)} ${Lower.slice(8)} `;
}

test("r05: codes typed in lower case with dashes or spaces still work", async () => {
  const Code = (await Call("POST", "/GiftCards", { Token: A.Token, Body: { Amount: "80.00" } })).Body.Data.Code;
  const Read = await Call("GET", `/GiftCards/${encodeURIComponent(Typed(Code))}`, { Token: A.Token });
  expect(Read.Status).toBe(200);
  expect(Read.Body.Data.Balance).toBe("80.00");
  const Customer = await NewCustomer(A.CompanyId);
  const OrderId = await NewOrder(A.CompanyId, Customer, "30.00");
  const Pay = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "30.00", Method: "GiftCard", GiftCardCode: Typed(Code) } });
  expect(Pay.Status).toBe(201);
  expect((await Call("GET", `/GiftCards/${Code}`, { Token: A.Token })).Body.Data.Balance).toBe("50.00");
});

test("r05: a mistyped code is still not found", async () => {
  const Code: string = (await Call("POST", "/GiftCards", { Token: A.Token, Body: { Amount: "80.00" } })).Body.Data.Code;
  const Wrong = (Code[0] === "A" ? "B" : "A") + Code.slice(1);
  expect((await Call("GET", `/GiftCards/${Wrong}`, { Token: A.Token })).Status).toBe(404);
});
