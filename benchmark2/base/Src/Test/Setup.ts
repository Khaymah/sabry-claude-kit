import { Client } from "../Database/Db";
import { Migrate } from "../Database/Migrations";
import { App } from "../App";

export async function ResetDatabase(Options: { UpTo?: string } = {}) {
  await Client.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await Migrate(Client, Options);
}

export type ApiResult = { Status: number; Body: any; Headers: Headers; Text: string };

export async function Api(
  Method: string,
  Path: string,
  Options: { Token?: string; Body?: unknown; Headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const Headers: Record<string, string> = { ...(Options.Headers ?? {}) };
  if (Options.Token) Headers.Authorization = `Bearer ${Options.Token}`;
  let Body: BodyInit | undefined;
  if (Options.Body !== undefined) {
    Body = typeof Options.Body === "string" ? Options.Body : JSON.stringify(Options.Body);
    Headers["Content-Type"] ??= "application/json";
  }
  const Res = await App.request(Path, { method: Method, headers: Headers, body: Body });
  const Text = await Res.text();
  let Parsed: any = null;
  try {
    Parsed = JSON.parse(Text);
  } catch {}
  return { Status: Res.status, Body: Parsed, Headers: Res.headers, Text };
}
