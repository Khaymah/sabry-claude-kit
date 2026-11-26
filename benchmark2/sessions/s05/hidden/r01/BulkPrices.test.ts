import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, PriceOf, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let P: number[];

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  P = [];
  for (let I = 0; I < 5; I++) P.push(await NewProduct(A.CompanyId, { Price: "10.00" }));
});

const Bulk = (Items: unknown[], Token = A.Token) => Call("PATCH", "/Products/Prices", { Token, Body: { Items } });

test("r01: a price list updates every listed product", async () => {
  const Res = await Bulk([{ ProductId: P[0], Price: "11.50" }, { ProductId: P[2], Price: "9.99" }]);
  expect(Res.Status).toBe(200);
  expect(await Promise.all(P.map(PriceOf))).toEqual(["11.50", "10.00", "9.99", "10.00", "10.00"]);
});

test("r01: one unknown product on the third line changes nothing", async () => {
  const B = await NewCompany();
  const Foreign = await NewProduct(B.CompanyId, { Price: "77.00" });
  const Res = await Bulk([{ ProductId: P[0], Price: "1.00" }, { ProductId: P[1], Price: "2.00" }, { ProductId: Foreign, Price: "3.00" }, { ProductId: P[3], Price: "4.00" }]);
  expect(Res.Status).toBe(404);
  expect(await Promise.all(P.map(PriceOf))).toEqual(["10.00", "10.00", "10.00", "10.00", "10.00"]);
  expect(await PriceOf(Foreign)).toBe("77.00");
});

test("r01: one bad price changes nothing", async () => {
  const Res = await Bulk([{ ProductId: P[0], Price: "1.00" }, { ProductId: P[1], Price: "-2.00" }]);
  expect(Res.Status).toBe(400);
  expect(await PriceOf(P[0])).toBe("10.00");
});
