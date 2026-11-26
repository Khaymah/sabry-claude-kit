import { beforeEach, expect, test } from "bun:test";
import { Created, NewCompany, NewProduct, NewWarehouse, Put, Qty, Receive, Reset, SendOk, StockOf, Stocktake } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let W: number;
let Ps: number[];

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  W = await NewWarehouse(A.Token);
  Ps = [];
  for (let I = 0; I < 4; I++) {
    Ps.push(await NewProduct(A.CompanyId));
    await Put(A.Token, W, Ps[I], 10 + I);
  }
});

test("r05: counted quantities replace the branch stock and the rest stays", async () => {
  const Res = await Stocktake(A.Token, W, [
    { ProductId: Ps[0], Counted: 7 },
    { ProductId: Ps[1], Counted: 0 },
    { ProductId: Ps[2], Counted: 15 },
  ]);
  expect(Created(Res.Status)).toBe(true);
  const Lines = Res.Body.Data.Lines;
  const Line = (P: number) => Lines.find((L: any) => L.ProductId === P);
  expect(Line(Ps[0])).toMatchObject({ Before: 10, Counted: 7, Difference: -3 });
  expect(Line(Ps[1])).toMatchObject({ Before: 11, Counted: 0, Difference: -11 });
  expect(Line(Ps[2])).toMatchObject({ Before: 12, Counted: 15, Difference: 3 });
  const Stock = await StockOf(A.Token, W);
  expect(Stock.Map.get(Ps[0])).toBe(7);
  expect(Stock.Map.get(Ps[1]) ?? 0).toBe(0);
  expect(Stock.Map.get(Ps[2])).toBe(15);
  expect(Stock.Map.get(Ps[3])).toBe(13);
});

test("r05: one bad line leaves the whole sheet unapplied", async () => {
  const B = await NewCompany();
  const Foreign = await NewProduct(B.CompanyId);
  const Good = [
    { ProductId: Ps[0], Counted: 1 },
    { ProductId: Ps[1], Counted: 2 },
    { ProductId: Ps[2], Counted: 3 },
  ];
  const Bad = [
    { ProductId: Foreign, Counted: 4 },
    { ProductId: Ps[3], Counted: -1 },
    { ProductId: Ps[3], Counted: 2.5 },
    { ProductId: 1e12, Counted: 4 },
    { ProductId: Ps[3], Counted: 1e12 },
  ];
  for (const Line of Bad) {
    const Res = await Stocktake(A.Token, W, [...Good, Line]);
    expect([400, 404, 409]).toContain(Res.Status);
  }
  expect((await Stocktake(B.Token, W, Good)).Status).toBe(404);
  const Stock = await StockOf(A.Token, W);
  expect(Ps.map((P) => Stock.Map.get(P))).toEqual([10, 11, 12, 13]);
});

test("r05: a large sheet applies, and goods still on the road arrive on top of the count", async () => {
  const W2 = await NewWarehouse(A.Token);
  const Id = await SendOk(A.Token, W, W2, [{ ProductId: Ps[0], Quantity: 3 }]);
  await Put(A.Token, W2, Ps[0], 2);
  const Many: { ProductId: number; Counted: number }[] = [{ ProductId: Ps[0], Counted: 10 }];
  for (let I = 0; I < 299; I++) {
    const P = await NewProduct(A.CompanyId);
    Many.push({ ProductId: P, Counted: I % 5 });
  }
  const Res = await Stocktake(A.Token, W2, Many);
  expect(Created(Res.Status)).toBe(true);
  expect(Res.Body.Data.Lines.length).toBe(300);
  expect(Res.Body.Data.Lines.find((L: any) => L.ProductId === Ps[0])).toMatchObject({ Before: 2, Counted: 10, Difference: 8 });
  expect(await Qty(A.Token, W2, Many[7].ProductId)).toBe(1);
  expect(Created((await Receive(A.Token, Id)).Status)).toBe(true);
  expect(await Qty(A.Token, W2, Ps[0])).toBe(13);
  expect(await Qty(A.Token, W, Ps[0])).toBe(7);
}, 60000);
