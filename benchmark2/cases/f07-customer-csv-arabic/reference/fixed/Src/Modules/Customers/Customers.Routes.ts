import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateCustomerBody, UpdateCustomerBody } from "./Customers.Schema";
import * as CustomersService from "./Customers.Service";

export const CustomersRoutes = new Hono<AppEnv>();
CustomersRoutes.use("*", RequireAuth);

CustomersRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await CustomersService.ListCustomers(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

CustomersRoutes.get("/Export", async (C) => {
  const Csv = await CustomersService.ExportCsv(C.get("Auth").CompanyId);
  return C.body(Csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="Customers.csv"',
  });
});

CustomersRoutes.post("/Import", async (C) => {
  const Text = await C.req.text();
  return Ok(C, await CustomersService.ImportCsv(C.get("Auth").CompanyId, Text));
});

CustomersRoutes.get("/:Id", async (C) =>
  Ok(C, await CustomersService.GetCustomer(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

CustomersRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateCustomerBody);
  return Ok(C, await CustomersService.CreateCustomer(C.get("Auth").CompanyId, Body), 201);
});

CustomersRoutes.patch("/:Id", async (C) => {
  const Body = await ParseBody(C, UpdateCustomerBody);
  return Ok(C, await CustomersService.UpdateCustomer(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body));
});
