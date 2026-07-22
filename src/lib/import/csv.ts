import { parse } from "csv-parse/sync";
import {
  buildColumnMapping,
  coerceValue,
  fieldTypeByKey,
} from "../screamingfrog/columnMap";

export interface ParsedCsv {
  /** One object per data row, keyed by canonical CrawledUrl field. */
  rows: Record<string, unknown>[];
  headers: string[];
  mapping: Record<string, string>;
  unknownColumns: string[];
  rowsTotal: number;
  rowsSkipped: number;
}

/**
 * Parse a Screaming Frog CSV export into canonical CrawledUrl rows.
 *
 * @param content   raw CSV text
 * @param overrideMapping  optional header→canonicalKey overrides from the UI
 */
export function parseScreamingFrogCsv(
  content: string,
  overrideMapping?: Record<string, string>,
): ParsedCsv {
  // SF sometimes prefixes exports with a title line; csv-parse handles quoting.
  const records: string[][] = parse(content, {
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  });

  if (records.length === 0) {
    return { rows: [], headers: [], mapping: {}, unknownColumns: [], rowsTotal: 0, rowsSkipped: 0 };
  }

  // Detect the header row: the first row that contains a recognisable URL column.
  let headerIndex = 0;
  for (let i = 0; i < Math.min(records.length, 5); i++) {
    const { mapping } = buildColumnMapping(records[i]);
    if (Object.values(mapping).includes("url")) {
      headerIndex = i;
      break;
    }
  }

  const headers = records[headerIndex];
  const auto = buildColumnMapping(headers);
  const mapping = { ...auto.mapping, ...(overrideMapping ?? {}) };
  const unknownColumns = auto.unknown.filter((h) => !mapping[h]);

  const rows: Record<string, unknown>[] = [];
  let rowsSkipped = 0;

  for (let i = headerIndex + 1; i < records.length; i++) {
    const cells = records[i];
    if (!cells || cells.length === 0) continue;

    const row: Record<string, unknown> = {};
    const extra: Record<string, string> = {};

    headers.forEach((header, colIdx) => {
      const raw = cells[colIdx];
      const canonicalKey = mapping[header];
      if (canonicalKey) {
        row[canonicalKey] = coerceValue(fieldTypeByKey[canonicalKey], raw);
      } else if (raw != null && String(raw).trim() !== "") {
        extra[header] = String(raw);
      }
    });

    // A row without a URL is not a usable CrawledUrl.
    if (!row.url || String(row.url).trim() === "") {
      rowsSkipped++;
      continue;
    }
    if (Object.keys(extra).length > 0) row.extra = extra;
    rows.push(row);
  }

  return {
    rows,
    headers,
    mapping,
    unknownColumns,
    rowsTotal: rows.length + rowsSkipped,
    rowsSkipped,
  };
}
