import { beforeEach, expect, test } from "bun:test";
import { QueryStats } from "../../Src/Database/Db";
import { Call, NewCompany, NewCustomer, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
});

async function At(When: string, Total = "10.00", Status = "Paid", CompanyId = A.CompanyId, CustomerId = Customer) {
  await Sql(`INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total","CreatedAt") VALUES ($1,$2,$3,'0','0',$4,$5)`, [CompanyId, CustomerId, Status, Total, When]);
}

const Report = (Month: string, Token = A.Token) => Call("GET", `/Reports/Monthly?Month=${Month}`, { Token });

test("March follows Cairo midnight, not UTC midnight", async () => {
  await At("2026-02-28T21:59:00Z", "1.00");
  await At("2026-02-28T22:30:00Z", "2.00");
  await At("2026-03-15T10:00:00Z", "4.00");
  await At("2026-03-31T21:59:00Z", "8.00");
  await At("2026-03-31T22:00:00Z", "16.00");
  const Res = await Report("2026-03");
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.OrdersCount).toBe(3);
  expect(Res.Body.Data.Revenue).toBe("14.00");
  const Days = Res.Body.Data.Days;
  expect(Days.length).toBe(31);
  expect(Days[0]).toMatchObject({ Date: "2026-03-01", OrdersCount: 1, Revenue: "2.00" });
  expect(Days[30]).toMatchObject({ Date: "2026-03-31", OrdersCount: 1, Revenue: "8.00" });
});

test("summer months follow Cairo daylight saving time", async () => {
  await At("2026-06-30T20:59:00Z", "1.00");
  await At("2026-06-30T21:30:00Z", "2.00");
  await At("2026-07-31T20:59:00Z", "4.00");
  await At("2026-07-31T21:30:00Z", "8.00");
  const Res = await Report("2026-07");
  expect(Res.Body.Data.Revenue).toBe("6.00");
  expect(Res.Body.Data.Days[0]).toMatchObject({ Date: "2026-07-01", Revenue: "2.00" });
  expect(Res.Body.Data.Days[30]).toMatchObject({ Date: "2026-07-31", Revenue: "4.00" });
  const June = await Report("2026-06");
  expect(June.Body.Data.Revenue).toBe("1.00");
  expect(June.Body.Data.Days.length).toBe(30);
});

test("cancelled orders and other companies stay out; pending orders count but earn nothing", async () => {
  await At("2026-03-10T10:00:00Z", "5.00", "Pending");
  await At("2026-03-10T11:00:00Z", "7.00", "Cancelled");
  await At("2026-03-10T12:00:00Z", "0.10", "Paid");
  await At("2026-03-10T13:00:00Z", "0.20", "Paid");
  const B = await NewCompany();
  const BC = await NewCustomer(B.CompanyId);
  await At("2026-03-10T12:00:00Z", "999.00", "Paid", B.CompanyId, BC);
  const Res = await Report("2026-03");
  expect(Res.Body.Data.OrdersCount).toBe(3);
  expect(Res.Body.Data.Revenue).toBe("0.30");
  expect(Res.Body.Data.Days[9]).toMatchObject({ Date: "2026-03-10", OrdersCount: 3, Revenue: "0.30" });
});

test("a busy month is reported with a small constant number of queries", async () => {
  await Sql(
    `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total","CreatedAt")
     SELECT $1, $2, CASE WHEN g % 5 = 0 THEN 'Cancelled' ELSE 'Paid' END, '0', '0', ((g % 9) + 1)::numeric / 10, timestamptz '2026-02-27 00:00:00+00' + g * interval '2 minutes'
     FROM generate_series(1, 25000) g`,
    [A.CompanyId, Customer],
  );
  QueryStats.Reset();
  const Res = await Report("2026-03");
  expect(Res.Status).toBe(200);
  expect(QueryStats.Count).toBeLessThanOrEqual(4);
  const [Truth] = await Sql<{ N: number; R: string }>(
    `SELECT count(*) FILTER (WHERE "Status" <> 'Cancelled')::int AS "N", coalesce(sum("Total") FILTER (WHERE "Status" = 'Paid'), 0)::numeric(12,2)::text AS "R"
     FROM "Orders" WHERE "CreatedAt" >= timestamptz '2026-02-28 22:00:00+00' AND "CreatedAt" < timestamptz '2026-03-31 22:00:00+00'`,
  );
  expect(Res.Body.Data.OrdersCount).toBe(Truth.N);
  expect(Res.Body.Data.Revenue).toBe(Truth.R);
}, 60000);
