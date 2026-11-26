import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewSupplier, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

const Names = async (Q: string) => ((await Call("GET", `/Suppliers?Q=${encodeURIComponent(Q)}`, { Token: A.Token })).Body.Data.Items.map((S: any) => S.Name) as string[]).sort();

test("r04: suppliers can be searched by part of the name, ignoring case", async () => {
  for (const Name of ["Nile Foods", "nile water", "الدلتا للتجارة", "Cairo Pack"]) await NewSupplier(A.CompanyId, Name);
  const B = await NewCompany();
  await NewSupplier(B.CompanyId, "Nile Secret");
  expect(await Names("NILE")).toEqual(["Nile Foods", "nile water"]);
  expect(await Names("الدلتا")).toEqual(["الدلتا للتجارة"]);
  expect((await Names("")).length).toBe(4);
});

test("r04: wildcard characters are matched literally and paging still works", async () => {
  for (const Name of ["100% Cotton", "Plain", "a_b"]) await NewSupplier(A.CompanyId, Name);
  expect(await Names("%")).toEqual(["100% Cotton"]);
  expect(await Names("_")).toEqual(["a_b"]);
  const Page = await Call("GET", `/Suppliers?Page=1&PageSize=2`, { Token: A.Token });
  expect(Page.Body.Data.Items.length).toBe(2);
  expect(Page.Body.Data.Total).toBe(3);
});
