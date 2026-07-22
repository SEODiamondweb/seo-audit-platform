import { notFound } from "next/navigation";
import { buildReportData } from "@/lib/report/report";
import { prisma } from "@/lib/prisma";
import { PageHeader, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: { auditId: string } }) {
  const audit = await prisma.audit.findUnique({ where: { id: params.auditId }, select: { id: true, label: true, projectId: true } });
  if (!audit) notFound();
  const data = await buildReportData(audit.id);

  return (
    <div>
      <PageHeader
        title="Report"
        subtitle={`${data.clientName} — ${data.projectName}`}
        breadcrumbs={[
          { href: `/projects/${audit.projectId}`, label: data.projectName },
          { href: `/audits/${audit.id}`, label: data.auditLabel },
          { href: "#", label: "Report" },
        ]}
        action={
          <div className="flex gap-2">
            <a href={`/api/reports/${audit.id}?format=html`} target="_blank" className="btn-secondary">HTML</a>
            <a href={`/api/reports/${audit.id}?format=pdf`} target="_blank" className="btn-secondary">PDF</a>
            <a href={`/api/reports/${audit.id}?format=csv`} className="btn-secondary">CSV</a>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card md:col-span-2">
          <h2 className="mb-2 font-semibold">Executive Summary</h2>
          <p className="text-sm text-slate-600">
            L&apos;audit ha analizzato <strong>{data.totalUrls}</strong> URL con uno score di <strong>{data.score ?? "—"}/100</strong>,
            rilevando <strong>{data.issues.length}</strong> tipologie di problema.
          </p>
          <div className="mt-4">
            <h3 className="mb-2 font-semibold">Roadmap</h3>
            {data.roadmap.map((r) => (
              <div key={r.window} className="mb-2">
                <div className="text-sm font-medium">Prossimi {r.window} giorni ({r.issues.length})</div>
                <ul className="ml-4 list-disc text-xs text-slate-600">
                  {r.issues.slice(0, 6).map((i) => <li key={i.ruleKey}>{i.title} — {i.affectedCount} URL</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="card h-fit">
          <h2 className="mb-2 font-semibold">Criticità principali</h2>
          {data.issues.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH").slice(0, 8).map((i) => (
            <div key={i.ruleKey} className="flex items-center justify-between border-b border-slate-100 py-1 text-sm">
              <span>{i.title}</span><Badge tone={i.severity}>{i.affectedCount}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
