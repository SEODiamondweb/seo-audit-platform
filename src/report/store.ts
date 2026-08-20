import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { AuditResult } from '../audit/types';

export interface StoredAudit {
  dir: string;
  jsonPath: string;
  pdfPath: string;
  htmlPath: string;
  baseName: string;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'audit';
}

/** Timestamp compatto e ordinabile: 20260819-1204 */
function stamp(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes())
  );
}

export function auditPaths(audit: AuditResult): StoredAudit {
  const domainDir = path.join(env.DATA_DIR, 'audits', safeSegment(audit.domain));
  const baseName = 'seo-audit-' + safeSegment(audit.domain) + '-' + stamp(audit.createdAt);
  const dir = path.join(domainDir, stamp(audit.createdAt) + '-' + audit.id);

  return {
    dir,
    baseName,
    jsonPath: path.join(dir, 'audit.json'),
    htmlPath: path.join(dir, baseName + '.html'),
    pdfPath: path.join(dir, baseName + '.pdf'),
  };
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Salva lo snapshot JSON dell’audit. Il payload completo del crawl viene alleggerito
 * (link e immagini per pagina) per non produrre file da centinaia di MB sui siti grandi.
 */
export async function saveSnapshot(audit: AuditResult, jsonPath: string): Promise<void> {
  const lightweight = {
    ...audit,
    crawl: {
      ...audit.crawl,
      pages: audit.crawl.pages.map((page) => ({
        ...page,
        internalLinks: [],
        externalLinks: [],
        images: page.images.slice(0, 5),
      })),
    },
  };
  await writeText(jsonPath, JSON.stringify(lightweight, null, 2));
}

/** Carica il logo configurato e lo converte in data URI per l’embed nel PDF. */
export async function loadLogoDataUri(): Promise<string | undefined> {
  const logoPath = env.REPORT_LOGO_PATH;
  if (!logoPath) return undefined;

  try {
    const absolute = path.resolve(process.cwd(), logoPath);
    const buffer = await fs.readFile(absolute);
    const ext = path.extname(absolute).toLowerCase();
    const mime =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/png';
    return 'data:' + mime + ';base64,' + buffer.toString('base64');
  } catch (err) {
    logger.warn({ err, logoPath }, 'Logo non caricato, il report verrà generato senza');
    return undefined;
  }
}

export interface AuditIndexEntry {
  domain: string;
  dir: string;
  jsonPath: string;
  createdAt: string;
}

/** Elenca gli audit già salvati per un dominio, dal più recente. */
export async function listAudits(domain: string): Promise<AuditIndexEntry[]> {
  const domainDir = path.join(env.DATA_DIR, 'audits', safeSegment(domain));
  let entries: string[];
  try {
    entries = await fs.readdir(domainDir);
  } catch {
    return [];
  }

  const results: AuditIndexEntry[] = [];
  for (const entry of entries) {
    const jsonPath = path.join(domainDir, entry, 'audit.json');
    try {
      const stats = await fs.stat(jsonPath);
      results.push({
        domain,
        dir: path.join(domainDir, entry),
        jsonPath,
        createdAt: stats.mtime.toISOString(),
      });
    } catch {
      continue;
    }
  }

  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadAudit(jsonPath: string): Promise<AuditResult> {
  const raw = await fs.readFile(jsonPath, 'utf8');
  return JSON.parse(raw) as AuditResult;
}
