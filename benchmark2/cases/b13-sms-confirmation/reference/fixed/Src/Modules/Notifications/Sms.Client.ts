import { GetSetting } from "../Settings/Settings.Service";

export type SmsResult = { Ok: true; Attempts: number; MessageId: string } | { Ok: false; Attempts: number; Reason: string };

const Sleep = (Ms: number) => new Promise((Resolve) => setTimeout(Resolve, Ms));

export async function SendSms(To: string, Text: string, Reference: string): Promise<SmsResult> {
  const BaseUrl = await GetSetting<string>("Sms.BaseUrl", "");
  const ApiKey = await GetSetting<string>("Sms.ApiKey", "");
  const TimeoutMs = await GetSetting<number>("Sms.TimeoutMs", 3000);
  const MaxAttempts = Math.max(1, await GetSetting<number>("Sms.MaxAttempts", 3));
  const RetryDelayMs = await GetSetting<number>("Sms.RetryDelayMs", 200);
  if (!BaseUrl || !ApiKey) return { Ok: false, Attempts: 0, Reason: "SMS provider is not configured" };
  let Reason = "";
  for (let Attempt = 1; Attempt <= MaxAttempts; Attempt++) {
    const Controller = new AbortController();
    const Timer = setTimeout(() => Controller.abort(), TimeoutMs);
    try {
      const Res = await fetch(`${BaseUrl.replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ To, Text, Reference }),
        signal: Controller.signal,
      });
      if (Res.ok) {
        const Body = (await Res.json()) as { Id?: string };
        return { Ok: true, Attempts: Attempt, MessageId: String(Body.Id ?? "") };
      }
      Reason = `Provider responded ${Res.status}`;
      if (Res.status !== 429 && Res.status < 500) return { Ok: false, Attempts: Attempt, Reason };
    } catch (Err) {
      Reason = Controller.signal.aborted ? "Provider timed out" : `Network error: ${(Err as Error).message}`;
    } finally {
      clearTimeout(Timer);
    }
    if (Attempt < MaxAttempts) await Sleep(RetryDelayMs * Attempt);
  }
  return { Ok: false, Attempts: MaxAttempts, Reason };
}
