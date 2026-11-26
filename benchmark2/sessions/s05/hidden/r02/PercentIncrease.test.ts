import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, PriceOf, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

const Increase = (Body: unknown, Token = A.Token) => Call("POST", "/Products/Prices/Increase", { Token, Body });

test("r02: a percentage increase rounds each price to the piaster, half up", async () => {
  const P1 = await NewProduct(A.CompanyId, { Price: "10.05" });
  const P2 = await NewProduct(A.CompanyId, { Price: "19.99" });
  const P3 = await NewProduct(A.CompanyId, { Price: "0.35" });
  const Res = await Increase({ Percent: 10 });
  expect(Res.Status).toBe(200);
  expect([await PriceOf(P1), await PriceOf(P2), await PriceOf(P3)]).toEqual(["11.06", "21.99", "0.39"]);
});

test("r02: a decrease and a chosen subset work too", async () => {
  const P1 = await NewProduct(A.CompanyId, { Price: "10.05" });
  const P2 = await NewProduct(A.CompanyId, { Price: "100.00" });
  expect((await Increase({ Percent: -12.5, ProductIds: [P1] })).Status).toBe(200);
  expect([await PriceOf(P1), await PriceOf(P2)]).toEqual(["8.79", "100.00"]);
});

test("r02: other shops' products are never touched", async () => {
  const Mine = await NewProduct(A.CompanyId, { Price: "10.00" });
  const B = await NewCompany();
  const Theirs = await NewProduct(B.CompanyId, { Price: "10.00" });
  expect((await Increase({ Percent: 20 })).Status).toBe(200);
  expect([await PriceOf(Mine), await PriceOf(Theirs)]).toEqual(["12.00", "10.00"]);
  expect([404, 400]).toContain((await Increase({ Percent: 20, ProductIds: [Mine, Theirs] })).Status);
  expect([await PriceOf(Mine), await PriceOf(Theirs)]).toEqual(["12.00", "10.00"]);
});
