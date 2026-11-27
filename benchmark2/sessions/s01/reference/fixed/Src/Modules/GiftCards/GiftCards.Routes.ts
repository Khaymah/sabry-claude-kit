import { Hono } from "hono";
import { z } from "zod";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody } from "../../Lib/Validate";
import { MoneyString } from "../Products/Products.Schema";
import * as GiftCardsService from "./GiftCards.Service";

export const GiftCardsRoutes = new Hono<AppEnv>();
GiftCardsRoutes.use("*", RequireAuth);

GiftCardsRoutes.post("/", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, z.object({ Amount: MoneyString }));
  return Ok(C, await GiftCardsService.IssueGiftCard(C.get("Auth").CompanyId, Body.Amount), 201);
});

GiftCardsRoutes.get("/:Code", async (C) => Ok(C, await GiftCardsService.GetGiftCard(C.get("Auth").CompanyId, C.req.param("Code"))));
