/**
 * Classificazione dei crawler dal loro user agent e verifica di autenticità.
 *
 * Lo user agent è auto-dichiarato: chiunque può presentarsi come Googlebot. Per i bot che
 * contano (Google, Bing) l'autenticità si verifica contro gli intervalli IP che i due
 * motori pubblicano ufficialmente. Un "Googlebot" fuori da quegli intervalli è uno
 * scraper travestito — informazione utile di suo.
 */

export type BotGroup = 'search' | 'ai' | 'seo-tool' | 'social' | 'other-bot';

export interface BotFamily {
  name: string;
  group: BotGroup;
  pattern: RegExp;
  /** true per i bot di cui esistono intervalli IP ufficiali da verificare. */
  verifiable?: 'google' | 'bing';
}

/**
 * L'ordine conta: il primo pattern che corrisponde vince, quindi i più specifici
 * (AdsBot, Googlebot-Image) precedono quelli generici (Googlebot).
 */
export const BOT_FAMILIES: BotFamily[] = [
  // ── Motori di ricerca ──
  { name: 'Googlebot Immagini', group: 'search', pattern: /Googlebot-Image/i, verifiable: 'google' },
  { name: 'Googlebot Video', group: 'search', pattern: /Googlebot-Video/i, verifiable: 'google' },
  { name: 'Googlebot News', group: 'search', pattern: /Googlebot-News/i, verifiable: 'google' },
  { name: 'Google AdsBot', group: 'search', pattern: /AdsBot-Google/i, verifiable: 'google' },
  { name: 'Google AdSense', group: 'search', pattern: /Mediapartners-Google/i, verifiable: 'google' },
  { name: 'Google Inspection Tool', group: 'search', pattern: /Google-InspectionTool/i, verifiable: 'google' },
  { name: 'GoogleOther', group: 'search', pattern: /GoogleOther/i, verifiable: 'google' },
  { name: 'Googlebot', group: 'search', pattern: /Googlebot/i, verifiable: 'google' },
  { name: 'Bingbot', group: 'search', pattern: /bingbot|BingPreview|adidxbot/i, verifiable: 'bing' },
  { name: 'DuckDuckBot', group: 'search', pattern: /DuckDuckBot|DuckDuckGo/i },
  { name: 'YandexBot', group: 'search', pattern: /YandexBot|YandexImages/i },
  { name: 'Baiduspider', group: 'search', pattern: /Baiduspider/i },
  { name: 'Applebot', group: 'search', pattern: /Applebot/i },
  { name: 'SeznamBot', group: 'search', pattern: /SeznamBot/i },

  // ── Crawler AI ──
  { name: 'GPTBot (OpenAI)', group: 'ai', pattern: /GPTBot/i },
  { name: 'OAI-SearchBot (OpenAI)', group: 'ai', pattern: /OAI-SearchBot/i },
  { name: 'ChatGPT-User (OpenAI)', group: 'ai', pattern: /ChatGPT-User/i },
  { name: 'ClaudeBot (Anthropic)', group: 'ai', pattern: /ClaudeBot|Claude-Web|anthropic-ai/i },
  { name: 'Claude-User (Anthropic)', group: 'ai', pattern: /Claude-User|Claude-SearchBot/i },
  { name: 'PerplexityBot', group: 'ai', pattern: /PerplexityBot|Perplexity-User/i },
  { name: 'Google-Extended (Gemini)', group: 'ai', pattern: /Google-Extended/i },
  { name: 'Meta AI', group: 'ai', pattern: /meta-externalagent|meta-externalfetcher|FacebookBot/i },
  { name: 'Bytespider (ByteDance)', group: 'ai', pattern: /Bytespider/i },
  { name: 'CCBot (Common Crawl)', group: 'ai', pattern: /CCBot/i },
  { name: 'Amazonbot', group: 'ai', pattern: /Amazonbot/i },
  { name: 'Mistral', group: 'ai', pattern: /MistralAI/i },

  // ── Tool SEO ──
  { name: 'AhrefsBot', group: 'seo-tool', pattern: /AhrefsBot|AhrefsSiteAudit/i },
  { name: 'SemrushBot', group: 'seo-tool', pattern: /SemrushBot|SiteAuditBot/i },
  { name: 'Majestic (MJ12bot)', group: 'seo-tool', pattern: /MJ12bot/i },
  { name: 'Moz (DotBot/rogerbot)', group: 'seo-tool', pattern: /DotBot|rogerbot/i },
  { name: 'Screaming Frog', group: 'seo-tool', pattern: /Screaming Frog/i },
  { name: 'Sistrix', group: 'seo-tool', pattern: /sistrix/i },
  { name: 'Seobility', group: 'seo-tool', pattern: /seobility/i },
  { name: 'DataForSEO', group: 'seo-tool', pattern: /DataForSeoBot/i },

  // ── Anteprime social e messaggistica ──
  { name: 'Facebook (anteprime)', group: 'social', pattern: /facebookexternalhit|facebookcatalog/i },
  { name: 'WhatsApp', group: 'social', pattern: /WhatsApp/i },
  { name: 'Twitterbot / X', group: 'social', pattern: /Twitterbot/i },
  { name: 'LinkedInBot', group: 'social', pattern: /LinkedInBot/i },
  { name: 'TelegramBot', group: 'social', pattern: /TelegramBot/i },
  { name: 'Slackbot', group: 'social', pattern: /Slackbot/i },
  { name: 'Discordbot', group: 'social', pattern: /Discordbot/i },
  { name: 'Pinterest', group: 'social', pattern: /Pinterestbot/i },

  // ── Altri bot dichiarati ──
  { name: 'UptimeRobot', group: 'other-bot', pattern: /UptimeRobot/i },
  { name: 'Wayback Machine', group: 'other-bot', pattern: /archive\.org_bot|ia_archiver/i },
  { name: 'PetalBot (Huawei)', group: 'other-bot', pattern: /PetalBot/i },
];

export const GROUP_LABELS: Record<BotGroup, string> = {
  search: 'Motori di ricerca',
  ai: 'Crawler AI',
  'seo-tool': 'Tool SEO',
  social: 'Anteprime social',
  'other-bot': 'Altri bot',
};

export function classifyBot(userAgent: string): BotFamily | null {
  if (!userAgent) return null;
  for (const family of BOT_FAMILIES) {
    if (family.pattern.test(userAgent)) return family;
  }
  return null;
}

// ── Verifica IP contro gli intervalli ufficiali ──────────────────────────────

/** Un intervallo CIDR già convertito in coppia (inizio, fine) su BigInt. */
interface CidrRange {
  start: bigint;
  end: bigint;
  v6: boolean;
}

export function ipToBigInt(ip: string): { value: bigint; v6: boolean } | null {
  if (ip.includes(':')) {
    // IPv6, con gestione della forma compressa "::".
    const parts = ip.split('::');
    if (parts.length > 2) return null;
    const head = parts[0] ? (parts[0] as string).split(':') : [];
    const tail = parts.length === 2 && parts[1] ? (parts[1] as string).split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0 && parts.length === 2) return null;
    const groups = parts.length === 2 ? [...head, ...Array(missing).fill('0'), ...tail] : head;
    if (groups.length !== 8) return null;

    let value = 0n;
    for (const group of groups) {
      const n = Number.parseInt(group === '' ? '0' : group, 16);
      if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
      value = (value << 16n) | BigInt(n);
    }
    return { value, v6: true };
  }

  const octets = ip.split('.');
  if (octets.length !== 4) return null;
  let value = 0n;
  for (const octet of octets) {
    const n = Number(octet);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return { value, v6: false };
}

export function parseCidr(cidr: string): CidrRange | null {
  const [ipPart, prefixPart] = cidr.split('/');
  if (!ipPart || !prefixPart) return null;
  const base = ipToBigInt(ipPart);
  if (!base) return null;

  const bits = base.v6 ? 128 : 32;
  const prefix = Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;

  const hostBits = BigInt(bits - prefix);
  const start = (base.value >> hostBits) << hostBits;
  const end = start | ((1n << hostBits) - 1n);
  return { start, end, v6: base.v6 };
}

export class IpRangeSet {
  private readonly ranges: CidrRange[] = [];

  add(cidr: string): void {
    const range = parseCidr(cidr);
    if (range) this.ranges.push(range);
  }

  get size(): number {
    return this.ranges.length;
  }

  contains(ip: string): boolean {
    const parsed = ipToBigInt(ip);
    if (!parsed) return false;
    return this.ranges.some(
      (r) => r.v6 === parsed.v6 && parsed.value >= r.start && parsed.value <= r.end,
    );
  }
}

/** Sorgenti ufficiali degli intervalli IP dei crawler verificabili. */
export const OFFICIAL_RANGE_SOURCES: Record<'google' | 'bing', string[]> = {
  google: [
    'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
    'https://developers.google.com/static/search/apis/ipranges/special-crawlers.json',
  ],
  bing: ['https://www.bing.com/toolbox/bingbot.json'],
};

interface RangesJson {
  prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[];
}

/**
 * Scarica gli intervalli ufficiali. In caso di errore di rete ritorna null: la verifica
 * risulterà "non eseguita" invece di marcare falsi tutti i bot — meglio nessun verdetto
 * che un verdetto sbagliato.
 */
export async function fetchOfficialRanges(
  who: 'google' | 'bing',
  timeoutMs = 15000,
): Promise<IpRangeSet | null> {
  const set = new IpRangeSet();

  for (const url of OFFICIAL_RANGE_SOURCES[who]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const json = (await response.json()) as RangesJson;
      for (const prefix of json.prefixes ?? []) {
        const cidr = prefix.ipv4Prefix ?? prefix.ipv6Prefix;
        if (cidr) set.add(cidr);
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return set.size > 0 ? set : null;
}
