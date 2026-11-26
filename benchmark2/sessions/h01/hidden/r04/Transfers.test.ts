import { beforeEach, expect, test } from "bun:test";
import { Call, Created, NewCompany, NewProduct, NewWarehouse, Put, Qty, Receive, Reset, Send, SendOk } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let W1: number;
let W2: number;
let P1: number;
let P2: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  W1 = await NewWarehouse(A.Token);
  W2 = await NewWarehouse(A.Token);
  P1 = await NewProduct(A.CompanyId);
  P2 = await NewProduct(A.CompanyId);
  await Put(A.Token, W1, P1, 10);
  await Put(A.Token, W1, P2, 5);
});

test("r04: stock leaves on send and arrives on receive", async () => {
  const Res = await Send(A.Token, W1, W2, [{ ProductId: P1, Quantity: 4 }, { ProductId: P2, Quantity: 5 }]);
  expect(Created(Res.Status)).toBe(true);
  expect(Res.Body.Data).toMatchObject({ Status: "InTransit", FromWarehouseId: W1, ToWarehouseId: W2 });
  const Id = Res.Body.Data.Id;
  expect(await Qty(A.Token, W1, P1)).toBe(6);
  expect(await Qty(A.Token, W1, P2)).toBe(0);
  expect(await Qty(A.Token, W2, P1)).toBe(0);
  const Got = await Receive(A.Token, Id);
  expect(Created(Got.Status)).toBe(true);
  expect(Got.Body.Data.Status).toBe("Received");
  expect(await Qty(A.Token, W2, P1)).toBe(4);
  expect(await Qty(A.Token, W2, P2)).toBe(5);
  const Read = await Call("GET", `/Transfers/${Id}`, { Token: A.Token });
  expect(Read.Status).toBe(200);
  expect(Read.Body.Data.Status).toBe("Received");
  expect(Read.Body.Data.Items.length).toBe(2);
  expect((await Receive(A.Token, Id)).Status).toBe(409);
  expect(await Qty(A.Token, W2, P1)).toBe(4);
});

test("r04: a transfer that cannot be fully covered moves nothing", async () => {
  expect((await Send(A.Token, W1, W2, [{ ProductId: P1, Quantity: 4 }, { ProductId: P2, Quantity: 6 }])).Status).toBe(409);
  expect([400, 409]).toContain((await Send(A.Token, W1, W2, [{ ProductId: P1, Quantity: 6 }, { ProductId: P1, Quantity: 6 }])).Status);
  expect([400, 409]).toContain((await Send(A.Token, W1, W1, [{ ProductId: P1, Quantity: 1 }])).Status);
  for (const Quantity of [0, -2, 1.5, 1e12]) {
    expect([400, 409]).toContain((await Send(A.Token, W1, W2, [{ ProductId: P1, Quantity }])).Status);
  }
  expect([400, 404]).toContain((await Send(A.Token, W1, W2, [{ ProductId: 1e12, Quantity: 1 }])).Status);
  expect([400, 404]).toContain((await Send(A.Token, W1, 1e12, [{ ProductId: P1, Quantity: 1 }])).Status);
  expect(await Qty(A.Token, W1, P1)).toBe(10);
  expect(await Qty(A.Token, W1, P2)).toBe(5);
  expect(await Qty(A.Token, W2, P1)).toBe(0);
});

test("r04: double clicks send once and receive once", async () => {
  const Sent = await Promise.all([
    Send(A.Token, W1, W2, [{ ProductId: P1, Quantity: 6 }]),
    Send(A.Token, W1, W2, [{ ProductId: P1, Quantity: 6 }]),
  ]);
  expect(Sent.filter((R) => Created(R.Status)).length).toBe(1);
  expect(await Qty(A.Token, W1, P1)).toBe(4);
  const Id = Sent.find((R) => Created(R.Status))!.Body.Data.Id;
  const Got = await Promise.all([Receive(A.Token, Id), Receive(A.Token, Id), Receive(A.Token, Id)]);
  expect(Got.filter((R) => Created(R.Status)).length).toBe(1);
  expect(await Qty(A.Token, W2, P1)).toBe(6);
});

test("r04: another company's branches, products and transfers are not found", async () => {
  const B = await NewCompany();
  const BW = await NewWarehouse(B.Token);
  const BP = await NewProduct(B.CompanyId);
  await Put(B.Token, BW, BP, 9);
  expect((await Send(A.Token, W1, BW, [{ ProductId: P1, Quantity: 1 }])).Status).toBe(404);
  expect((await Send(A.Token, BW, W1, [{ ProductId: BP, Quantity: 1 }])).Status).toBe(404);
  expect((await Send(A.Token, W1, W2, [{ ProductId: BP, Quantity: 1 }])).Status).toBe(404);
  const Id = await SendOk(A.Token, W1, W2, [{ ProductId: P1, Quantity: 2 }]);
  expect((await Call("GET", `/Transfers/${Id}`, { Token: B.Token })).Status).toBe(404);
  expect((await Receive(B.Token, Id)).Status).toBe(404);
  expect(await Qty(A.Token, W1, P1)).toBe(8);
  expect(await Qty(A.Token, W2, P1)).toBe(0);
  expect(await Qty(B.Token, BW, BP)).toBe(9);
});
