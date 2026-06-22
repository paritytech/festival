export function truncate(text: string, maxChars: number, ellipsis = '...'): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + ellipsis
}
