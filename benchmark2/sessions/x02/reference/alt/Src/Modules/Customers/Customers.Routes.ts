import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateCustomerBody, UpdateCustomerBody } from "./Customers.Schema";
import * as CustomersService from "./Customers.Service";
import { GroupIdBody, PricesQuery } from "../Sales/Sales.Schema";
import { CustomerPrices, RequireGroup } from "../Sales/Sales.Service";
import { Now } from "../../Lib/Clock";

export const CustomersRoutes = new Hono<AppEnv>();
CustomersRoutes.use("*", RequireAuth);

CustomersRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await CustomersService.ListCustomers(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

CustomersRoutes.get("/:Id", async (C) =>
  Ok(C, await CustomersService.GetCustomer(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

CustomersRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateCustomerBody);
  return Ok(C, await CustomersService.CreateCustomer(C.get("Auth").CompanyId, Body), 201);
});

CustomersRoutes.patch("/:Id", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Raw = await C.req.json().catch(() => null);
  const CompanyId = C.get("Auth").CompanyId;
  if (Raw && typeof Raw === "object" && "GroupId" in Raw) {
    const { GroupId } = await ParseBody(C, GroupIdBody);
    await RequireGroup(CompanyId, GroupId);
    await CustomersService.GetCustomer(CompanyId, Id);
    await CustomersService.SetGroup(CompanyId, Id, GroupId);
  }
  const Body = await ParseBody(C, UpdateCustomerBody);
  return Ok(C, await CustomersService.UpdateCustomer(CompanyId, Id, Body));
});

CustomersRoutes.get("/:Id/Prices", async (C) => {
  const Query = ParseQuery(C, PricesQuery);
  return Ok(C, await CustomerPrices(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Query.Date ?? Now().toISOString().slice(0, 10)));
});
