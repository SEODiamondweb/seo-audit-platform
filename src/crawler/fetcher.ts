import type { RedirectHop } from './types';

export interface FetchOptions {
  userAgent: string;
  timeoutMs: number;
  maxRedirects?: number;
  method?: 'GET' | 'HEAD';
}

export interface FetchOutcome {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  responseTimeMs: number;
  redirectChain: RedirectHop[];
  redirectLoop: boolean;
  error: string | null;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function emptyOutcome(url: string, error: string, elapsed: number): FetchOutcome {
  return {
    requestedUrl: url,
    finalUrl: url,
    status: 0,
    statusText: 'Fetch Error',
    headers: {},
    body: '',
    bytes: 0,
    responseTimeMs: elapsed,
    redirectChain: [],
    redirectLoop: false,
    error,
  };
}

/**
 * Segue i redirect manualmente (`redirect: 'manual'`) per poter ricostruire la catena completa,
 * che è un dato di audit a sé: lunghezza catena, loop, hop http->https, ecc.
 */
export async function fetchUrl(url: string, options: FetchOptions): Promise<FetchOutcome> {
  const maxRedirects = options.maxRedirects ?? 10;
  const started = Date.now();
  const redirectChain: RedirectHop[] = [];
  const visited = new Set<string>([url]);

  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    let response: Response;
    try {
      response = await fetch(current, {
        method: options.method ?? 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': options.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'it-IT,it;q=0.9,en;q=0.8',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      const reason = message.includes('abort') ? `Timeout dopo ${options.timeoutMs}ms` : message;
      const outcome = emptyOutcome(url, reason, Date.now() - started);
      outcome.redirectChain = redirectChain;
      return outcome;
    }
    clearTimeout(timer);

    const headers = headersToObject(response.headers);
    const isRedirect = response.status >= 300 && response.status < 400 && !!headers['location'];

    if (isRedirect && hop < maxRedirects) {
      const location = headers['location'] as string;
      redirectChain.push({ url: current, status: response.status, location });

      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return {
          requestedUrl: url,
          finalUrl: current,
          status: response.status,
          statusText: response.statusText,
          headers,
          body: '',
          bytes: 0,
          responseTimeMs: Date.now() - started,
          redirectChain,
          redirectLoop: false,
          error: `Location non valida: ${location}`,
        };
      }

      if (visited.has(next)) {
        return {
          requestedUrl: url,
          finalUrl: next,
          status: response.status,
          statusText: response.statusText,
          headers,
          body: '',
          bytes: 0,
          responseTimeMs: Date.now() - started,
          redirectChain,
          redirectLoop: true,
          error: null,
        };
      }

      visited.add(next);
      current = next;
      // Il body del redirect non serve, ma va consumato per liberare il socket.
      try {
        await response.arrayBuffer();
      } catch {
        /* ignorato */
      }
      continue;
    }

    const contentType = headers['content-type'] ?? '';
    const isTextual = /text\/|application\/(xhtml|xml|json|ld\+json)/i.test(contentType);

    let body = '';
    let bytes = 0;
    try {
      const buffer = await response.arrayBuffer();
      bytes = buffer.byteLength;
      if (isTextual && bytes <= MAX_BODY_BYTES) {
        body = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      }
    } catch (err) {
      return {
        requestedUrl: url,
        finalUrl: current,
        status: response.status,
        statusText: response.statusText,
        headers,
        body: '',
        bytes: 0,
        responseTimeMs: Date.now() - started,
        redirectChain,
        redirectLoop: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      requestedUrl: url,
      finalUrl: current,
      status: response.status,
      statusText: response.statusText || '',
      headers,
      body,
      bytes,
      responseTimeMs: Date.now() - started,
      redirectChain,
      redirectLoop: false,
      error: null,
    };
  }

  const outcome = emptyOutcome(url, `Superato il limite di ${maxRedirects} redirect`, Date.now() - started);
  outcome.redirectChain = redirectChain;
  return outcome;
}
