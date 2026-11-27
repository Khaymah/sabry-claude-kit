import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { CreateQuoteBody, ReviseQuoteBody } from "./Quotes.Schema";
import * as QuotesService from "./Quotes.Service";

export const QuotesRoutes = new Hono<AppEnv>();
QuotesRoutes.use("*", RequireAuth);

QuotesRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateQuoteBody);
  return Ok(C, await QuotesService.CreateQuote(C.get("Auth"), Body), 201);
});

QuotesRoutes.get("/:Id", async (C) => Ok(C, await QuotesService.GetQuote(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));

QuotesRoutes.get("/:Id/Versions", async (C) =>
  Ok(C, await QuotesService.ListVersions(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

QuotesRoutes.put("/:Id", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, ReviseQuoteBody);
  return Ok(C, await QuotesService.ReviseQuote(C.get("Auth").CompanyId, Id, Body.Items));
});

QuotesRoutes.post("/:Id/Submit", async (C) => Ok(C, await QuotesService.SubmitQuote(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));

QuotesRoutes.post("/:Id/Approve", RequireRole("Owner", "Admin"), async (C) =>
  Ok(C, await QuotesService.ApproveQuote(C.get("Auth"), ParseId(C.req.param("Id")))),
);

QuotesRoutes.post("/:Id/Convert", async (C) => Ok(C, await QuotesService.ConvertQuote(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));
