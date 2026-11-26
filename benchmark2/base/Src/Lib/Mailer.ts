export type Email = { To: string; Subject: string; Body: string };

export const Outbox: Email[] = [];

export async function SendEmail(Message: Email) {
  Outbox.push(Message);
}
