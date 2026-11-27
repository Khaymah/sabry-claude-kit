const Formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function Parts(At: Date) {
  const P = Object.fromEntries(Formatter.formatToParts(At).map((X) => [X.type, X.value]));
  return { Year: Number(P.year), Month: Number(P.month), Day: Number(P.day), Hour: Number(P.hour), Minute: Number(P.minute), Second: Number(P.second) };
}

function OffsetMs(At: Date) {
  const P = Parts(At);
  const Whole = Math.floor(At.getTime() / 1000) * 1000;
  return Date.UTC(P.Year, P.Month - 1, P.Day, P.Hour, P.Minute, P.Second) - Whole;
}

export function CairoDate(At: Date) {
  const P = Parts(At);
  return `${P.Year}-${String(P.Month).padStart(2, "0")}-${String(P.Day).padStart(2, "0")}`;
}

export function CairoInstant(DateText: string, Time: string) {
  const [Y, M, D] = DateText.split("-").map(Number);
  const [H, Min] = Time.split(":").map(Number);
  const Wall = Date.UTC(Y, M - 1, D, H, Min);
  let Guess = Wall - OffsetMs(new Date(Wall));
  const Second = Wall - OffsetMs(new Date(Guess));
  if (Second !== Guess) Guess = Second;
  return new Date(Guess);
}

export function AddDays(DateText: string, Days: number) {
  const [Y, M, D] = DateText.split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D + Days)).toISOString().slice(0, 10);
}

export function IsFriday(DateText: string) {
  const [Y, M, D] = DateText.split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D)).getUTCDay() === 5;
}

export function WorkingDays(From: string, To: string) {
  let Count = 0;
  for (let Day = From; Day <= To; Day = AddDays(Day, 1)) if (!IsFriday(Day)) Count++;
  return Count;
}
