import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateCustomerBody, EmailLookupQuery, UpdateCustomerBody } from "./Customers.Schema";
import * as CustomersService from "./Customers.Service";

export const CustomersRoutes = new Hono<AppEnv>();
CustomersRoutes.use("*", RequireAuth);

CustomersRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await CustomersService.ListCustomers(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

CustomersRoutes.get("/Lookup", async (C) => {
  const Query = ParseQuery(C, EmailLookupQuery);
  return Ok(C, await CustomersService.LookupByEmail(C.get("Auth").CompanyId, Query.Email));
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
