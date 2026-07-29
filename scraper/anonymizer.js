// "John Smith" -> "John S." ; single-token / emoji-only / empty -> "Anonymous".
// Mirrors the Titan-side copy in lib/actions/reviews-amazon.js (D-07) — this VPS-side
// copy runs first so raw full names never leave the scraper.
export function anonymizeAuthor(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Anonymous';
  const trimmed = fullName.trim();
  if (!trimmed) return 'Anonymous';
  if (!/[a-zA-Z]/.test(trimmed)) return 'Anonymous';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase();
  return lastInitial ? `${first} ${lastInitial}.` : first;
}
