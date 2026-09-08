export function buildUrl(base: string, params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return base;
  const qs = new URLSearchParams(entries).toString();
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
}

export function toIsoDate(raw: string): string {
  // Handle Unix epoch integers (e.g. Arbeitnow created_at: 1788865797)
  const asNum = Number(raw);
  if (!isNaN(asNum) && asNum > 1_000_000_000 && asNum < 9_999_999_999) {
    return new Date(asNum * 1000).toISOString().slice(0, 10);
  }
  try { return new Date(raw).toISOString().slice(0, 10); }
  catch { return raw.slice(0, 10); }
}

/** Strip newlines from external strings before logging (CWE-117). */
export function sanitizeLog(v: unknown): string {
  return String(v).replace(/[\r\n\t]/g, ' ').slice(0, 300);
}

/**
 * Extracts a location string from free-text (title or description).
 * Checks for common patterns: "(Remote)", "London, UK", "Worldwide", etc.
 */
export function extractLocationFromText(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Explicit remote/worldwide signals
  if (/\b(remote|worldwide|anywhere|fully remote|100% remote|work from home|wfh|global)\b/.test(lower)) {
    return 'Remote';
  }

  // Parenthesised location: "(London)", "(UK)", "(United States)"
  const parenMatch = text.match(/\(([A-Za-z][A-Za-z ,]{2,40})\)/);
  if (parenMatch) return parenMatch[1]!.trim();

  // "Location: X" or "Based in X"
  const labelMatch = text.match(/(?:location|based in|located in)[:\s]+([A-Za-z][A-Za-z ,]{2,40})/i);
  if (labelMatch) return labelMatch[1]!.trim();

  return null;
}
