import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateProductBody, UpdateProductBody } from "./Products.Schema";
import * as ProductsService from "./Products.Service";
import * as PricingService from "./Products.Pricing";
import { z } from "zod";
import { MoneyString } from "./Products.Schema";

export const ProductsRoutes = new Hono<AppEnv>();
ProductsRoutes.use("*", RequireAuth);

ProductsRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await ProductsService.ListProducts(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

ProductsRoutes.patch("/Prices", async (C) => {
  const Body = await ParseBody(C, z.object({ Items: z.array(z.object({ ProductId: z.number().int().positive().max(2147483647), Price: MoneyString })).min(1).max(500) }));
  return Ok(C, await PricingService.BulkSetPrices(C.get("Auth").CompanyId, Body.Items));
});

ProductsRoutes.post("/Prices/Increase", async (C) => {
  const Body = await ParseBody(
    C,
    z.object({
      Percent: z.number().min(-90).max(500).refine((V) => Math.round(V * 100) === V * 100, "at most 2 decimals"),
      ProductIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(5000).optional(),
    }),
  );
  return Ok(C, await PricingService.IncreasePrices(C.get("Auth").CompanyId, Body.Percent, Body.ProductIds));
});

ProductsRoutes.get("/LowStock", async (C) => {
  const Query = ParseQuery(C, PageQuery.extend({ Threshold: z.coerce.number().int().min(0).max(1_000_000).default(5) }));
  return Ok(C, await PricingService.LowStock(C.get("Auth").CompanyId, Query.Threshold, Query.Page, Query.PageSize));
});

ProductsRoutes.get("/:Id/PriceHistory", async (C) => Ok(C, await PricingService.PriceHistory(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));

ProductsRoutes.get("/:Id", async (C) =>
  Ok(C, await ProductsService.GetProduct(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

ProductsRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateProductBody);
  return Ok(C, await ProductsService.CreateProduct(C.get("Auth").CompanyId, Body), 201);
});

ProductsRoutes.patch("/:Id", async (C) => {
  const Body = await ParseBody(C, UpdateProductBody);
  return Ok(C, await ProductsService.UpdateProduct(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body));
});
