"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => string | number | null | undefined;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: "left" | "right";
}

export interface Filter {
  key: string; // must match a column key
  label: string;
  options: string[];
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  filters?: Filter[];
  searchable?: boolean;
  pageSize?: number;
  exportName?: string;
  rowHref?: (row: T) => string | undefined;
  emptyText?: string;
}

/**
 * Generic, self-contained table with search, per-column filters, sorting,
 * pagination and CSV export — used by every list screen.
 */
export function DataTable<T>({
  columns,
  rows,
  filters = [],
  searchable = true,
  pageSize = 25,
  exportName = "export",
  rowHref,
  emptyText = "Nessun dato.",
}: Props<T>) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const colByKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns]);

  const filtered = useMemo(() => {
    let data = rows;
    if (query.trim()) {
      const q = query.toLowerCase();
      data = data.filter((r) =>
        columns.some((c) => String(c.accessor(r) ?? "").toLowerCase().includes(q)),
      );
    }
    for (const [key, val] of Object.entries(active)) {
      if (!val) continue;
      const col = colByKey[key];
      if (!col) continue;
      data = data.filter((r) => String(col.accessor(r) ?? "") === val);
    }
    if (sortKey && colByKey[sortKey]) {
      const acc = colByKey[sortKey].accessor;
      data = [...data].sort((a, b) => {
        const av = acc(a), bv = acc(b);
        const an = typeof av === "number", bn = typeof bv === "number";
        let cmp: number;
        if (an && bn) cmp = (av as number) - (bv as number);
        else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return data;
  }, [rows, query, active, sortKey, sortDir, columns, colByKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const paged = filtered.slice(current * pageSize, current * pageSize + pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function exportCsv() {
    const header = columns.map((c) => `"${c.header}"`).join(",");
    const lines = filtered.map((r) =>
      columns.map((c) => `"${String(c.accessor(r) ?? "").replace(/"/g, '""')}"`).join(","),
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {searchable && (
          <input
            className="input max-w-xs"
            placeholder="Cerca…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          />
        )}
        {filters.map((f) => (
          <select
            key={f.key}
            className="input max-w-[180px]"
            value={active[f.key] ?? ""}
            onChange={(e) => { setActive((a) => ({ ...a, [f.key]: e.target.value })); setPage(0); }}
          >
            <option value="">{f.label}: tutti</option>
            {f.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ))}
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
          <span>{filtered.length} righe</span>
          <button className="btn-secondary" onClick={exportCsv}>Esporta CSV</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={clsx("px-3 py-2 font-semibold", c.align === "right" && "text-right", c.sortable !== false && "cursor-pointer select-none hover:text-slate-800")}
                  onClick={() => c.sortable !== false && toggleSort(c.key)}
                >
                  {c.header}
                  {sortKey === c.key && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">{emptyText}</td></tr>
            )}
            {paged.map((row, i) => {
              const href = rowHref?.(row);
              return (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  {columns.map((c) => {
                    const content = c.render ? c.render(row) : String(c.accessor(row) ?? "");
                    return (
                      <td key={c.key} className={clsx("px-3 py-2 align-top", c.align === "right" && "text-right tabular-nums")}>
                        {href && c.key === columns[0].key ? (
                          <Link href={href} className="font-medium text-brand-700 hover:underline">{content}</Link>
                        ) : content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button className="btn-secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>Precedente</button>
          <span className="text-slate-500">Pagina {current + 1} di {pageCount}</span>
          <button className="btn-secondary" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>Successiva</button>
        </div>
      )}
    </div>
  );
}
