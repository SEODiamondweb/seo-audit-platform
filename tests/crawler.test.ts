import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawl } from '../src/crawler/crawler';
import { makeConfig } from './factories';

function page(body: string): string {
  return (
    '<!doctype html><html lang="it"><head><title>Pagina</title>' +
    '<meta name="description" content="descrizione"></head><body>' +
    body +
    '</body></html>'
  );
}

let server: http.Server;
let origin: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /privata\nSitemap: ' + origin + '/sitemap.xml\n');
      return;
    }

    if (url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          '<url><loc>' + origin + '/</loc></url>' +
          '<url><loc>' + origin + '/a</loc></url>' +
          '<url><loc>' + origin + '/orfana</loc></url>' +
          '</urlset>',
      );
      return;
    }

    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        page(
          '<h1>Home</h1>' +
            '<a href="/a">A</a><a href="/b">B</a>' +
            '<a href="/privata">Privata</a><a href="/vecchia">Vecchia</a>' +
            '<a href="/mancante">Mancante</a>' +
            '<a href="https://esterno.example/x">Esterno</a>',
        ),
      );
      return;
    }

    if (url === '/a' || url === '/b' || url === '/orfana') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('<h1>' + url + '</h1><a href="/">Home</a>'));
      return;
    }

    if (url === '/privata') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('<h1>Privata</h1>'));
      return;
    }

    if (url === '/vecchia') {
      res.writeHead(301, { location: '/a' });
      res.end();
      return;
    }

    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page('<h1>Non trovata</h1>'));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  origin = 'http://127.0.0.1:' + address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('crawler', () => {
  it('scansiona il sito rispettando robots, redirect e sitemap', async () => {
    const result = await crawl(
      makeConfig({ startUrl: origin + '/', maxUrls: 50, delayMs: 0, concurrency: 3 }),
    );

    const byUrl = new Map(result.pages.map((p) => [p.url.replace(origin, ''), p]));

    expect(byUrl.has('/')).toBe(true);
    expect(byUrl.has('/a')).toBe(true);
    expect(byUrl.has('/b')).toBe(true);

    expect(result.robots.found).toBe(true);
    expect(result.robots.sitemaps).toHaveLength(1);
    expect(result.sitemap.found).toBe(true);
    expect(result.sitemap.urls).toHaveLength(3);
  });

  it('non segnala come errore i percorsi di sitemap tentati alla cieca', async () => {
    // Il server risponde 404 su /sitemap_index.xml, /sitemap-index.xml e /wp-sitemap.xml:
    // sono tentativi del crawler, non sitemap dichiarate dal sito, quindi non sono anomalie.
    const result = await crawl(makeConfig({ startUrl: origin + '/', maxUrls: 50, delayMs: 0 }));
    expect(result.sitemap.errors).toEqual([]);
    expect(result.sitemap.sources).toHaveLength(1);
  });

  it('segnala invece gli errori delle sitemap dichiarate', async () => {
    const result = await crawl(
      makeConfig({
        startUrl: origin + '/',
        maxUrls: 5,
        delayMs: 0,
        sitemapUrl: origin + '/sitemap-inesistente.xml',
      }),
    );
    expect(result.sitemap.errors).toHaveLength(1);
    expect(result.sitemap.errors[0]).toContain('HTTP 404');
  });

  it('marca come bloccate le URL escluse dal robots.txt', async () => {
    const result = await crawl(makeConfig({ startUrl: origin + '/', maxUrls: 50, delayMs: 0 }));
    const privata = result.pages.find((p) => p.url.endsWith('/privata'));
    expect(privata?.indexabilityStatus).toBe('Blocked by robots.txt');
    expect(privata?.indexable).toBe(false);
  });

  it('scansiona le URL bloccate quando robots viene ignorato', async () => {
    const result = await crawl(
      makeConfig({ startUrl: origin + '/', maxUrls: 50, delayMs: 0, respectRobots: false }),
    );
    const privata = result.pages.find((p) => p.url.endsWith('/privata'));
    expect(privata?.statusCode).toBe(200);
  });

  it('ricostruisce la catena di redirect', async () => {
    const result = await crawl(makeConfig({ startUrl: origin + '/', maxUrls: 50, delayMs: 0 }));
    const vecchia = result.pages.find((p) => p.url.endsWith('/vecchia'));
    expect(vecchia?.redirectChain).toHaveLength(1);
    expect(vecchia?.redirectChain[0]?.status).toBe(301);
    expect(vecchia?.finalUrl).toBe(origin + '/a');
  });

  it('registra le URL in errore', async () => {
    const result = await crawl(makeConfig({ startUrl: origin + '/', maxUrls: 50, delayMs: 0 }));
    const mancante = result.pages.find((p) => p.url.endsWith('/mancante'));
    expect(mancante?.statusCode).toBe(404);
  });

  it('non esce dal dominio di partenza', async () => {
    const result = await crawl(makeConfig({ startUrl: origin + '/', maxUrls: 50, delayMs: 0 }));
    expect(result.pages.every((p) => p.url.startsWith(origin))).toBe(true);
  });

  it('recupera dalla sitemap le pagine non linkate e le marca come orfane', async () => {
    const result = await crawl(makeConfig({ startUrl: origin + '/', maxUrls: 50, delayMs: 0 }));
    const orfana = result.pages.find((p) => p.url.endsWith('/orfana'));
    expect(orfana).toBeDefined();
    expect(orfana?.isOrphan).toBe(true);
    expect(orfana?.inSitemap).toBe(true);
  });

  it('rispetta il limite di URL', async () => {
    const result = await crawl(makeConfig({ startUrl: origin + '/', maxUrls: 2, delayMs: 0, concurrency: 1 }));
    expect(result.pages.length).toBeLessThanOrEqual(2);
  });

  it('conta i link interni in entrata', async () => {
    const result = await crawl(makeConfig({ startUrl: origin + '/', maxUrls: 50, delayMs: 0 }));
    const home = result.pages.find((p) => p.url === origin + '/');
    expect(home?.uniqueInlinks).toBeGreaterThan(0);
  });
});
