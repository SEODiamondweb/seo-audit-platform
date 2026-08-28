export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function countWords(value: string): number {
  const normalized = collapseWhitespace(value);
  if (!normalized) return 0;
  return normalized.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)) + '…';
}

/** Hash stabile e corto: usato per generare gli id degli audit. */
export function shortHash(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return part / total;
}

export function formatPercent(ratio: number, digits = 1): string {
  return (ratio * 100).toFixed(digits).replace(/\.0+$/, '') + '%';
}
