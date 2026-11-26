import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { AppError, Ok } from "../../Lib/Response";
import { Q } from "../Subscriptions/Subscriptions.Service";

const Offset = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "longOffset" });

function OffsetMs(At: number) {
  const Name = Offset.formatToParts(new Date(At)).find((P) => P.type === "timeZoneName")?.value ?? "GMT";
  const Match = /GMT([+-])(\d{2}):(\d{2})/.exec(Name);
  if (!Match) return 0;
  return (Match[1] === "-" ? -1 : 1) * (Number(Match[2]) * 60 + Number(Match[3])) * 60_000;
}

function CairoMidnight(Day: string) {
  const Wall = Date.parse(`${Day}T00:00:00Z`);
  const First = Wall - OffsetMs(Wall);
  return new Date(Wall - OffsetMs(First));
}

function ValidDay(Value: string | undefined) {
  if (!Value || !/^\d{4}-\d{2}-\d{2}$/.test(Value)) return null;
  const D = new Date(`${Value}T00:00:00Z`);
  return !Number.isNaN(D.getTime()) && D.toISOString().slice(0, 10) === Value ? Value : null;
}

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);
ReportsRoutes.get("/DailyRevenue", async (C) => {
  const Day = ValidDay(C.req.query("Date"));
  if (!Day) throw new AppError(400, "VALIDATION_ERROR", "Date must be YYYY-MM-DD");
  const Next = new Date(Date.parse(`${Day}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
  const Rows = await Q<{ Direction: string; Total: string }>(
    `SELECT "Direction", sum("Piasters")::text AS "Total" FROM "MoneyMovements" WHERE "CompanyId" = $1 AND "At" >= $2 AND "At" < $3 GROUP BY "Direction"`,
    [C.get("Auth").CompanyId, CairoMidnight(Day), CairoMidnight(Next)],
  );
  const Of = (Direction: string) => Number(Rows.find((R) => R.Direction === Direction)?.Total ?? 0);
  const Collected = Of("In");
  const Refunded = Of("Out");
  return Ok(C, { Date: Day, Collected, Refunded, Net: Collected - Refunded });
});
