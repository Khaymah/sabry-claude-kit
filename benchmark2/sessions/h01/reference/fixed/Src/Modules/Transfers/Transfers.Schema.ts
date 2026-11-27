import { z } from "zod";
import { Quantity, RowId } from "../Warehouses/Warehouses.Schema";

export const CreateTransferBody = z.object({
  FromWarehouseId: RowId,
  ToWarehouseId: RowId,
  Items: z.array(z.object({ ProductId: RowId, Quantity })).min(1).max(500),
});
