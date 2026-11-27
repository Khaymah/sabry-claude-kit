export function ParseCsv(Text: string): string[][] {
  const Records: string[][] = [];
  let Record: string[] = [];
  let Field = "";
  let Quoted = false;
  for (let I = 0; I < Text.length; I++) {
    const Ch = Text[I];
    if (Quoted) {
      if (Ch === '"' && Text[I + 1] === '"') {
        Field += '"';
        I++;
      } else if (Ch === '"') Quoted = false;
      else Field += Ch;
    } else if (Ch === '"') Quoted = true;
    else if (Ch === ",") {
      Record.push(Field);
      Field = "";
    } else if (Ch === "\n" || Ch === "\r") {
      if (Ch === "\r" && Text[I + 1] === "\n") I++;
      Record.push(Field);
      Records.push(Record);
      Record = [];
      Field = "";
    } else Field += Ch;
  }
  if (Field !== "" || Record.length > 0) {
    Record.push(Field);
    Records.push(Record);
  }
  return Records;
}

export function ToCsv(Rows: string[][]): string {
  return Rows.map((Row) => Row.map((V) => (/[",\r\n]/.test(V) ? `"${V.replace(/"/g, '""')}"` : V)).join(",")).join("\r\n") + "\r\n";
}
