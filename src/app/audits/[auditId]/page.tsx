import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader, Stat, ScoreBadge, Badge } from "@/components/ui";
import { IssuesTable, type IssueRow } from "@/components/tables/IssuesTable";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: { auditId: string } }) {
  const audit = await prisma.audit.findUnique({
    where: { id: params.auditId },
    include: {
      project: { include: { client: true } },
      issues: { orderBy: [{ severity: "asc" }, { affectedCount: "desc" }] },
      _count: { select: { urls: true } },
    },
  });
  if (!audit) notFound();

  const rows: IssueRow[] = audit.issues.map((i) => ({
    id: i.id,
    title: i.title,
    category: i.category,
    severity: i.severity,
    priority: i.priority,
    status: i.status,
    effort: i.effort,
    affectedCount: i.affectedCount,
  }));

  const sevCounts: Record<string, number> = {};
  for (const i of audit.issues) sevCounts[i.severity] = (sevCounts[i.severity] ?? 0) + 1;

  return (
    <div>
      <PageHeader
        title={audit.label}
        subtitle={`${audit.project.client.name} — ${audit.project.name} · ${audit.project.domain}`}
        breadcrumbs={[
          { href: "/clients", label: "Clienti" },
          { href: `/clients/${audit.project.clientId}`, label: audit.project.client.name },
          { href: `/projects/${audit.projectId}`, label: audit.project.name },
          { href: `/audits/${audit.id}`, label: audit.label },
        ]}
        action={
          <div className="flex gap-2">
            <Link href={`/audits/${audit.id}/urls`} className="btn-secondary">URL Explorer</Link>
            <Link href={`/audits/${audit.id}/report`} className="btn">Report</Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="SEO Score" value={<ScoreBadge score={audit.score} />} />
        <Stat label="URL" value={audit._count.urls} />
        <Stat label="Issue" value={audit.issues.length} />
        {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => (
          <Stat key={s} label={s} value={sevCounts[s] ?? 0} />
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
        <Badge tone={audit.status === "FAILED" ? "CRITICAL" : undefined}>{audit.status}</Badge>
        <span>Origine: {audit.source === "MANUAL_IMPORT" ? "Import manuale" : "Scansione Screaming Frog"}</span>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Issue rilevate</h2>
      <IssuesTable rows={rows} />
    </div>
  );
}
