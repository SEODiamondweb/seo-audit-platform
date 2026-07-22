import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentOrg, dashboardStats } from "@/lib/data";
import { PageHeader, Stat, ScoreBadge, Badge, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const org = await currentOrg();
  const stats = await dashboardStats();

  const recentAudits = await prisma.audit.findMany({
    where: { project: { client: { organizationId: org.id } } },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { project: { include: { client: true } } },
  });

  const jobs = await prisma.screamingFrogJob.findMany({
    where: { project: { client: { organizationId: org.id } }, status: { in: ["QUEUED", "RUNNING", "EXPORTING", "IMPORTING", "FAILED", "TIMEOUT"] } },
    orderBy: { updatedAt: "desc" },
    take: 6,
    include: { project: true },
  });

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={org.name} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Clienti" value={stats.clients} />
        <Stat label="Progetti" value={stats.projects} />
        <Stat label="Audit" value={stats.audits} />
        <Stat label="Issue aperte" value={stats.openIssues} />
        <Stat label="Scansioni attive" value={stats.runningJobs} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Audit recenti</h2>
          {recentAudits.length === 0 ? (
            <Empty>Nessun audit. Crea un cliente e importa un export Screaming Frog.</Empty>
          ) : (
            <div className="space-y-2">
              {recentAudits.map((a) => (
                <Link key={a.id} href={`/audits/${a.id}`} className="card flex items-center justify-between hover:border-brand-300">
                  <div>
                    <div className="font-medium">{a.project.client.name} — {a.project.name}</div>
                    <div className="text-xs text-slate-500">{a.label} · {a.source === "MANUAL_IMPORT" ? "Import" : "Scansione"} · {a.auditDate.toISOString().slice(0, 10)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl"><ScoreBadge score={a.score} /></div>
                    <Badge>{a.status}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Stato scansioni</h2>
          {jobs.length === 0 ? (
            <Empty>Nessuna scansione in corso.</Empty>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id} className="card">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{j.project.name}</span>
                    <Badge tone={j.status === "FAILED" || j.status === "TIMEOUT" ? "CRITICAL" : undefined}>{j.status}</Badge>
                  </div>
                  <div className="mt-2 h-2 w-full rounded bg-slate-100">
                    <div className="h-2 rounded bg-brand-500" style={{ width: `${j.progress}%` }} />
                  </div>
                  {j.message && <div className="mt-1 text-xs text-slate-500">{j.message}</div>}
                  {j.errorMessage && <div className="mt-1 text-xs text-red-600">{j.errorMessage}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
