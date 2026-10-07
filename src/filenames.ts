export function isWindowsReservedFilename(value: string): boolean {
  const stem = value.split(".")[0]?.trimEnd() ?? "";
  return /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(stem);
}

export function sanitizeFilename(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "");
  return isWindowsReservedFilename(cleaned) ? `_${cleaned}` : cleaned;
}

export function defaultOutputFilename(title: string, documentId: string): string {
  return `${sanitizeFilename(title) || documentId}.pdf`;
}
