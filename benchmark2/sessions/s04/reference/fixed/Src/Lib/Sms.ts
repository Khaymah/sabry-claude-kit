import { GetSetting } from "../Modules/Settings/Settings.Service";

export async function SendSms(To: string, Text: string, Reference: string): Promise<boolean> {
  const BaseUrl = await GetSetting<string>("Sms.BaseUrl", "");
  const ApiKey = await GetSetting<string>("Sms.ApiKey", "");
  const TimeoutMs = await GetSetting<number>("Sms.TimeoutMs", 3000);
  if (!BaseUrl || !ApiKey) return false;
  const Controller = new AbortController();
  const Timer = setTimeout(() => Controller.abort(), TimeoutMs);
  try {
    const Res = await fetch(`${BaseUrl}/v1/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ To, Text, Reference }),
      signal: Controller.signal,
    });
    return Res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(Timer);
  }
}
