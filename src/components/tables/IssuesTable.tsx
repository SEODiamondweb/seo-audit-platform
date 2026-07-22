"use client";

import { DataTable, type Column } from "../DataTable";
import { Badge } from "../ui";

export interface IssueRow {
  id: string;
  title: string;
  category: string;
  severity: string;
  priority: string;
  status: string;
  effort: string;
  affectedCount: number;
}

const columns: Column<IssueRow>[] = [
  { key: "title", header: "Issue", accessor: (r) => r.title },
  { key: "category", header: "Categoria", accessor: (r) => r.category },
  { key: "severity", header: "Severità", accessor: (r) => r.severity, render: (r) => <Badge tone={r.severity}>{r.severity}</Badge> },
  { key: "priority", header: "Priorità", accessor: (r) => r.priority },
  { key: "affectedCount", header: "URL", accessor: (r) => r.affectedCount, align: "right" },
  { key: "effort", header: "Effort", accessor: (r) => r.effort },
  { key: "status", header: "Stato", accessor: (r) => r.status },
];

export function IssuesTable({ rows }: { rows: IssueRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      exportName="issues"
      rowHref={(r) => `/issues/${r.id}`}
      filters={[
        { key: "severity", label: "Severità", options: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
        { key: "category", label: "Categoria", options: [...new Set(rows.map((r) => r.category))] },
        { key: "status", label: "Stato", options: ["OPEN", "IN_PROGRESS", "RESOLVED", "IGNORED", "WONT_FIX"] },
      ]}
      emptyText="Nessuna issue rilevata."
    />
  );
}
