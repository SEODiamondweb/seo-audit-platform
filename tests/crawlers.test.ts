import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  classifyBot,
  ipToBigInt,
  IpRangeSet,
  parseCidr,
} from '../src/crawlers/bots';
import { parseLog, parseLogDate, parseLogLine } from '../src/crawlers/parse';
import { analyzeCrawlerLogs, logsDirFor } from '../src/crawlers/report';

describe('parsing del log', () => {
  it('interpreta una riga in Combined Log Format', () => {
    const entry = parseLogLine(
      '66.249.66.1 - - [19/Aug/2026:14:03:22 +0200] "GET /servizi/ HTTP/1.1" 200 5123 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
    );
    expect(entry).not.toBeNull();
    expect(entry?.ip).toBe('66.249.66.1');
    expect(entry?.path).toBe('/servizi/');
    expect(entry?.status).toBe(200);
    expect(entry?.userAgent).toContain('Googlebot');
  });

  it('interpreta anche il Common Log Format, senza user agent', () => {
    const entry = parseLogLine('10.0.0.1 - - [19/Aug/2026:14:03:22 +0000] "GET / HTTP/1.1" 200 512');
    expect(entry).not.toBeNull();
    expect(entry?.userAgent).toBe('');
  });

  it('converte la data Apache rispettando il fuso', () => {
    const date = parseLogDate('19/Aug/2026:14:03:22 +0200');
    expect(date?.toISOString()).toBe('2026-08-19T12:03:22.000Z');
  });

  it('conta le righe non interpretabili senza fermarsi', () => {
    const parsed = parseLog('riga spazzatura\n10.0.0.1 - - [19/Aug/2026:14:03:22 +0000] "GET / HTTP/1.1" 200 1\n');
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.unparsedLines).toBe(1);
  });
});

describe('classificazione dei bot', () => {
  it('riconosce le famiglie principali', () => {
    expect(classifyBot('Mozilla/5.0 (compatible; Googlebot/2.1)')?.name).toBe('Googlebot');
    expect(classifyBot('Mozilla/5.0 (compatible; bingbot/2.0)')?.name).toBe('Bingbot');
    expect(classifyBot('GPTBot/1.0')?.group).toBe('ai');
    expect(classifyBot('Mozilla/5.0 AhrefsBot/7.0')?.group).toBe('seo-tool');
    expect(classifyBot('facebookexternalhit/1.1')?.group).toBe('social');
  });

  it('i pattern specifici vincono su quelli generici', () => {
    expect(classifyBot('Googlebot-Image/1.0')?.name).toBe('Googlebot Immagini');
  });

  it('ignora i browser normali', () => {
    expect(classifyBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0')).toBeNull();
  });
});

describe('verifica IP', () => {
  it('converte IPv4 e IPv6', () => {
    expect(ipToBigInt('66.249.66.1')?.value).toBe(
      (66n << 24n) | (249n << 16n) | (66n << 8n) | 1n,
    );
    expect(ipToBigInt('2001:4860::1')?.v6).toBe(true);
    expect(ipToBigInt('non-un-ip')).toBeNull();
  });

  it('verifica l appartenenza a un CIDR', () => {
    const set = new IpRangeSet();
    set.add('66.249.64.0/19'); // intervallo Googlebot reale
    set.add('2001:4860:4801::/48');

    expect(set.contains('66.249.66.1')).toBe(true);
    expect(set.contains('66.250.0.1')).toBe(false);
    expect(set.contains('2001:4860:4801:10::42')).toBe(true);
    expect(set.contains('2001:4860:9999::1')).toBe(false);
  });

  it('rifiuta i CIDR malformati senza lanciare', () => {
    expect(parseCidr('non/valido')).toBeNull();
    expect(parseCidr('10.0.0.0/64')).toBeNull();
  });
});

describe('analisi end-to-end dei log', () => {
  const domain = 'test-crawler-fixture.example';
  const dir = logsDirFor(domain);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('costruisce il report da un log realistico', async () => {
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      // Googlebot autentico (66.249.64.0/19)
      '66.249.66.1 - - [18/Aug/2026:09:00:00 +0000] "GET / HTTP/1.1" 200 5000 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
      '66.249.66.1 - - [18/Aug/2026:09:00:05 +0000] "GET /servizi/ HTTP/1.1" 200 4000 "-" "Mozilla/5.0 (compatible; Googlebot/2.1)"',
      '66.249.66.2 - - [19/Aug/2026:11:30:00 +0000] "GET /vecchia-pagina/ HTTP/1.1" 404 300 "-" "Mozilla/5.0 (compatible; Googlebot/2.1)"',
      // Googlebot falso: IP fuori dagli intervalli
      '203.0.113.99 - - [19/Aug/2026:12:00:00 +0000] "GET / HTTP/1.1" 200 5000 "-" "Mozilla/5.0 (compatible; Googlebot/2.1)"',
      // Crawler AI
      '20.0.0.5 - - [19/Aug/2026:13:00:00 +0000] "GET / HTTP/1.1" 200 5000 "-" "GPTBot/1.0"',
      // Utente normale: non deve comparire
      '198.51.100.7 - - [19/Aug/2026:13:05:00 +0000] "GET / HTTP/1.1" 200 5000 "-" "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0"',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'access.log'), lines, 'utf8');

    const report = await analyzeCrawlerLogs(domain);
    expect(report).not.toBeNull();
    if (!report) return;

    expect(report.totalBotHits).toBe(5);
    expect(report.periodStart).toBe('2026-08-18T09:00:00.000Z');
    expect(report.periodEnd).toBe('2026-08-19T13:00:00.000Z');

    const google = report.bots.find((b) => b.name === 'Googlebot');
    expect(google?.hits).toBe(4);
    expect(google?.hits404).toBe(1);
    expect(google?.lastSeen).toBe('2026-08-19T12:00:00.000Z');

    const gpt = report.bots.find((b) => b.name === 'GPTBot (OpenAI)');
    expect(gpt?.hits).toBe(1);

    // Le 404 richieste dai motori vanno elencate.
    expect(report.wasted404.some((w) => w.path === '/vecchia-pagina/')).toBe(true);

    // La verifica IP dipende dalla rete: se è riuscita, il Googlebot da 203.0.113.99
    // deve risultare falso e quelli da 66.249.66.x autentici.
    if (report.ipVerificationDone) {
      expect(google?.spoofed).toBe(1);
      expect(google?.verified).toBe(3);
      expect(report.spoofedExamples.some((s) => s.ip === '203.0.113.99')).toBe(true);
    } else {
      expect(google?.spoofed).toBeNull();
    }
  }, 30000);

  it('ritorna null quando non ci sono log', async () => {
    expect(await analyzeCrawlerLogs('dominio-senza-log.example')).toBeNull();
  });
});
