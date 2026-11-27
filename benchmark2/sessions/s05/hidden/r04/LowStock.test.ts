import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, Reset, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

test("r04: low stock lists active products at or under the threshold, emptiest first", async () => {
  const Ids: number[] = [];
  for (const Stock of [7, 0, 5, 3, 20]) Ids.push(await NewProduct(A.CompanyId, { Stock }));
  const Retired = await NewProduct(A.CompanyId, { Stock: 0 });
  await Sql(`UPDATE "Products" SET "IsActive" = false WHERE "Id" = $1`, [Retired]);
  const B = await NewCompany();
  await NewProduct(B.CompanyId, { Stock: 0 });
  const Res = await Call("GET", "/Products/LowStock?Threshold=5", { Token: A.Token });
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Items.map((P: any) => P.Id)).toEqual([Ids[1], Ids[3], Ids[2]]);
  const Default = await Call("GET", "/Products/LowStock", { Token: A.Token });
  expect(Default.Body.Data.Items.length).toBe(3);
  expect((await Call("GET", "/Products/LowStock?Threshold=-1", { Token: A.Token })).Status).toBe(400);
});
