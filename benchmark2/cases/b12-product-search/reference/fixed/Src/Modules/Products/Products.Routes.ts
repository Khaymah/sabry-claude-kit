import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateProductBody, SearchQuery, UpdateProductBody } from "./Products.Schema";
import * as ProductsService from "./Products.Service";

export const ProductsRoutes = new Hono<AppEnv>();
ProductsRoutes.use("*", RequireAuth);

ProductsRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await ProductsService.ListProducts(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

ProductsRoutes.get("/Search", async (C) => {
  const Query = ParseQuery(C, SearchQuery);
  return Ok(C, await ProductsService.SearchProducts(C.get("Auth").CompanyId, Query));
});

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
