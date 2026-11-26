import { beforeEach, expect, test } from "bun:test";
import { Adjust, Created, NewCompany, NewProduct, NewWarehouse, Put, Qty, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let W1: number;
let W2: number;
let P: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  W1 = await NewWarehouse(A.Token);
  W2 = await NewWarehouse(A.Token);
  P = await NewProduct(A.CompanyId);
});

test("r02: adjustments move one branch's quantity and never below zero", async () => {
  const In = await Adjust(A.Token, W1, P, 10, "وارد");
  expect(Created(In.Status)).toBe(true);
  expect(Number(In.Body.Data.Quantity)).toBe(10);
  const Out = await Adjust(A.Token, W1, P, -3, "تالف");
  expect(Created(Out.Status)).toBe(true);
  expect(Number(Out.Body.Data.Quantity)).toBe(7);
  expect(await Qty(A.Token, W1, P)).toBe(7);
  expect(await Qty(A.Token, W2, P)).toBe(0);
  expect((await Adjust(A.Token, W1, P, -8)).Status).toBe(409);
  expect((await Adjust(A.Token, W2, P, -1)).Status).toBe(409);
  expect(await Qty(A.Token, W1, P)).toBe(7);
  expect(await Qty(A.Token, W2, P)).toBe(0);
});

test("r02: a double click on a write-off applies it once", async () => {
  await Put(A.Token, W1, P, 8);
  const Results = await Promise.all([Adjust(A.Token, W1, P, -5), Adjust(A.Token, W1, P, -5), Adjust(A.Token, W1, P, -5)]);
  expect(Results.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Results.filter((R) => R.Status === 409).length).toBe(2);
  expect(await Qty(A.Token, W1, P)).toBe(3);
});

test("r02: bad quantities and ids are refused without a server error", async () => {
  await Put(A.Token, W1, P, 4);
  for (const Change of [0, 1.5, 1e12, -1e12]) {
    const Res = await Adjust(A.Token, W1, P, Change as any);
    expect([400, 409]).toContain(Res.Status);
  }
  for (const ProductId of [1e12, -1, 0, "x"]) {
    const Res = await Adjust(A.Token, W1, ProductId as any, 1);
    expect([400, 404]).toContain(Res.Status);
  }
  expect(await Qty(A.Token, W1, P)).toBe(4);
});

test("r02: another company's branch or product is not found", async () => {
  const B = await NewCompany();
  const BW = await NewWarehouse(B.Token);
  const BP = await NewProduct(B.CompanyId);
  expect((await Adjust(A.Token, W1, BP, 5)).Status).toBe(404);
  expect((await Adjust(A.Token, BW, P, 5)).Status).toBe(404);
  expect((await Adjust(B.Token, W1, P, 5)).Status).toBe(404);
  expect(await Qty(A.Token, W1, P)).toBe(0);
  expect(await Qty(B.Token, BW, BP)).toBe(0);
});
