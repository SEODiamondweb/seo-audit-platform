const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', '_ga', 'ref', 'igshid',
]);

const NON_HTML_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp',
  '.pdf', '.zip', '.rar', '.7z', '.gz', '.tar', '.dmg', '.exe', '.apk',
  '.mp3', '.mp4', '.avi', '.mov', '.webm', '.wav', '.ogg',
  '.css', '.js', '.json', '.xml', '.rss', '.woff', '.woff2', '.ttf', '.eot',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv',
]);

export function safeParseUrl(input: string, base?: string): URL | null {
  try {
    const url = new URL(input, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Normalizza una URL per la deduplica del crawl:
 * rimuove il fragment, i parametri di tracking, la porta di default e lo slash finale ridondante.
 * NON tocca il case del path (i server possono essere case-sensitive).
 */
export function normalizeUrl(input: string, base?: string): string | null {
  const url = safeParseUrl(input, base);
  if (!url) return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }

  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(param.toLowerCase())) url.searchParams.delete(param);
  }
  url.searchParams.sort();

  // Lo slash finale NON va rimosso: per il server fa parte dell'identità della risorsa.
  // WordPress e molti altri CMS redirigono /pagina verso /pagina/, quindi normalizzarlo via
  // trasformerebbe ogni URL del sito in un redirect, impedendo di analizzarne il contenuto.
  // Come Screaming Frog, /pagina e /pagina/ restano due URL distinte: se il sito le serve
  // entrambe, la cosa emerge come problema di redirect, che è esattamente il comportamento utile.
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');

  return url.toString();
}

export function registrableHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/** True se `candidate` appartiene al perimetro del crawl. */
export function isSameSite(candidate: URL, root: URL, includeSubdomains: boolean): boolean {
  const c = candidate.hostname.toLowerCase();
  const r = root.hostname.toLowerCase();
  if (c === r) return true;
  if (registrableHost(c) === registrableHost(r)) return true;
  if (!includeSubdomains) return false;
  return c.endsWith('.' + registrableHost(r));
}

export function looksLikeAsset(url: URL): boolean {
  const pathname = url.pathname.toLowerCase();
  const dot = pathname.lastIndexOf('.');
  if (dot === -1) return false;
  return NON_HTML_EXTENSIONS.has(pathname.slice(dot));
}

export function pathDepth(url: URL): number {
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length;
}

/** Path + query, troncato: usato nelle tabelle del report per non sfondare la colonna. */
export function shortPath(rawUrl: string, max = 70): string {
  const url = safeParseUrl(rawUrl);
  const value = url ? url.pathname + url.search : rawUrl;
  const path = value === '' ? '/' : value;
  return path.length <= max ? path : path.slice(0, max - 1) + '…';
}
