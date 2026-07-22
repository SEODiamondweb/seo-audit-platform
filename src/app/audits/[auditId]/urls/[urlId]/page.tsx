import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

const FIELDS: [string, keyof Awaited<ReturnType<typeof load>>["url"]][] = [
  ["Content Type", "contentType"], ["Status Code", "statusCode"], ["Indexability", "indexability"],
  ["Indexability Status", "indexabilityStatus"], ["Title", "title"], ["Title Length", "titleLength"],
  ["Meta Description", "metaDescription"], ["Meta Desc Length", "metaDescriptionLength"], ["H1", "h1"], ["H2", "h2"],
  ["Canonical", "canonical"], ["Meta Robots", "metaRobots"], ["Hreflang", "hreflang"], ["Word Count", "wordCount"],
  ["Crawl Depth", "crawlDepth"], ["Inlinks", "inlinks"], ["Outlinks", "outlinks"], ["Redirect URL", "redirectUrl"],
  ["Response Time (ms)", "responseTimeMs"], ["Images", "images"], ["Images Missing Alt", "imagesMissingAlt"],
  ["Structured Data", "structuredData"], ["Structured Data Types", "structuredDataTypes"], ["In Sitemap", "inSitemap"],
];

async function load(urlId: string) {
  const url = await prisma.crawledUrl.findUnique({
    where: { id: urlId },
    include: { issueLinks: { include: { issue: true } }, audit: { include: { project: true } } },
  });
  if (!url) notFound();
  return { url };
}

export default async function UrlDetail({ params }: { params: { auditId: string; urlId: string } }) {
  const { url } = await load(params.urlId);

  return (
    <div>
      <PageHeader
        title="Dettaglio URL"
        subtitle={url.url}
        breadcrumbs={[
          { href: `/audits/${params.auditId}`, label: url.audit.label },
          { href: `/audits/${params.auditId}/urls`, label: "URL Explorer" },
          { href: "#", label: "Dettaglio" },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="mb-3 font-semibold">Attributi</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {FIELDS.map(([label, key]) => (
              <div key={label as string} className="flex justify-between border-b border-slate-100 py-1">
                <dt className="text-slate-500">{label}</dt>
                <dd className="max-w-[60%] truncate text-right font-medium" title={String(url[key] ?? "")}>
                  {url[key] == null || url[key] === "" ? "—" : String(url[key])}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card h-fit">
          <h2 className="mb-3 font-semibold">Issue collegate ({url.issueLinks.length})</h2>
          <div className="space-y-2">
            {url.issueLinks.length === 0 && <p className="text-sm text-slate-400">Nessuna issue.</p>}
            {url.issueLinks.map((l) => (
              <Link key={l.id} href={`/issues/${l.issue.id}`} className="block rounded-md border border-slate-200 p-2 hover:border-brand-300">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{l.issue.title}</span>
                  <Badge tone={l.issue.severity}>{l.issue.severity}</Badge>
                </div>
                {l.evidence && <div className="mt-1 text-xs text-slate-500">{l.evidence}</div>}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
