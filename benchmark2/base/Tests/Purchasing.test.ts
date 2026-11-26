import { beforeEach, expect, test } from "bun:test";
import { Api, ResetDatabase } from "../Src/Test/Setup";
import { SeedCompany, SeedProduct } from "../Src/Test/Seed";

beforeEach(async () => {
  await ResetDatabase();
});

test("receiving a purchase order adds stock once", async () => {
  const { Company, Token } = await SeedCompany();
  const Product = await SeedProduct(Company.Id, { Stock: 2 });
  const Supplier = await Api("POST", "/Suppliers", { Token, Body: { Name: "مورد" } });
  const Po = await Api("POST", "/PurchaseOrders", {
    Token,
    Body: { SupplierId: Supplier.Body.Data.Id, Items: [{ ProductId: Product.Id, Quantity: 5, UnitCost: "7.50" }] },
  });
  expect(Po.Status).toBe(201);
  expect(Po.Body.Data.Total).toBe("37.50");
  expect((await Api("POST", `/PurchaseOrders/${Po.Body.Data.Id}/Receive`, { Token })).Status).toBe(200);
  expect((await Api("POST", `/PurchaseOrders/${Po.Body.Data.Id}/Receive`, { Token })).Status).toBe(409);
  expect((await Api("GET", `/Products/${Product.Id}`, { Token })).Body.Data.Stock).toBe(7);
});
