import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  constructor(
    public Status: ContentfulStatusCode,
    public Code: string,
    Message: string,
    public Details?: Record<string, unknown>,
  ) {
    super(Message);
  }
}

export function Ok<T>(C: Context, Data: T, Status: ContentfulStatusCode = 200) {
  return C.json({ Success: true, Data }, Status);
}

export function Fail(C: Context, Status: ContentfulStatusCode, Code: string, Message: string, Details?: Record<string, unknown>) {
  return C.json({ Success: false, Error: { Code, Message, ...(Details ?? {}) } }, Status);
}
