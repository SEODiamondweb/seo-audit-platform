import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { classifyBot, fetchOfficialRanges, GROUP_LABELS } from './bots';
import { parseLog } from './parse';
import type { BotGroup } from './bots';
import type { LogEntry } from './parse';

/**
 * Analisi dei crawler dai log di accesso.
 *
 * I file vanno messi in DATA_DIR/logs/<dominio>/ (es. data/logs/example.com/access.log):
 * al successivo audit di quel dominio vengono letti automaticamente. Formato supportato:
 * Common/Combined Log Format, il default di Apache, nginx, LiteSpeed e dei log "raw" di cPanel.
 */

export interface BotStats {
  name: string;
  group: BotGroup;
  groupLabel: string;
  hits: number;
  uniqueUrls: number;
  firstSeen: string;
  lastSeen: string;
  /** Richieste andate in errore o redirect: crawl budget speso male. */
  hits404: number;
  hits3xx: number;
  hits5xx: number;
  /** Verifica IP: quante richieste da IP ufficiali e quante no. Null = non verificabile. */
  verified: number | null;
  spoofed: number | null;
  topPaths: { path: string; hits: number }[];
}

export interface CrawlerLogReport {
  /** File letti, con il numero di righe interpretate. */
  files: { name: string; lines: number; unparsed: number }[];
  periodStart: string | null;
  periodEnd: string | null;
  totalBotHits: number;
  bots: BotStats[];
  /** Richieste con UA Googlebot/Bingbot da IP non ufficiali: scraper travestiti. */
  spoofedExamples: { ip: string; userAgent: string; hits: number }[];
  /** true se la verifica IP è stata possibile (rete raggiungibile). */
  ipVerificationDone: boolean;
  /** URL più richieste dai motori di ricerca che rispondono 404: spreco evidente. */
  wasted404: { path: string; hits: number; bot: string }[];
  warnings: string[];
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dominio';
}

export function logsDirFor(domain: string): string {
  return path.join(env.DATA_DIR, 'logs', safeSegment(domain));
}

async function readLogFiles(
  dir: string,
): Promise<{ name: string; content: string }[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const files: { name: string; content: string }[] = [];
  for (const name of names) {
    if (!/\.(log|txt)$/i.test(name)) continue;
    try {
      const content = await fs.readFile(path.join(dir, name), 'utf8');
      files.push({ name, content });
    } catch (err) {
      logger.warn({ err, name }, 'File di log non leggibile, saltato');
    }
  }
  return files;
}

/**
 * Legge i log del dominio (se presenti) e costruisce il report dei crawler.
 * Ritorna null quando la cartella non esiste o non contiene file: il PDF in quel caso
 * spiega come fornire i log invece di mostrare una sezione vuota.
 */
export async function analyzeCrawlerLogs(domain: string): Promise<CrawlerLogReport | null> {
  const dir = logsDirFor(domain);
  const files = await readLogFiles(dir);
  if (files.length === 0) return null;

  const warnings: string[] = [];
  const report: CrawlerLogReport = {
    files: [],
    periodStart: null,
    periodEnd: null,
    totalBotHits: 0,
    bots: [],
    spoofedExamples: [],
    ipVerificationDone: false,
    wasted404: [],
    warnings,
  };

  // ── Parsing ──
  interface Acc {
    name: string;
    group: BotGroup;
    verifiable: 'google' | 'bing' | undefined;
    hits: number;
    urls: Set<string>;
    first: Date;
    last: Date;
    s404: number;
    s3xx: number;
    s5xx: number;
    verified: number;
    spoofed: number;
    paths: Map<string, number>;
    entries: LogEntry[];
  }
  const accumulators = new Map<string, Acc>();
  /** URL in 404 richieste dai motori di ricerca: le più urgenti da redirigere. */
  const wasted = new Map<string, { path: string; hits: number; bot: string }>();

  for (const file of files) {
    const parsed = parseLog(file.content);
    report.files.push({
      name: file.name,
      lines: parsed.totalLines,
      unparsed: parsed.unparsedLines,
    });
    if (parsed.unparsedLines > parsed.totalLines * 0.5 && parsed.totalLines > 0) {
      warnings.push(
        file.name +
          ': oltre metà delle righe non è in Combined Log Format e non è stata interpretata.',
      );
    }

    for (const entry of parsed.entries) {
      const family = classifyBot(entry.userAgent);
      if (!family) continue;

      let acc = accumulators.get(family.name);
      if (!acc) {
        acc = {
          name: family.name,
          group: family.group,
          verifiable: family.verifiable,
          hits: 0,
          urls: new Set(),
          first: entry.time,
          last: entry.time,
          s404: 0,
          s3xx: 0,
          s5xx: 0,
          verified: 0,
          spoofed: 0,
          paths: new Map(),
          entries: [],
        };
        accumulators.set(family.name, acc);
      }

      acc.hits += 1;
      acc.urls.add(entry.path);
      if (entry.time < acc.first) acc.first = entry.time;
      if (entry.time > acc.last) acc.last = entry.time;
      if (entry.status === 404 || entry.status === 410) acc.s404 += 1;
      else if (entry.status >= 300 && entry.status < 400) acc.s3xx += 1;
      else if (entry.status >= 500) acc.s5xx += 1;
      acc.paths.set(entry.path, (acc.paths.get(entry.path) ?? 0) + 1);
      if (acc.verifiable) acc.entries.push(entry);

      if (family.group === 'search' && (entry.status === 404 || entry.status === 410)) {
        const existing = wasted.get(entry.path);
        if (existing) existing.hits += 1;
        else wasted.set(entry.path, { path: entry.path, hits: 1, bot: family.name });
      }

      report.totalBotHits += 1;
      if (!report.periodStart || entry.time.toISOString() < report.periodStart) {
        report.periodStart = entry.time.toISOString();
      }
      if (!report.periodEnd || entry.time.toISOString() > report.periodEnd) {
        report.periodEnd = entry.time.toISOString();
      }
    }
  }

  // ── Verifica IP dei bot verificabili ──
  const needsGoogle = [...accumulators.values()].some((a) => a.verifiable === 'google');
  const needsBing = [...accumulators.values()].some((a) => a.verifiable === 'bing');
  const [googleRanges, bingRanges] = await Promise.all([
    needsGoogle ? fetchOfficialRanges('google') : Promise.resolve(null),
    needsBing ? fetchOfficialRanges('bing') : Promise.resolve(null),
  ]);
  report.ipVerificationDone =
    (!needsGoogle || googleRanges !== null) && (!needsBing || bingRanges !== null);

  const spoofedByIp = new Map<string, { ip: string; userAgent: string; hits: number }>();

  for (const acc of accumulators.values()) {
    const ranges = acc.verifiable === 'google' ? googleRanges : acc.verifiable === 'bing' ? bingRanges : null;
    if (acc.verifiable && ranges) {
      for (const entry of acc.entries) {
        if (ranges.contains(entry.ip)) {
          acc.verified += 1;
        } else {
          acc.spoofed += 1;
          const existing = spoofedByIp.get(entry.ip);
          if (existing) existing.hits += 1;
          else spoofedByIp.set(entry.ip, { ip: entry.ip, userAgent: entry.userAgent.slice(0, 80), hits: 1 });
        }
      }
    }
    acc.entries = []; // libera la memoria: gli entry servivano solo alla verifica
  }

  report.spoofedExamples = [...spoofedByIp.values()].sort((a, b) => b.hits - a.hits).slice(0, 10);

  // ── Statistiche finali per bot ──
  report.bots = [...accumulators.values()]
    .map((acc) => ({
      name: acc.name,
      group: acc.group,
      groupLabel: GROUP_LABELS[acc.group],
      hits: acc.hits,
      uniqueUrls: acc.urls.size,
      firstSeen: acc.first.toISOString(),
      lastSeen: acc.last.toISOString(),
      hits404: acc.s404,
      hits3xx: acc.s3xx,
      hits5xx: acc.s5xx,
      verified: acc.verifiable && report.ipVerificationDone ? acc.verified : null,
      spoofed: acc.verifiable && report.ipVerificationDone ? acc.spoofed : null,
      topPaths: [...acc.paths.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([p, hits]) => ({ path: p, hits })),
    }))
    .sort((a, b) => b.hits - a.hits);

  report.wasted404 = [...wasted.values()].sort((a, b) => b.hits - a.hits).slice(0, 15);

  return report;
}
