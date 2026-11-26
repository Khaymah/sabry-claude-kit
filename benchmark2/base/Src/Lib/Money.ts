export function ToPiasters(Value: string | number): number {
  const Text = typeof Value === "number" ? Value.toFixed(2) : Value.trim();
  const Match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(Text);
  if (!Match) throw new Error(`Invalid money value: ${Value}`);
  const Piasters = Number(Match[2]) * 100 + Number((Match[3] ?? "").padEnd(2, "0"));
  return Match[1] ? -Piasters : Piasters;
}

export function FromPiasters(Piasters: number): string {
  const Sign = Piasters < 0 ? "-" : "";
  const Abs = Math.abs(Piasters);
  return `${Sign}${Math.floor(Abs / 100)}.${String(Abs % 100).padStart(2, "0")}`;
}
