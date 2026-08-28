import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Parsing dell'export del report Link di Search Console.
 *
 * L'API di Search Console non espone il report Link: l'unico modo di averlo è l'export
 * manuale dall'interfaccia (Link → Esporta). L'utente estrae i CSV in
 * DATA_DIR/gsc/<dominio>/ e questa funzione li riconosce dal contenuto, non dal nome,
 * perché il nome cambia con la lingua dell'interfaccia.
 *
 * Sono dati Google autentici. Quello che NON contengono — e che quindi il report non
 * inventa — è un punteggio di "tossicità": quella è una metrica proprietaria dei tool a
 * pagamento, non un dato verificabile.
 */

export interface LinkingSite {
  site: string;
  linkingPages: number;
  targetPages: number;
}

export interface LinkedPage {
  page: string;
  incomingLinks: number;
  linkingSites: number;
}

export interface GscLinksReport {
  files: string[];
  topLinkingSites: LinkingSite[];
  topLinkedPages: LinkedPage[];
  totalLinkingSites: number;
}

function gscDirFor(domain: string): string {
  const safe = domain.replace(/[^a-zA-Z0-9._-]+/g, '-');
  return path.join(env.DATA_DIR, 'gsc', safe);
}

/** Parser CSV minimale con supporto alle virgolette: gli export GSC non hanno casi strani. */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i] as string;
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);

  // Il BOM di Excel resta attaccato alla prima cella.
  if (rows[0]?.[0]) rows[0][0] = (rows[0][0] as string).replace(/^﻿/, '');
  return rows;
}

function toInt(value: string | undefined): number {
  const n = Number.parseInt((value ?? '').replace(/[.\s]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Classifica un CSV esportato da GSC guardando i dati, non il nome del file:
 * se la prima colonna contiene URL complete è l'elenco delle pagine collegate,
 * se contiene domini è l'elenco dei siti che linkano.
 */
export function classifyLinksCsv(
  rows: string[][],
): { kind: 'sites'; data: LinkingSite[] } | { kind: 'pages'; data: LinkedPage[] } | null {
  if (rows.length < 2) return null;
  const body = rows.slice(1).filter((r) => (r[0] ?? '').trim() !== '');
  if (body.length === 0) return null;

  const first = (body[0]?.[0] ?? '').trim();

  if (/^https?:\/\//i.test(first)) {
    return {
      kind: 'pages',
      data: body.map((r) => ({
        page: (r[0] as string).trim(),
        incomingLinks: toInt(r[1]),
        linkingSites: toInt(r[2]),
      })),
    };
  }

  // Domini nudi (example.com) o con percorso: il report "siti con link principali".
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(first)) {
    return {
      kind: 'sites',
      data: body.map((r) => ({
        site: (r[0] as string).trim(),
        linkingPages: toInt(r[1]),
        targetPages: toInt(r[2]),
      })),
    };
  }

  return null;
}

export async function loadGscLinks(domain: string): Promise<GscLinksReport | null> {
  const dir = gscDirFor(domain);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }

  const report: GscLinksReport = {
    files: [],
    topLinkingSites: [],
    topLinkedPages: [],
    totalLinkingSites: 0,
  };

  for (const name of names) {
    if (!/\.csv$/i.test(name)) continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(dir, name), 'utf8');
    } catch (err) {
      logger.warn({ err, name }, 'Export GSC non leggibile, saltato');
      continue;
    }

    const classified = classifyLinksCsv(parseCsv(content));
    if (!classified) continue;

    report.files.push(name);
    if (classified.kind === 'sites') {
      report.topLinkingSites.push(...classified.data);
    } else {
      report.topLinkedPages.push(...classified.data);
    }
  }

  if (report.files.length === 0) return null;

  report.topLinkingSites.sort((a, b) => b.linkingPages - a.linkingPages);
  report.topLinkedPages.sort((a, b) => b.incomingLinks - a.incomingLinks);
  report.totalLinkingSites = report.topLinkingSites.length;
  report.topLinkingSites = report.topLinkingSites.slice(0, 30);
  report.topLinkedPages = report.topLinkedPages.slice(0, 30);
  return report;
}
