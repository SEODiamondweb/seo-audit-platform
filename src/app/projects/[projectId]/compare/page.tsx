import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { compareAudits } from "@/lib/compare/compare";
import { PageHeader, Badge, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

function ChangeList({ title, items }: { title: string; items: { url: string; from: unknown; to: unknown }[] }) {
  return (
    <div className="card">
      <h3 className="mb-2 font-semibold">{title} <span className="text-slate-400">({items.length})</span></h3>
      <div className="max-h-64 space-y-1 overflow-y-auto text-xs">
        {items.slice(0, 100).map((c, i) => (
          <div key={i} className="border-b border-slate-100 py-1">
            <div className="truncate text-slate-600" title={c.url}>{c.url}</div>
            <div className="text-slate-400">{String(c.from ?? "—")} → <span className="text-slate-700">{String(c.to ?? "—")}</span></div>
          </div>
        ))}
        {items.length === 0 && <p className="text-slate-400">Nessuna variazione.</p>}
      </div>
    </div>
  );
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: { projectId: string };
  searchParams: { base?: string; current?: string };
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    include: { audits: { orderBy: { auditDate: "desc" } } },
  });
  if (!project) notFound();

  if (project.audits.length < 2) {
    return (
      <div>
        <PageHeader title="Confronto audit" subtitle={project.name} />
        <Empty>Servono almeno due audit per il confronto.</Empty>
      </div>
    );
  }

  const currentId = searchParams.current ?? project.audits[0].id;
  const baseId = searchParams.base ?? project.audits[1].id;
  const diff = await compareAudits(baseId, currentId);
  const base = project.audits.find((a) => a.id === baseId)!;
  const current = project.audits.find((a) => a.id === currentId)!;

  return (
    <div>
      <PageHeader
        title="Confronto audit"
        subtitle={project.name}
        breadcrumbs={[{ href: `/projects/${project.id}`, label: project.name }, { href: "#", label: "Confronto" }]}
      />

      <form className="mb-6 flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="label">Audit base (precedente)</label>
          <select name="base" defaultValue={baseId} className="input">
            {project.audits.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.auditDate.toISOString().slice(0, 10)} (score {a.score ?? "—"})</option>)}
          </select>
        </div>
        <div>
          <label className="label">Audit corrente</label>
          <select name="current" defaultValue={currentId} className="input">
            {project.audits.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.auditDate.toISOString().slice(0, 10)} (score {a.score ?? "—"})</option>)}
          </select>
        </div>
        <button className="btn" type="submit">Confronta</button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card">
          <div className="text-xs text-slate-500">Variazione score</div>
          <div className={`text-3xl font-bold ${(diff.scoreDelta ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
            {diff.scoreDelta == null ? "—" : (diff.scoreDelta > 0 ? "+" : "") + diff.scoreDelta}
          </div>
          <div className="text-xs text-slate-400">{base.score ?? "—"} → {current.score ?? "—"}</div>
        </div>
        <div className="card"><div className="text-xs text-slate-500">Problemi nuovi</div><div className="text-3xl font-bold text-red-600">{diff.newIssues.length}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Problemi risolti</div><div className="text-3xl font-bold text-green-600">{diff.resolvedIssues.length}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Ancora presenti</div><div className="text-3xl font-bold text-amber-600">{diff.persistentIssues.length}</div></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card">
          <h3 className="mb-2 font-semibold text-red-700">Problemi nuovi</h3>
          {diff.newIssues.map((i) => <div key={i.ruleKey} className="flex justify-between border-b border-slate-100 py-1 text-sm"><span>{i.title}</span><Badge tone={i.severity}>{i.affectedCount}</Badge></div>)}
          {diff.newIssues.length === 0 && <p className="text-sm text-slate-400">Nessuno.</p>}
        </div>
        <div className="card">
          <h3 className="mb-2 font-semibold text-green-700">Problemi risolti</h3>
          {diff.resolvedIssues.map((i) => <div key={i.ruleKey} className="border-b border-slate-100 py-1 text-sm">{i.title}</div>)}
          {diff.resolvedIssues.length === 0 && <p className="text-sm text-slate-400">Nessuno.</p>}
        </div>
        <div className="card">
          <h3 className="mb-2 font-semibold text-amber-700">Ancora presenti</h3>
          {diff.persistentIssues.map((i) => <div key={i.ruleKey} className="flex justify-between border-b border-slate-100 py-1 text-sm"><span>{i.title}</span><span className="text-xs text-slate-500">{i.fromCount} → {i.toCount}</span></div>)}
          {diff.persistentIssues.length === 0 && <p className="text-sm text-slate-400">Nessuno.</p>}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 font-semibold">URL nuove ({diff.newUrls.length}) / rimosse ({diff.removedUrls.length})</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="max-h-48 overflow-y-auto">{diff.newUrls.slice(0, 100).map((u) => <div key={u} className="truncate text-green-700">+ {u}</div>)}</div>
            <div className="max-h-48 overflow-y-auto">{diff.removedUrls.slice(0, 100).map((u) => <div key={u} className="truncate text-red-700">− {u}</div>)}</div>
          </div>
        </div>
        <ChangeList title="Variazioni status code" items={diff.statusChanges} />
        <ChangeList title="Variazioni title" items={diff.titleChanges} />
        <ChangeList title="Variazioni canonical" items={diff.canonicalChanges} />
        <ChangeList title="Variazioni indexability" items={diff.indexabilityChanges} />
      </div>
    </div>
  );
}
