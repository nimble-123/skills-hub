/** Small formatters shared by the detail views. */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * A rough token count, from characters.
 *
 * Four characters to a token is the same approximation the Obsidian plugin
 * uses. It is not a tokeniser and does not claim to be — the number is there
 * to compare items against each other, not to predict a bill.
 */
export function estimateTokens(characters: number): string {
  const estimate = Math.round(characters / 4);
  return estimate >= 1000 ? `~${(estimate / 1000).toFixed(1)}k` : `~${estimate}`;
}

/** A date the way someone reads it, from the RFC 3339 the backend sends. */
export function formatDate(rfc3339: string | null): string {
  if (!rfc3339) return "unknown";
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
