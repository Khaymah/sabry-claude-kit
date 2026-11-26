import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let B: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  B = await NewCompany();
});

async function Search(Query: string, Token = A.Token) {
  return Call("GET", `/Products/Search${Query ? `?${Query}` : ""}`, { Token });
}

async function Names(Query: string) {
  const Res = await Search(Query);
  expect(Res.Status).toBe(200);
  return Res.Body.Data.Items.map((P: any) => P.Name).sort();
}

const Q = (V: string) => `Q=${encodeURIComponent(V)}`;

test("wildcard characters in the search text are matched literally", async () => {
  await NewProduct(A.CompanyId, { Name: "خصم 50%" });
  await NewProduct(A.CompanyId, { Name: "Plain product" });
  await NewProduct(A.CompanyId, { Name: "snake_case item" });
  await NewProduct(A.CompanyId, { Name: "back\\slash" });
  expect(await Names(Q("%"))).toEqual(["خصم 50%"]);
  expect(await Names(Q("_"))).toEqual(["snake_case item"]);
  expect(await Names(Q("\\"))).toEqual(["back\\slash"]);
  expect(await Names(Q("50%"))).toEqual(["خصم 50%"]);
});

test("Arabic spelling variants find the same product", async () => {
  await NewProduct(A.CompanyId, { Name: "أحمد للعطور" });
  await NewProduct(A.CompanyId, { Name: "مكتبة الإسراء" });
  await NewProduct(A.CompanyId, { Name: "حلوى المولد" });
  await NewProduct(A.CompanyId, { Name: "آيس كريم" });
  expect(await Names(Q("احمد"))).toEqual(["أحمد للعطور"]);
  expect(await Names(Q("مكتبه الاسراء"))).toEqual(["مكتبة الإسراء"]);
  expect(await Names(Q("حلوي"))).toEqual(["حلوى المولد"]);
  expect(await Names(Q("ايس"))).toEqual(["آيس كريم"]);
  expect(await Names(Q("أَحْمَد"))).toEqual(["أحمد للعطور"]);
});

test("search is case-insensitive over name and SKU, and trims spaces", async () => {
  await NewProduct(A.CompanyId, { Name: "Blue Mug", Sku: "MUG-001" });
  await NewProduct(A.CompanyId, { Name: "Red Plate", Sku: "PLT-002" });
  expect(await Names(Q("  blue "))).toEqual(["Blue Mug"]);
  expect(await Names(Q("plt-0"))).toEqual(["Red Plate"]);
  expect(await Names(Q(""))).toEqual(["Blue Mug", "Red Plate"]);
});

test("price range is inclusive and strictly validated", async () => {
  await NewProduct(A.CompanyId, { Name: "Ten", Price: "10.00" });
  await NewProduct(A.CompanyId, { Name: "TenHalf", Price: "10.50" });
  await NewProduct(A.CompanyId, { Name: "Twenty", Price: "20.00" });
  expect(await Names("MinPrice=10.5&MaxPrice=20")).toEqual(["TenHalf", "Twenty"]);
  expect(await Names("MaxPrice=10")).toEqual(["Ten"]);
  for (const Bad of ["MinPrice=-1", "MinPrice=1.234", "MinPrice=abc", "MaxPrice=ten"]) {
    const Res = await Search(Bad);
    expect(Res.Status).toBe(400);
    expect(Res.Body.Error.Code).toBe("VALIDATION_ERROR");
  }
});

test("paging parameters must be plain whole numbers within limits", async () => {
  for (let I = 0; I < 7; I++) await NewProduct(A.CompanyId, { Name: `P${I}` });
  const Page = await Search("PageSize=3&Page=3");
  expect(Page.Status).toBe(200);
  expect(Page.Body.Data.Items.length).toBe(1);
  expect(Page.Body.Data.Total).toBe(7);
  expect((await Search("PageSize=100")).Status).toBe(200);
  for (const Bad of ["PageSize=0", "PageSize=101", "PageSize=100000", "PageSize=1.5", "PageSize=abc", "Page=0", "Page=-1", "Page=abc"]) {
    expect((await Search(Bad)).Status).toBe(400);
  }
});

test("unknown sort and filter values are rejected", async () => {
  expect((await Search(Q("ب".repeat(100)))).Status).toBe(200);
  expect((await Search("Sort=Price;DROP")).Status).toBe(400);
  expect((await Search("InStock=yes")).Status).toBe(400);
});

test("sorting works and only active products of the caller's company are returned", async () => {
  await NewProduct(A.CompanyId, { Name: "Mid", Price: "15.00", Stock: 0 });
  await NewProduct(A.CompanyId, { Name: "Cheap", Price: "5.00" });
  await NewProduct(A.CompanyId, { Name: "Dear", Price: "50.00" });
  const Hidden = await NewProduct(A.CompanyId, { Name: "Retired", Price: "1.00" });
  await Sql(`UPDATE "Products" SET "IsActive" = false WHERE "Id" = $1`, [Hidden]);
  await NewProduct(B.CompanyId, { Name: "Foreign", Price: "2.00" });
  const Asc = await Search("Sort=PriceAsc");
  expect(Asc.Body.Data.Items.map((P: any) => P.Name)).toEqual(["Cheap", "Mid", "Dear"]);
  const Desc = await Search("Sort=PriceDesc");
  expect(Desc.Body.Data.Items.map((P: any) => P.Name)).toEqual(["Dear", "Mid", "Cheap"]);
  expect(await Names("InStock=true")).toEqual(["Cheap", "Dear"]);
  expect(await Names("InStock=false")).toEqual(["Mid"]);
  expect(Asc.Body.Data.Total).toBe(3);
});
