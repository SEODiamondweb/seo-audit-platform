import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentOrg } from "@/lib/data";
import { createClient } from "@/lib/actions";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const org = await currentOrg();
  const clients = await prisma.client.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { projects: true } } },
  });

  return (
    <div>
      <PageHeader title="Clienti" subtitle="Gestisci i clienti e i relativi progetti." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {clients.length === 0 ? (
            <Empty>Nessun cliente. Creane uno dal modulo a destra.</Empty>
          ) : (
            <div className="space-y-2">
              {clients.map((c) => (
                <Link key={c.id} href={`/clients/${c.id}`} className="card flex items-center justify-between hover:border-brand-300">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.contactEmail ?? "—"}</div>
                  </div>
                  <span className="text-sm text-slate-500">{c._count.projects} progetti</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <form action={createClient} className="card h-fit space-y-3">
          <h2 className="font-semibold">Nuovo cliente</h2>
          <div>
            <label className="label">Nome *</label>
            <input name="name" required className="input" placeholder="Acme S.r.l." />
          </div>
          <div>
            <label className="label">Email di contatto</label>
            <input name="contactEmail" type="email" className="input" placeholder="marketing@acme.com" />
          </div>
          <div>
            <label className="label">Note</label>
            <textarea name="notes" className="input" rows={3} />
          </div>
          <button className="btn w-full" type="submit">Crea cliente</button>
        </form>
      </div>
    </div>
  );
}
