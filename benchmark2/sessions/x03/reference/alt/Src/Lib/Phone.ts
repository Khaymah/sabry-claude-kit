export function PhoneKey(Raw: string | null | undefined) {
  if (!Raw) return null;
  const Local = Raw.replace(/[\s().-]/g, "").replace(/^(\+20|0020)/, "0");
  return /^01[0125]\d{8}$/.test(Local) ? Local : null;
}
