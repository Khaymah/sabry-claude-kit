export function NormalizeEgyptianPhone(Raw: string | null | undefined): string | null {
  if (!Raw) return null;
  const Latin = Raw.replace(/[٠-٩]/g, (D) => String(D.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (D) => String(D.charCodeAt(0) - 0x06f0));
  const Trimmed = Latin.trim();
  const Digits = Trimmed.replace(/[^\d]/g, "");
  if (/[^\d\s\-().+]/.test(Trimmed) || (Trimmed.includes("+") && !/^\+[^+]*$/.test(Trimmed))) return null;
  let National: string | null = null;
  if (Trimmed.startsWith("+")) National = Digits.startsWith("20") && Digits.length === 12 ? Digits.slice(2) : null;
  else if (Digits.startsWith("0020") && Digits.length === 14) National = Digits.slice(4);
  else if (Digits.startsWith("20") && Digits.length === 12) National = Digits.slice(2);
  else if (Digits.startsWith("0") && Digits.length === 11) National = Digits.slice(1);
  else if (Digits.length === 10) National = Digits;
  return National && /^1[0125]\d{8}$/.test(National) ? `+20${National}` : null;
}
