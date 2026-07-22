import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createProject } from "@/lib/actions";
import { PageHeader, Empty, ScoreBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientDetail({ params }: { params: { clientId: string } }) {
  const client = await prisma.client.findUnique({
    where: { id: params.clientId },
    include: {
      projects: {
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { audits: true } },
          audits: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!client) notFound();

  return (
    <div>
      <PageHeader
        title={client.name}
        subtitle={client.contactEmail ?? undefined}
        breadcrumbs={[{ href: "/clients", label: "Clienti" }, { href: `/clients/${client.id}`, label: client.name }]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Progetti</h2>
          {client.projects.length === 0 ? (
            <Empty>Nessun progetto per questo cliente.</Empty>
          ) : (
            <div className="space-y-2">
              {client.projects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="card flex items-center justify-between hover:border-brand-300">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.domain}</div>
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    <div>{p._count.audits} audit</div>
                    <div>Ultimo: <ScoreBadge score={p.audits[0]?.score ?? null} /></div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <form action={createProject} className="card h-fit space-y-3">
          <input type="hidden" name="clientId" value={client.id} />
          <h2 className="font-semibold">Nuovo progetto</h2>
          <div>
            <label className="label">Nome *</label>
            <input name="name" required className="input" placeholder="Sito principale" />
          </div>
          <div>
            <label className="label">Dominio *</label>
            <input name="domain" required className="input" placeholder="https://acme.com" />
          </div>
          <button className="btn w-full" type="submit">Crea progetto</button>
        </form>
      </div>
    </div>
  );
}
