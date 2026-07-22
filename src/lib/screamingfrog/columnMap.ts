/**
 * Canonical CrawledUrl fields and the Screaming Frog CSV headers that map to
 * them. Header names vary across SF versions/configurations/locales, so each
 * canonical field lists several aliases (compared case-insensitively).
 *
 * This dictionary powers the automatic column mapping; the UI can override it
 * per import to reconcile unknown columns.
 */

export type FieldType = "string" | "int" | "bool" | "indexability" | "list";

export interface CanonicalField {
  key: string; // property on CrawledUrl
  type: FieldType;
  aliases: string[]; // possible SF headers
}

export const CANONICAL_FIELDS: CanonicalField[] = [
  { key: "url", type: "string", aliases: ["Address", "URL", "Url"] },
  { key: "contentType", type: "string", aliases: ["Content Type", "Content"] },
  { key: "statusCode", type: "int", aliases: ["Status Code", "Status_Code", "HTTP Status Code"] },
  { key: "indexability", type: "indexability", aliases: ["Indexability"] },
  { key: "indexabilityStatus", type: "string", aliases: ["Indexability Status"] },
  { key: "title", type: "string", aliases: ["Title 1", "Title", "Page Title 1"] },
  { key: "titleLength", type: "int", aliases: ["Title 1 Length", "Title Length", "Title 1 Pixel Width"] },
  { key: "metaDescription", type: "string", aliases: ["Meta Description 1", "Meta Description"] },
  { key: "metaDescriptionLength", type: "int", aliases: ["Meta Description 1 Length", "Meta Description Length"] },
  { key: "h1", type: "string", aliases: ["H1-1", "H1", "H1 1"] },
  { key: "h2", type: "string", aliases: ["H2-1", "H2", "H2 1"] },
  { key: "canonical", type: "string", aliases: ["Canonical Link Element 1", "Canonical", "Canonical Link Element"] },
  { key: "metaRobots", type: "string", aliases: ["Meta Robots 1", "Meta Robots", "Directives"] },
  { key: "hreflang", type: "string", aliases: ["Hreflang 1", "Hreflang", "HREF Lang 1"] },
  { key: "wordCount", type: "int", aliases: ["Word Count", "Words"] },
  { key: "crawlDepth", type: "int", aliases: ["Crawl Depth", "Depth"] },
  { key: "inlinks", type: "int", aliases: ["Inlinks", "Unique Inlinks", "No. Inlinks"] },
  { key: "outlinks", type: "int", aliases: ["Outlinks", "Unique Outlinks", "No. Outlinks"] },
  { key: "redirectUrl", type: "string", aliases: ["Redirect URL", "Redirect Url", "Redirect Address"] },
  { key: "responseTimeMs", type: "int", aliases: ["Response Time", "Response Time (ms)"] },
  { key: "images", type: "int", aliases: ["Images", "No. Images"] },
  { key: "imagesMissingAlt", type: "int", aliases: ["Images Missing Alt Text", "Missing Alt Text", "No. Images Missing Alt Text"] },
  { key: "structuredData", type: "bool", aliases: ["Structured Data", "Contains Structured Data"] },
  { key: "structuredDataTypes", type: "string", aliases: ["Structured Data Types", "Schema.org Types"] },
  { key: "inSitemap", type: "bool", aliases: ["In Sitemap", "URL in Sitemap"] },
];

const normalize = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Build a header → canonical-field map for a given CSV header row.
 * Returns the mapping plus the list of headers we could not recognise.
 */
export function buildColumnMapping(headers: string[]): {
  mapping: Record<string, string>; // header -> canonical key
  unknown: string[];
} {
  const aliasIndex = new Map<string, string>();
  for (const field of CANONICAL_FIELDS) {
    for (const alias of field.aliases) aliasIndex.set(normalize(alias), field.key);
  }

  const mapping: Record<string, string> = {};
  const unknown: string[] = [];
  for (const header of headers) {
    const key = aliasIndex.get(normalize(header));
    if (key && !Object.values(mapping).includes(key)) {
      mapping[header] = key;
    } else if (!key) {
      unknown.push(header);
    }
  }
  return { mapping, unknown };
}

export const fieldTypeByKey: Record<string, FieldType> = Object.fromEntries(
  CANONICAL_FIELDS.map((f) => [f.key, f.type]),
);

/** Coerce a raw CSV string value into the target field type. */
export function coerceValue(type: FieldType, raw: string | undefined): unknown {
  const v = (raw ?? "").trim();
  if (v === "") return type === "bool" ? undefined : type === "indexability" ? "UNKNOWN" : undefined;
  switch (type) {
    case "int": {
      const n = parseInt(v.replace(/[^0-9-]/g, ""), 10);
      return Number.isNaN(n) ? undefined : n;
    }
    case "bool":
      return /^(true|yes|1|si|sì)$/i.test(v);
    case "indexability":
      return /non[-\s]?index/i.test(v) ? "NON_INDEXABLE" : /index/i.test(v) ? "INDEXABLE" : "UNKNOWN";
    default:
      return v;
  }
}
