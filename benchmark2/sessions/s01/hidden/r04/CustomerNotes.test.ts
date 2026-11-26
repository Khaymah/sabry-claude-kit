import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

test("r04: notes are saved on a customer and shown back", async () => {
  const Id = await NewCustomer(A.CompanyId);
  const Res = await Call("PATCH", `/Customers/${Id}`, { Token: A.Token, Body: { Notes: "بيحب يستلم بعد الساعة 5" } });
  expect(Res.Status).toBe(200);
  expect((await Call("GET", `/Customers/${Id}`, { Token: A.Token })).Body.Data.Notes).toBe("بيحب يستلم بعد الساعة 5");
  const Created = await Call("POST", "/Customers", { Token: A.Token, Body: { Name: "جديد", Notes: "عميل جملة" } });
  expect(Created.Status).toBe(201);
  expect(Created.Body.Data.Notes).toBe("عميل جملة");
});

test("r04: notes are limited to 1000 characters", async () => {
  const Id = await NewCustomer(A.CompanyId);
  expect((await Call("PATCH", `/Customers/${Id}`, { Token: A.Token, Body: { Notes: "ن".repeat(1001) } })).Status).toBe(400);
  expect((await Call("PATCH", `/Customers/${Id}`, { Token: A.Token, Body: { Notes: "ن".repeat(1000) } })).Status).toBe(200);
});
