import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, BuyOk, Call, CheckIn, Created, GetTicket, Huge, MigrateRest, NewCompany, NewCustomer, NewEvent, NewOrganizer, Refund, Reset, Transfer } from "../_Support";

afterAll(() => setSystemTime());

const Cats = [{ Name: "Regular", Price: "100.00", Capacity: 50 }];

async function Bought(Token: string, CompanyId: number, Count: number) {
  const O = await NewOrganizer(Token);
  const E = await NewEvent(Token, O, ["2026-12-20T18:00:00Z"], Cats);
  const Buyer = await NewCustomer(CompanyId, "01555555555");
  const Tickets = (await BuyOk(Token, E.Sessions[0], E.Categories[0], Buyer, Count)).Tickets;
  return { E, Buyer, Tickets };
}

test("r10: a transfer goes to the customer we already have under any spelling of the number, including old customers", async () => {
  await Reset("0001_Init");
  At("2026-12-01T10:00:00Z");
  const A = await NewCompany();
  const B = await NewCompany();
  const OldOne = await NewCustomer(A.CompanyId, "+20 100 123 4567", "قديم ١");
  const OldTwo = await NewCustomer(A.CompanyId, "0111-222-3333", "قديم ٢");
  const BSame = await NewCustomer(B.CompanyId, "01001234567", "شركة ب");
  await MigrateRest();
  const Made = await Call("POST", "/Customers", { Token: A.Token, Body: { Name: "جديد", Phone: "0100 999 8888" } });
  expect(Created(Made.Status)).toBe(true);
  const ViaApi = Made.Body.Data.Id;
  const { Buyer, Tickets } = await Bought(A.Token, A.CompanyId, 6);
  const [T1, T2, T3, T4, T5, T6] = Tickets;
  expect((await GetTicket(A.Token, T1.Id)).Body.Data.HolderCustomerId).toBe(Buyer);
  const R1 = await Transfer(A.Token, T1.Id, "أي اسم", "01001234567");
  expect(Created(R1.Status)).toBe(true);
  expect(R1.Body.Data.HolderCustomerId).toBe(OldOne);
  expect(R1.Body.Data.HolderCustomerId).not.toBe(BSame);
  expect((await Transfer(A.Token, T2.Id, "أي اسم", "00201112223333")).Body.Data.HolderCustomerId).toBe(OldTwo);
  expect((await Transfer(A.Token, T3.Id, "أي اسم", "+201009998888")).Body.Data.HolderCustomerId).toBe(ViaApi);
  const Fresh = await Transfer(A.Token, T4.Id, "منى", "0122 000 1111");
  expect(Created(Fresh.Status)).toBe(true);
  const NewId = Fresh.Body.Data.HolderCustomerId;
  expect([Buyer, OldOne, OldTwo, ViaApi]).not.toContain(NewId);
  const Customer = await Call("GET", `/Customers/${NewId}`, { Token: A.Token });
  expect(Customer.Status).toBe(200);
  expect(Customer.Body.Data.Name).toBe("منى");
  expect((await Transfer(A.Token, T5.Id, "منى تاني", "+20 122 000 1111")).Body.Data.HolderCustomerId).toBe(NewId);
  expect((await GetTicket(A.Token, T5.Id)).Body.Data.HolderCustomerId).toBe(NewId);
  expect((await GetTicket(A.Token, T6.Id)).Body.Data.HolderCustomerId).toBe(Buyer);
  const List = await Call("GET", "/Customers?PageSize=100", { Token: A.Token });
  expect(List.Body.Data.Total).toBe(5);
});

test("r10: the old code stops working at the gate, the new one works; used or refunded tickets cannot move", async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
  const A = await NewCompany();
  const { E, Tickets } = await Bought(A.Token, A.CompanyId, 4);
  const [T1, T2, T3] = Tickets;
  const Moved = await Transfer(A.Token, T1.Id, "كريم", "01012341234");
  expect(Created(Moved.Status)).toBe(true);
  expect(Moved.Body.Data.Status).toBe("Valid");
  expect(Moved.Body.Data.Code).not.toBe(T1.Code);
  expect((await GetTicket(A.Token, T1.Id)).Body.Data.Code).toBe(Moved.Body.Data.Code);
  for (const Phone of ["12345", "0101234123", "010123412345", "+2010123412", "abc"]) expect((await Transfer(A.Token, T2.Id, "كريم", Phone)).Status).toBe(400);
  expect((await Transfer(A.Token, T2.Id, "", "01012341234")).Status).toBe(400);
  await Refund(A.Token, T3.Id);
  expect((await Transfer(A.Token, T3.Id, "كريم", "01012341234")).Status).toBe(409);
  At("2026-12-20T17:00:00Z");
  expect([404, 409]).toContain((await CheckIn(A.Token, E.Sessions[0], T1.Code)).Status);
  expect((await CheckIn(A.Token, E.Sessions[0], Moved.Body.Data.Code)).Status).toBe(200);
  expect((await Transfer(A.Token, T1.Id, "حد تاني", "01112341234")).Status).toBe(409);
  const B = await NewCompany();
  expect((await Transfer(B.Token, T2.Id, "حرامي", "01012341234")).Status).toBe(404);
  expect([400, 404]).toContain((await Transfer(A.Token, Huge, "كريم", "01012341234")).Status);
});

test("r10: a transfer racing the gate scan of the old code: only one of them happens", async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
  const A = await NewCompany();
  const { E, Tickets } = await Bought(A.Token, A.CompanyId, 6);
  At("2026-12-20T17:00:00Z");
  for (const T of Tickets) {
    const [Moved, Scanned] = await Promise.all([Transfer(A.Token, T.Id, "سارة", "01098765432"), CheckIn(A.Token, E.Sessions[0], T.Code)]);
    expect([Created(Moved.Status), Scanned.Status === 200].filter(Boolean).length).toBe(1);
    const Now = (await GetTicket(A.Token, T.Id)).Body.Data;
    if (Scanned.Status === 200) expect(Now.Code).toBe(T.Code);
    else expect(Now.Status).toBe("Valid");
  }
});
