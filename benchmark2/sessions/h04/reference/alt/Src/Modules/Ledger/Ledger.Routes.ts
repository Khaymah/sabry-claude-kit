import { Hono } from "hono";
import { z } from "zod";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { MoneyString } from "../Products/Products.Schema";
import * as Ledger from "./Ledger.Service";

const LimitBody = z.object({ Limit: MoneyString });
const RepayBody = z.object({ Amount: MoneyString, Method: z.enum(["Cash", "Card"]), RequestId: z.string().min(1).max(100) });
const WriteOffBody = z.object({ Reason: z.string().trim().min(1) });
const MonthQuery = z.object({ Month: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/) });

export const LedgerRoutes = new Hono<AppEnv>();

LedgerRoutes.get("/Customers/:Id/Credit", RequireAuth, async (C) => Ok(C, await Ledger.Account(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));

LedgerRoutes.put("/Customers/:Id/CreditLimit", RequireAuth, async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const { Limit } = await ParseBody(C, LimitBody);
  return Ok(C, await Ledger.ChangeLimit(C.get("Auth"), Id, Limit));
});

LedgerRoutes.get("/Customers/:Id/CreditLimitChanges", RequireAuth, async (C) =>
  Ok(C, await Ledger.LimitLog(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

LedgerRoutes.post("/Customers/:Id/CreditPayments", RequireAuth, async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, RepayBody);
  return Ok(C, await Ledger.Repay(C.get("Auth").CompanyId, Id, Body), 201);
});

LedgerRoutes.get("/Customers/:Id/CreditStatement", RequireAuth, async (C) =>
  Ok(C, await Ledger.CustomerStatement(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

LedgerRoutes.post("/Orders/:Id/ChargeToCredit", RequireAuth, async (C) =>
  Ok(C, await Ledger.Charge(C.get("Auth").CompanyId, ParseId(C.req.param("Id"))), 201),
);

LedgerRoutes.post("/Orders/:Id/WriteOff", RequireAuth, async (C) => {
  const Id = ParseId(C.req.param("Id"));
  await ParseBody(C, WriteOffBody);
  return Ok(C, await Ledger.WriteOff(C.get("Auth"), Id), 201);
});

LedgerRoutes.get("/Reports/OverdueCredit", RequireAuth, async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await Ledger.Overdue(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

LedgerRoutes.get("/Reports/CreditAging", RequireAuth, async (C) => {
  const { Month } = ParseQuery(C, MonthQuery);
  return Ok(C, await Ledger.Aging(C.get("Auth").CompanyId, Month));
});
