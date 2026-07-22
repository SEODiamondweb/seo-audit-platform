import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { screamingFrog } from "@/lib/screamingfrog/provider";
import { importAudit, startScan } from "@/lib/actions";
import { PageHeader, Empty, ScoreBadge, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProjectDetail({ params }: { params: { projectId: string } }) {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    include: {
      client: true,
      audits: { orderBy: { auditDate: "desc" }, include: { _count: { select: { issues: true, urls: true } } } },
      jobs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!project) notFound();
  const sfReady = screamingFrog.isAvailable();

  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={project.domain}
        breadcrumbs={[
          { href: "/clients", label: "Clienti" },
          { href: `/clients/${project.clientId}`, label: project.client.name },
          { href: `/projects/${project.id}`, label: project.name },
        ]}
        action={
          project.audits.length >= 2 ? (
            <Link href={`/projects/${project.id}/compare`} className="btn-secondary">Confronta audit</Link>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Audits */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Audit</h2>
          {project.audits.length === 0 ? (
            <Empty>Nessun audit. Importa un export o avvia una scansione.</Empty>
          ) : (
            <div className="space-y-2">
              {project.audits.map((a) => (
                <Link key={a.id} href={`/audits/${a.id}`} className="card flex items-center justify-between hover:border-brand-300">
                  <div>
                    <div className="font-medium">{a.label}</div>
                    <div className="text-xs text-slate-500">
                      {a.source === "MANUAL_IMPORT" ? "Import" : "Scansione CLI"} · {a.auditDate.toISOString().slice(0, 10)} · {a._count.urls} URL · {a._count.issues} issue
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl"><ScoreBadge score={a.score} /></div>
                    <Badge tone={a.status === "FAILED" ? "CRITICAL" : undefined}>{a.status}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {project.jobs.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold text-slate-600">Scansioni Screaming Frog</h3>
              <div className="space-y-2">
                {project.jobs.map((j) => (
                  <div key={j.id} className="card">
                    <div className="flex items-center justify-between">
                      <Badge tone={j.status === "FAILED" || j.status === "TIMEOUT" ? "CRITICAL" : undefined}>{j.status}</Badge>
                      <span className="text-xs text-slate-400">{j.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded bg-slate-100"><div className="h-2 rounded bg-brand-500" style={{ width: `${j.progress}%` }} /></div>
                    {j.errorMessage && <div className="mt-1 text-xs text-red-600">{j.errorMessage}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Import + scan */}
        <div className="space-y-6">
          <form action={importAudit} className="card space-y-3" encType="multipart/form-data">
            <input type="hidden" name="projectId" value={project.id} />
            <h2 className="font-semibold">Import manuale</h2>
            <p className="text-xs text-slate-500">Carica CSV esportati da Screaming Frog o uno ZIP con più export.</p>
            <div>
              <label className="label">Etichetta audit</label>
              <input name="label" className="input" placeholder="Audit luglio 2026" />
            </div>
            <div>
              <label className="label">Data audit</label>
              <input name="auditDate" type="date" className="input" />
            </div>
            <div>
              <label className="label">File (CSV / ZIP) *</label>
              <input name="files" type="file" multiple accept=".csv,.zip" required className="input" />
            </div>
            <button className="btn w-full" type="submit">Importa ed elabora</button>
          </form>

          <form action={startScan} className="card space-y-3">
            <input type="hidden" name="projectId" value={project.id} />
            <h2 className="font-semibold">Scansione automatica</h2>
            {sfReady ? (
              <>
                <p className="text-xs text-green-700">Screaming Frog CLI disponibile.</p>
                <div>
                  <label className="label">Etichetta</label>
                  <input name="label" className="input" placeholder="Scansione CLI" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Max URL</label><input name="maxUrls" type="number" className="input" /></div>
                  <div><label className="label">Profondità</label><input name="maxDepth" type="number" className="input" /></div>
                </div>
                <div><label className="label">User agent</label><input name="userAgent" className="input" /></div>
                <div><label className="label">Max URL/sec</label><input name="maxUrlsPerSecond" type="number" step="0.1" className="input" /></div>
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" name="respectRobots" defaultChecked /> Rispetta robots.txt</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="crawlSubdomains" /> Sottodomini</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="jsRendering" /> Rendering JavaScript</label>
                </div>
                <button className="btn w-full" type="submit">Avvia scansione</button>
              </>
            ) : (
              <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
                Screaming Frog non è installato o configurato (<code>SF_CLI_PATH</code>). È disponibile solo l&apos;import manuale.
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
