export function sanitizeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "");
}

export function defaultOutputFilename(title: string, documentId: string): string {
  return `${sanitizeFilename(title) || documentId}.pdf`;
}
