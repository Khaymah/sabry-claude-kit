import { afterAll, expect, setSystemTime, test } from "bun:test";
import { At, BuyOk, Call, CancelEvent, Money, NewCompany, NewCustomer, NewEvent, NewOrganizer, PayoutOk, PromoOk, Reset } from "../_Support";

afterAll(() => setSystemTime());

const Night = ["2027-01-20T18:00:00Z"];

test("r11: events created from the first of January in Cairo pay 7% + 2.00 per ticket, older events keep 10%", async () => {
  await Reset();
  At("2026-12-31T21:30:00Z");
  const A = await NewCompany();
  const O = await NewOrganizer(A.Token);
  const Customer = await NewCustomer(A.CompanyId);
  const Old = await NewEvent(A.Token, O, Night, [{ Name: "Regular", Price: "33.33", Capacity: 50 }]);
  At("2026-12-31T22:30:00Z");
  const New = await NewEvent(A.Token, O, Night, [{ Name: "Regular", Price: "33.33", Capacity: 50 }]);
  const OldRead = (await Call("GET", `/Events/${Old.Id}`, { Token: A.Token })).Body.Data;
  const NewRead = (await Call("GET", `/Events/${New.Id}`, { Token: A.Token })).Body.Data;
  expect(Number(OldRead.FeePercent)).toBe(10);
  expect(Money(OldRead.FeeFixed)).toBe(0);
  expect(Number(NewRead.FeePercent)).toBe(7);
  expect(Money(NewRead.FeeFixed)).toBe(200);
  At("2027-01-05T10:00:00Z");
  await PromoOk(A.Token, Old.Id, "P15", 15);
  await BuyOk(A.Token, Old.Sessions[0], Old.Categories[0], Customer, 3, "P15");
  await BuyOk(A.Token, New.Sessions[0], New.Categories[0], Customer, 3);
  expect(await PayoutOk(A.Token, O, "2027-01-05", "2027-01-05")).toEqual({ Sales: 8502 + 9999, Refunds: 0, Fee: 849 + 1299, Net: 8502 + 9999 - 849 - 1299 });
});

test("r11: the new fee never exceeds the ticket price and free tickets pay nothing", async () => {
  await Reset();
  At("2027-01-02T10:00:00Z");
  const A = await NewCompany();
  const O = await NewOrganizer(A.Token);
  const Customer = await NewCustomer(A.CompanyId);
  const Cheap = await NewEvent(A.Token, O, Night, [{ Name: "Cheap", Price: "1.50", Capacity: 50 }]);
  const Free = await NewEvent(A.Token, O, Night, [{ Name: "Guest", Price: "80.00", Capacity: 50 }]);
  await PromoOk(A.Token, Free.Id, "GUEST", 100);
  await BuyOk(A.Token, Cheap.Sessions[0], Cheap.Categories[0], Customer, 2);
  const Guests = await BuyOk(A.Token, Free.Sessions[0], Free.Categories[0], Customer, 2, "GUEST");
  expect(Money(Guests.Total)).toBe(0);
  expect(await PayoutOk(A.Token, O, "2027-01-02", "2027-01-02")).toEqual({ Sales: 300, Refunds: 0, Fee: 300, Net: 0 });
});

test("r11: the change does not touch reports of the old fee and a cancelled new event still pays no fee", async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
  const A = await NewCompany();
  const O = await NewOrganizer(A.Token);
  const Customer = await NewCustomer(A.CompanyId);
  const Old = await NewEvent(A.Token, O, Night, [{ Name: "Regular", Price: "10.15", Capacity: 50 }]);
  await BuyOk(A.Token, Old.Sessions[0], Old.Categories[0], Customer, 4);
  At("2027-01-10T10:00:00Z");
  const New = await NewEvent(A.Token, O, Night, [{ Name: "Regular", Price: "10.15", Capacity: 50 }]);
  await BuyOk(A.Token, New.Sessions[0], New.Categories[0], Customer, 4);
  await BuyOk(A.Token, Old.Sessions[0], Old.Categories[0], Customer, 1);
  expect(await PayoutOk(A.Token, O, "2026-12-01", "2026-12-01")).toEqual({ Sales: 4060, Refunds: 0, Fee: 404, Net: 3656 });
  expect(await PayoutOk(A.Token, O, "2027-01-10", "2027-01-10")).toEqual({ Sales: 5075, Refunds: 0, Fee: 4 * 271 + 101, Net: 5075 - 4 * 271 - 101 });
  At("2027-01-11T10:00:00Z");
  await CancelEvent(A.Token, New.Id);
  expect(await PayoutOk(A.Token, O, "2027-01-10", "2027-01-10")).toEqual({ Sales: 5075, Refunds: 0, Fee: 101, Net: 4974 });
});
