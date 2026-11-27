import { z } from "zod";
import { Now } from "./Clock";

export const RowId = z.number().int().positive().max(2_147_483_647);

export const DateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((V) => {
    const D = new Date(`${V}T00:00:00Z`);
    return !Number.isNaN(D.getTime()) && D.toISOString().slice(0, 10) === V;
  }, "must be a real date");

export const MaxPiasters = 999_999_999_999n;

export function HalfUp(Numerator: bigint, Denominator: bigint): bigint {
  return (Numerator * 2n + Denominator) / (2n * Denominator);
}

export function PiastersText(Value: bigint): string {
  const Abs = Value < 0n ? -Value : Value;
  return `${Value < 0n ? "-" : ""}${Abs / 100n}.${String(Abs % 100n).padStart(2, "0")}`;
}

export function TextPiasters(Value: string): bigint {
  const Match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(Value.trim());
  if (!Match) throw new Error(`Invalid money value: ${Value}`);
  const P = BigInt(Match[2]) * 100n + BigInt((Match[3] ?? "").padEnd(2, "0"));
  return Match[1] ? -P : P;
}

export function Today(): string {
  return Now().toISOString().slice(0, 10);
}

export function AddDays(Day: string, Days: number): string {
  const D = new Date(`${Day}T00:00:00Z`);
  D.setUTCDate(D.getUTCDate() + Days);
  return D.toISOString().slice(0, 10);
}
