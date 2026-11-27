import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { AppError, Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateOrderBody, EditItemsBody } from "./Orders.Schema";
import * as OrdersService from "./Orders.Service";

export const OrdersRoutes = new Hono<AppEnv>();
OrdersRoutes.use("*", RequireAuth);

OrdersRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await OrdersService.ListOrders(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

OrdersRoutes.get("/:Id", async (C) =>
  Ok(C, await OrdersService.GetOrder(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

OrdersRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateOrderBody);
  return Ok(C, await OrdersService.CreateOrder(C.get("Auth").CompanyId, Body), 201);
});

OrdersRoutes.post("/:Id/Cancel", async (C) =>
  Ok(C, await OrdersService.CancelOrder(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

OrdersRoutes.patch(
  "/:Id/Items",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: () => {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is larger than 64KB");
    },
  }),
  async (C) => {
    const Body = await ParseBody(C, EditItemsBody);
    return Ok(C, await OrdersService.EditOrderItems(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body));
  },
);
