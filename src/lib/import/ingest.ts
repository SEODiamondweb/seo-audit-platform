import { Buffer } from "node:buffer";
import { parseScreamingFrogCsv } from "./csv";
import { extractCsvsFromZip } from "./zip";

export interface IngestInput {
  files: { name: string; buffer: Buffer }[];
  overrideMapping?: Record<string, string>;
}

export interface IngestResult {
  urls: Record<string, unknown>[]; // canonical CrawledUrl rows, merged by URL
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  unknownColumns: string[];
  filesProcessed: string[];
  warnings: string[];
}

/**
 * Turn one or more uploaded files (CSV or ZIP of CSVs) into a de-duplicated set
 * of canonical CrawledUrl rows. Multiple exports contributing different columns
 * for the same URL are merged. Handles partial/invalid files gracefully.
 */
export async function ingestFiles(input: IngestInput): Promise<IngestResult> {
  const byUrl = new Map<string, Record<string, unknown>>();
  const unknown = new Set<string>();
  const warnings: string[] = [];
  const filesProcessed: string[] = [];
  let rowsTotal = 0;
  let rowsSkipped = 0;

  // 1. Flatten every input file into a list of (name, csvContent).
  const csvUnits: { name: string; content: string }[] = [];
  for (const file of input.files) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".zip")) {
        const extracted = await extractCsvsFromZip(file.buffer);
        if (extracted.length === 0) warnings.push(`ZIP senza CSV: ${file.name}`);
        csvUnits.push(...extracted);
      } else if (lower.endsWith(".csv")) {
        csvUnits.push({ name: file.name, content: file.buffer.toString("utf8") });
      } else {
        warnings.push(`File ignorato (tipo non supportato): ${file.name}`);
      }
    } catch (err) {
      warnings.push(
        `Errore su ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Parse and merge each CSV by URL.
  for (const unit of csvUnits) {
    let parsed;
    try {
      parsed = parseScreamingFrogCsv(unit.content, input.overrideMapping);
    } catch (err) {
      warnings.push(
        `CSV non elaborabile ${unit.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (parsed.rows.length === 0) {
      warnings.push(`Nessuna riga valida in ${unit.name}`);
    }
    filesProcessed.push(unit.name);
    parsed.unknownColumns.forEach((c) => unknown.add(c));
    rowsTotal += parsed.rowsTotal;
    rowsSkipped += parsed.rowsSkipped;

    for (const row of parsed.rows) {
      const url = String(row.url).trim();
      const existing = byUrl.get(url);
      if (existing) {
        // Merge: prefer defined values; combine extras.
        for (const [k, v] of Object.entries(row)) {
          if (v === undefined || v === null || v === "") continue;
          if (k === "extra") {
            existing.extra = { ...(existing.extra as object), ...(v as object) };
          } else if (existing[k] === undefined || existing[k] === null || existing[k] === "") {
            existing[k] = v;
          }
        }
      } else {
        byUrl.set(url, { ...row });
      }
    }
  }

  const urls = [...byUrl.values()];
  return {
    urls,
    rowsTotal,
    rowsImported: urls.length,
    rowsSkipped,
    unknownColumns: [...unknown],
    filesProcessed,
    warnings,
  };
}
