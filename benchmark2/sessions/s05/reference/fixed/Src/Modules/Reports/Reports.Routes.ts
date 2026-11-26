import { Hono } from "hono";
import { z } from "zod";
import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Db } from "../../Database/Db";
import { PriceChanges, Products } from "../../Database/Schema";
import { Ok } from "../../Lib/Response";
import { ParseQuery } from "../../Lib/Validate";
import { PageMeta, PageQuery } from "../../Lib/Pagination";

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);

const Day = z.iso.date();

ReportsRoutes.get("/PriceChanges", async (C) => {
  const Query = ParseQuery(C, PageQuery.extend({ From: Day, To: Day }));
  const CompanyId = C.get("Auth").CompanyId;
  const End = new Date(`${Query.To}T00:00:00Z`);
  End.setUTCDate(End.getUTCDate() + 1);
  const Where = and(eq(PriceChanges.CompanyId, CompanyId), gte(PriceChanges.ChangedAt, new Date(`${Query.From}T00:00:00Z`)), lt(PriceChanges.ChangedAt, End));
  const Items = await Db.select({
    ProductId: PriceChanges.ProductId,
    ProductName: Products.Name,
    OldPrice: PriceChanges.OldPrice,
    NewPrice: PriceChanges.NewPrice,
    ChangedAt: PriceChanges.ChangedAt,
  })
    .from(PriceChanges)
    .innerJoin(Products, eq(Products.Id, PriceChanges.ProductId))
    .where(Where)
    .orderBy(desc(PriceChanges.ChangedAt), desc(PriceChanges.Id))
    .limit(Query.PageSize)
    .offset((Query.Page - 1) * Query.PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(PriceChanges).where(Where);
  return Ok(C, { Items, ...PageMeta(Query.Page, Query.PageSize, Total) });
});
