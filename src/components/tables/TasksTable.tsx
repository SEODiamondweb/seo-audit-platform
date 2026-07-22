"use client";

import { DataTable, type Column } from "../DataTable";
import { updateTask } from "@/lib/actions";

export interface TaskRow {
  id: string;
  title: string;
  projectName: string;
  status: string;
  priority: string;
  assignee: string;
  issueId: string | null;
}

const columns: Column<TaskRow>[] = [
  { key: "title", header: "Task", accessor: (r) => r.title },
  { key: "projectName", header: "Progetto", accessor: (r) => r.projectName },
  { key: "priority", header: "Priorità", accessor: (r) => r.priority },
  { key: "assignee", header: "Assegnatario", accessor: (r) => r.assignee },
  {
    key: "status",
    header: "Stato",
    accessor: (r) => r.status,
    render: (r) => (
      <form action={updateTask} className="inline">
        <input type="hidden" name="id" value={r.id} />
        <select name="status" defaultValue={r.status} className="input py-1" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          {["TODO", "IN_PROGRESS", "BLOCKED", "DONE"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </form>
    ),
    sortable: false,
  },
];

export function TasksTable({ rows }: { rows: TaskRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      exportName="tasks"
      rowHref={(r) => (r.issueId ? `/issues/${r.issueId}` : undefined)}
      filters={[
        { key: "status", label: "Stato", options: ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] },
        { key: "priority", label: "Priorità", options: ["P0", "P1", "P2", "P3"] },
      ]}
      emptyText="Nessun task."
    />
  );
}
