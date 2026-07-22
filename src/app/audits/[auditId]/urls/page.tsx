import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { UrlsTable, type UrlRow } from "@/components/tables/UrlsTable";

export const dynamic = "force-dynamic";

export default async function UrlExplorer({ params }: { params: { auditId: string } }) {
  const audit = await prisma.audit.findUnique({
    where: { id: params.auditId },
    include: { project: { include: { client: true } } },
  });
  if (!audit) notFound();

  const urls = await prisma.crawledUrl.findMany({
    where: { auditId: audit.id },
    orderBy: { crawlDepth: "asc" },
    take: 5000,
  });

  const rows: UrlRow[] = urls.map((u) => ({
    id: u.id,
    auditId: audit.id,
    url: u.url,
    statusCode: u.statusCode,
    indexability: u.indexability,
    title: u.title,
    titleLength: u.titleLength,
    wordCount: u.wordCount,
    crawlDepth: u.crawlDepth,
    inlinks: u.inlinks,
    responseTimeMs: u.responseTimeMs,
  }));

  return (
    <div>
      <PageHeader
        title="URL Explorer"
        subtitle={`${audit.label} · ${urls.length} URL`}
        breadcrumbs={[
          { href: `/projects/${audit.projectId}`, label: audit.project.name },
          { href: `/audits/${audit.id}`, label: audit.label },
          { href: `/audits/${audit.id}/urls`, label: "URL Explorer" },
        ]}
      />
      <UrlsTable rows={rows} />
    </div>
  );
}
