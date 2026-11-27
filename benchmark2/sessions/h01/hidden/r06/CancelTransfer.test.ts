import { beforeEach, expect, test } from "bun:test";
import { Adjust, Call, Cancel, Created, NewCompany, NewProduct, NewWarehouse, Put, Qty, Receive, Reset, SendOk } from "../_Support";

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
  await Put(A.Token, W1, P2, 8);
});

const Status = async (Id: number) => (await Call("GET", `/Transfers/${Id}`, { Token: A.Token })).Body.Data.Status;

test("r06: cancelling a transfer on the road returns the goods to the sender", async () => {
  const Id = await SendOk(A.Token, W1, W2, [{ ProductId: P1, Quantity: 4 }, { ProductId: P2, Quantity: 3 }]);
  const Res = await Cancel(A.Token, Id);
  expect(Created(Res.Status)).toBe(true);
  expect(Res.Body.Data.Status).toBe("Cancelled");
  expect(await Qty(A.Token, W1, P1)).toBe(10);
  expect(await Qty(A.Token, W1, P2)).toBe(8);
  expect((await Receive(A.Token, Id)).Status).toBe(409);
  expect((await Cancel(A.Token, Id)).Status).toBe(409);
  expect(await Qty(A.Token, W2, P1)).toBe(0);
  expect(await Qty(A.Token, W1, P1)).toBe(10);
  expect(await Status(Id)).toBe("Cancelled");
});

test("r06: cancelling a received transfer moves it back, or nothing if the receiver lacks part of it", async () => {
  const Id = await SendOk(A.Token, W1, W2, [{ ProductId: P1, Quantity: 4 }, { ProductId: P2, Quantity: 3 }]);
  expect(Created((await Receive(A.Token, Id)).Status)).toBe(true);
  expect(Created((await Adjust(A.Token, W2, P2, -2)).Status)).toBe(true);
  expect((await Cancel(A.Token, Id)).Status).toBe(409);
  expect([await Qty(A.Token, W1, P1), await Qty(A.Token, W1, P2)]).toEqual([6, 5]);
  expect([await Qty(A.Token, W2, P1), await Qty(A.Token, W2, P2)]).toEqual([4, 1]);
  expect(await Status(Id)).toBe("Received");
  expect(Created((await Adjust(A.Token, W2, P2, 2)).Status)).toBe(true);
  expect(Created((await Cancel(A.Token, Id)).Status)).toBe(true);
  expect([await Qty(A.Token, W1, P1), await Qty(A.Token, W1, P2)]).toEqual([10, 8]);
  expect([await Qty(A.Token, W2, P1), await Qty(A.Token, W2, P2)]).toEqual([0, 0]);
  expect(await Status(Id)).toBe("Cancelled");
});

test("r06: a double click on cancel returns the goods once", async () => {
  const Id = await SendOk(A.Token, W1, W2, [{ ProductId: P1, Quantity: 4 }]);
  const Results = await Promise.all([Cancel(A.Token, Id), Cancel(A.Token, Id), Cancel(A.Token, Id)]);
  expect(Results.filter((R) => Created(R.Status)).length).toBe(1);
  expect(await Qty(A.Token, W1, P1)).toBe(10);
  const Other = await SendOk(A.Token, W1, W2, [{ ProductId: P1, Quantity: 4 }]);
  expect(Created((await Receive(A.Token, Other)).Status)).toBe(true);
  const Again = await Promise.all([Cancel(A.Token, Other), Cancel(A.Token, Other)]);
  expect(Again.filter((R) => Created(R.Status)).length).toBe(1);
  expect(await Qty(A.Token, W1, P1)).toBe(10);
  expect(await Qty(A.Token, W2, P1)).toBe(0);
});

test("r06: receive and cancel racing end in one consistent state", async () => {
  const Id = await SendOk(A.Token, W1, W2, [{ ProductId: P1, Quantity: 4 }]);
  await Promise.all([Receive(A.Token, Id), Cancel(A.Token, Id)]);
  const Final = await Status(Id);
  const From = await Qty(A.Token, W1, P1);
  const To = await Qty(A.Token, W2, P1);
  if (Final === "Cancelled") expect([From, To]).toEqual([10, 0]);
  else expect([Final, From, To]).toEqual(["Received", 6, 4]);
  const B = await NewCompany();
  const Next = await SendOk(A.Token, W1, W2, [{ ProductId: P1, Quantity: 1 }]);
  expect((await Cancel(B.Token, Next)).Status).toBe(404);
  expect(await Status(Next)).toBe("InTransit");
});
