import { beforeEach, describe, expect, test } from "bun:test";
import { Api, ResetDatabase } from "../Src/Test/Setup";
import { SeedCompany, SeedCustomer, SeedProduct } from "../Src/Test/Seed";

beforeEach(async () => {
  await ResetDatabase();
});

describe("Orders", () => {
  test("creates an order with 14% tax and decrements stock", async () => {
    const { Company, Token } = await SeedCompany();
    const Customer = await SeedCustomer(Company.Id);
    const Product = await SeedProduct(Company.Id, { Price: "10.50", Stock: 5 });
    const Res = await Api("POST", "/Orders", {
      Token,
      Body: { CustomerId: Customer.Id, Items: [{ ProductId: Product.Id, Quantity: 2 }] },
    });
    expect(Res.Status).toBe(201);
    expect(Res.Body.Data.Subtotal).toBe("21.00");
    expect(Res.Body.Data.Tax).toBe("2.94");
    expect(Res.Body.Data.Total).toBe("23.94");
    const After = await Api("GET", `/Products/${Product.Id}`, { Token });
    expect(After.Body.Data.Stock).toBe(3);
  });

  test("rejects requests without a session", async () => {
    const Res = await Api("GET", "/Orders");
    expect(Res.Status).toBe(401);
    expect(Res.Body.Success).toBe(false);
  });
});
