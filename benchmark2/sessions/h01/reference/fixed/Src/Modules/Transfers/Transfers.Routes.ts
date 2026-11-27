import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { CreateTransferBody } from "./Transfers.Schema";
import * as TransfersService from "./Transfers.Service";

export const TransfersRoutes = new Hono<AppEnv>();
TransfersRoutes.use("*", RequireAuth);

TransfersRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateTransferBody);
  return Ok(C, await TransfersService.CreateTransfer(C.get("Auth").CompanyId, Body), 201);
});

TransfersRoutes.get("/:Id", async (C) =>
  Ok(C, await TransfersService.GetTransfer(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

TransfersRoutes.post("/:Id/Receive", async (C) =>
  Ok(C, await TransfersService.ReceiveTransfer(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

TransfersRoutes.post("/:Id/Cancel", async (C) =>
  Ok(C, await TransfersService.CancelTransfer(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);
