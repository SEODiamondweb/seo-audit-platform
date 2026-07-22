"use client";

import { DataTable, type Column } from "../DataTable";

export interface UrlRow {
  id: string;
  auditId: string;
  url: string;
  statusCode: number | null;
  indexability: string;
  title: string | null;
  titleLength: number | null;
  wordCount: number | null;
  crawlDepth: number | null;
  inlinks: number | null;
  responseTimeMs: number | null;
}

const columns: Column<UrlRow>[] = [
  { key: "url", header: "URL", accessor: (r) => r.url },
  { key: "statusCode", header: "Status", accessor: (r) => r.statusCode, align: "right" },
  { key: "indexability", header: "Indexability", accessor: (r) => r.indexability },
  { key: "title", header: "Title", accessor: (r) => r.title ?? "" },
  { key: "titleLength", header: "Len", accessor: (r) => r.titleLength, align: "right" },
  { key: "wordCount", header: "Words", accessor: (r) => r.wordCount, align: "right" },
  { key: "crawlDepth", header: "Depth", accessor: (r) => r.crawlDepth, align: "right" },
  { key: "inlinks", header: "Inlinks", accessor: (r) => r.inlinks, align: "right" },
  { key: "responseTimeMs", header: "ms", accessor: (r) => r.responseTimeMs, align: "right" },
];

export function UrlsTable({ rows }: { rows: UrlRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      exportName="urls"
      pageSize={50}
      rowHref={(r) => `/audits/${r.auditId}/urls/${r.id}`}
      filters={[
        { key: "indexability", label: "Indexability", options: ["INDEXABLE", "NON_INDEXABLE", "UNKNOWN"] },
        { key: "statusCode", label: "Status", options: [...new Set(rows.map((r) => String(r.statusCode ?? "")))].filter(Boolean) },
      ]}
      emptyText="Nessuna URL."
    />
  );
}
