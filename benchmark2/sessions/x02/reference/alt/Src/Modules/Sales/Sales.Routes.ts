import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { GroupBody, GroupPatchBody, PriceListBody, QuoteBody, RevisionBody, SettingsBody } from "./Sales.Schema";
import * as Sales from "./Sales.Service";

export const PriceListRoutes = new Hono<AppEnv>().use("*", RequireAuth);
PriceListRoutes.post("/", async (C) => Ok(C, await Sales.CreatePriceList(C.get("Auth").CompanyId, await ParseBody(C, PriceListBody))));

export const QuoteRoutes = new Hono<AppEnv>().use("*", RequireAuth);
QuoteRoutes.post("/", async (C) => Ok(C, await Sales.CreateQuote(C.get("Auth"), await ParseBody(C, QuoteBody))));
QuoteRoutes.get("/:Id", async (C) => Ok(C, await Sales.GetQuote(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));
QuoteRoutes.get("/:Id/Versions", async (C) => Ok(C, await Sales.QuoteVersions(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));
QuoteRoutes.put("/:Id", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, RevisionBody);
  return Ok(C, await Sales.ReviseQuote(C.get("Auth").CompanyId, Id, Body.Items));
});
QuoteRoutes.post("/:Id/Submit", async (C) => Ok(C, await Sales.SubmitQuote(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));
QuoteRoutes.post("/:Id/Approve", RequireRole("Owner", "Admin"), async (C) => Ok(C, await Sales.ApproveQuote(C.get("Auth"), ParseId(C.req.param("Id")))));
QuoteRoutes.post("/:Id/Convert", async (C) => Ok(C, await Sales.ConvertQuote(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));

export const QuoteSettingsRoutes = new Hono<AppEnv>().use("*", RequireAuth);
QuoteSettingsRoutes.get("/", async (C) => Ok(C, await Sales.GetValidity(C.get("Auth").CompanyId)));
QuoteSettingsRoutes.put("/", RequireRole("Owner"), async (C) =>
  Ok(C, await Sales.SetValidity(C.get("Auth").CompanyId, (await ParseBody(C, SettingsBody)).ValidityDays)),
);

export const GroupRoutes = new Hono<AppEnv>().use("*", RequireAuth);
GroupRoutes.get("/", async (C) => Ok(C, await Sales.ListGroups(C.get("Auth").CompanyId)));
GroupRoutes.post("/", async (C) => Ok(C, await Sales.CreateGroup(C.get("Auth").CompanyId, await ParseBody(C, GroupBody))));
GroupRoutes.patch("/:Id", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, GroupPatchBody);
  return Ok(C, await Sales.UpdateGroup(C.get("Auth").CompanyId, Id, Body.ApprovalThreshold));
});

export const ReportRoutes = new Hono<AppEnv>().use("*", RequireAuth);
ReportRoutes.get("/SalesBySalesperson", async (C) => Ok(C, await Sales.SalesBySalesperson(C.get("Auth").CompanyId)));
