import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateSupplierBody, SupplierPaymentBody, UpdateSupplierBody } from "./Suppliers.Schema";
import * as StatementService from "./Suppliers.Statement";
import * as SuppliersService from "./Suppliers.Service";

export const SuppliersRoutes = new Hono<AppEnv>();
SuppliersRoutes.use("*", RequireAuth);

SuppliersRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await SuppliersService.ListSuppliers(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

SuppliersRoutes.get("/:Id", async (C) => Ok(C, await SuppliersService.GetSupplier(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));

SuppliersRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateSupplierBody);
  const Auth = C.get("Auth");
  return Ok(C, await SuppliersService.CreateSupplier(Auth.CompanyId, Auth.UserId, Body), 201);
});

SuppliersRoutes.patch("/:Id", async (C) => {
  const Body = await ParseBody(C, UpdateSupplierBody);
  const Auth = C.get("Auth");
  return Ok(C, await SuppliersService.UpdateSupplier(Auth.CompanyId, Auth.UserId, ParseId(C.req.param("Id")), Body));
});

SuppliersRoutes.post("/:Id/Payments", async (C) => {
  const Body = await ParseBody(C, SupplierPaymentBody);
  const Auth = C.get("Auth");
  return Ok(C, await StatementService.PaySupplier(Auth.CompanyId, Auth.UserId, ParseId(C.req.param("Id")), Body), 201);
});

SuppliersRoutes.get("/:Id/Statement", async (C) =>
  Ok(C, await StatementService.SupplierStatement(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);
