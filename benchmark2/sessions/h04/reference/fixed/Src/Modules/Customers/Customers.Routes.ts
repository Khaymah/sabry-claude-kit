import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateCustomerBody, UpdateCustomerBody } from "./Customers.Schema";
import * as CustomersService from "./Customers.Service";
import { CreditLimitBody, CreditPaymentBody } from "../Credit/Credit.Schema";
import * as CreditService from "../Credit/Credit.Service";

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
  const Body = await ParseBody(C, UpdateCustomerBody);
  return Ok(C, await CustomersService.UpdateCustomer(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body));
});

CustomersRoutes.get("/:Id/Credit", async (C) =>
  Ok(C, await CreditService.GetCredit(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

CustomersRoutes.put("/:Id/CreditLimit", async (C) => {
  const Auth = C.get("Auth");
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, CreditLimitBody);
  return Ok(C, await CreditService.SetCreditLimit(Auth.CompanyId, Auth.UserId, Auth.Role, Id, Body.Limit));
});

CustomersRoutes.get("/:Id/CreditLimitChanges", async (C) =>
  Ok(C, await CreditService.ListLimitChanges(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

CustomersRoutes.post("/:Id/CreditPayments", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, CreditPaymentBody);
  return Ok(C, await CreditService.PayCredit(C.get("Auth").CompanyId, Id, Body), 201);
});

CustomersRoutes.get("/:Id/CreditStatement", async (C) =>
  Ok(C, await CreditService.Statement(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);
