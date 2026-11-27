import { GetSetting } from "../Settings/Settings.Service";

export type ChargeRequest = { Amount: number; Currency: string; CardToken: string; Reference: string };
export type ChargeOutcome =
  | { Kind: "Succeeded"; ChargeId: string }
  | { Kind: "Declined" }
  | { Kind: "Rejected"; Status: number }
  | { Kind: "Unknown" };

const Sleep = (Ms: number) => new Promise((Resolve) => setTimeout(Resolve, Ms));

export async function Charge(IdempotencyKey: string, Request: ChargeRequest): Promise<ChargeOutcome> {
  const BaseUrl = await GetSetting<string>("Gateway.BaseUrl", "");
  const ApiKey = await GetSetting<string>("Gateway.ApiKey", "");
  const TimeoutMs = await GetSetting<number>("Gateway.TimeoutMs", 5000);
  const MaxAttempts = Math.max(1, await GetSetting<number>("Gateway.MaxAttempts", 3));
  const RetryDelayMs = await GetSetting<number>("Gateway.RetryDelayMs", 200);
  if (!BaseUrl || !ApiKey) return { Kind: "Rejected", Status: 0 };
  for (let Attempt = 1; Attempt <= MaxAttempts; Attempt++) {
    const Controller = new AbortController();
    const Timer = setTimeout(() => Controller.abort(), TimeoutMs);
    try {
      const Res = await fetch(`${BaseUrl.replace(/\/$/, "")}/v1/charges`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ApiKey}`, "Idempotency-Key": IdempotencyKey, "Content-Type": "application/json" },
        body: JSON.stringify(Request),
        signal: Controller.signal,
      });
      if (Res.ok) {
        const Body = (await Res.json()) as { Id: string };
        return { Kind: "Succeeded", ChargeId: String(Body.Id) };
      }
      if (Res.status === 402) return { Kind: "Declined" };
      if (Res.status !== 429 && Res.status < 500) return { Kind: "Rejected", Status: Res.status };
    } catch {
    } finally {
      clearTimeout(Timer);
    }
    if (Attempt < MaxAttempts) await Sleep(RetryDelayMs * Attempt);
  }
  return { Kind: "Unknown" };
}
