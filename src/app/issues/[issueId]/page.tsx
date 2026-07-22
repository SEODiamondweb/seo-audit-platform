import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateIssue, createTask } from "@/lib/actions";
import { PageHeader, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function IssueDetail({ params }: { params: { issueId: string } }) {
  const issue = await prisma.auditIssue.findUnique({
    where: { id: params.issueId },
    include: {
      audit: { include: { project: { include: { client: true } } } },
      urls: { include: { url: true }, take: 200 },
      assignee: true,
    },
  });
  if (!issue) notFound();

  const users = await prisma.user.findMany({
    where: { organization: { clients: { some: { projects: { some: { audits: { some: { id: issue.auditId } } } } } } } },
  });

  return (
    <div>
      <PageHeader
        title={issue.title}
        breadcrumbs={[
          { href: `/projects/${issue.audit.projectId}`, label: issue.audit.project.name },
          { href: `/audits/${issue.auditId}`, label: issue.audit.label },
          { href: "#", label: "Issue" },
        ]}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={issue.severity}>{issue.severity}</Badge>
        <Badge>{issue.category}</Badge>
        <Badge>Priorità {issue.priority}</Badge>
        <Badge>Effort {issue.effort}</Badge>
        <Badge>{issue.affectedCount} URL</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card">
            <h3 className="mb-1 font-semibold">Descrizione</h3>
            <p className="text-sm text-slate-600">{issue.description}</p>
            <h3 className="mb-1 mt-4 font-semibold">Impatto SEO</h3>
            <p className="text-sm text-slate-600">{issue.seoImpact}</p>
            <h3 className="mb-1 mt-4 font-semibold">Soluzione consigliata</h3>
            <p className="text-sm text-slate-600">{issue.recommendation}</p>
          </div>

          <div className="card">
            <h3 className="mb-2 font-semibold">URL coinvolte ({issue.affectedCount})</h3>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {issue.urls.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="py-1">
                        <Link href={`/audits/${issue.auditId}/urls/${l.urlId}`} className="text-brand-700 hover:underline">{l.url.url}</Link>
                      </td>
                      <td className="py-1 text-right text-xs text-slate-500">{l.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <form action={updateIssue} className="card space-y-3">
            <input type="hidden" name="id" value={issue.id} />
            <h3 className="font-semibold">Gestione</h3>
            <div>
              <label className="label">Stato</label>
              <select name="status" defaultValue={issue.status} className="input">
                {["OPEN", "IN_PROGRESS", "RESOLVED", "IGNORED", "WONT_FIX"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Priorità</label>
              <select name="priority" defaultValue={issue.priority} className="input">
                {["P0", "P1", "P2", "P3"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Assegnatario</label>
              <select name="assigneeId" defaultValue={issue.assigneeId ?? ""} className="input">
                <option value="">— nessuno —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
              </select>
            </div>
            <button className="btn w-full" type="submit">Salva</button>
          </form>

          <form action={createTask} className="card space-y-3">
            <input type="hidden" name="projectId" value={issue.audit.projectId} />
            <input type="hidden" name="issueId" value={issue.id} />
            <input type="hidden" name="priority" value={issue.priority} />
            <h3 className="font-semibold">Crea task da questa issue</h3>
            <input name="title" required className="input" defaultValue={`Risolvere: ${issue.title}`} />
            <textarea name="description" className="input" rows={2} defaultValue={issue.recommendation} />
            <button className="btn w-full" type="submit">Crea task</button>
          </form>
        </div>
      </div>
    </div>
  );
}
