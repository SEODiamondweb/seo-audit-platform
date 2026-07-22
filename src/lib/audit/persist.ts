import { prisma } from "../prisma";
import { runAuditEngine } from "./engine";
import { computeScore } from "./score";
import type { UrlRecord } from "./types";

// Cap AuditIssueUrl rows written per issue to keep inserts bounded on very
// large sites; affectedCount always reflects the true total.
const MAX_LINKS_PER_ISSUE = 2000;

/**
 * Persist crawled URLs for an audit, run the engine, and store the resulting
 * issues + score. Idempotent per audit: existing URLs/issues are replaced.
 */
export async function processAudit(auditId: string, records: UrlRecord[]) {
  // 1. Reset previous data for this audit (safe re-import).
  await prisma.auditIssue.deleteMany({ where: { auditId } });
  await prisma.crawledUrl.deleteMany({ where: { auditId } });

  // 2. Insert crawled URLs (dedup by URL — last one wins).
  const seen = new Map<string, UrlRecord>();
  for (const r of records) {
    if (!r.url) continue;
    seen.set(r.url, r);
  }
  const unique = [...seen.values()];

  await prisma.crawledUrl.createMany({
    data: unique.map((r) => ({
      auditId,
      url: r.url,
      contentType: r.contentType ?? null,
      statusCode: r.statusCode ?? null,
      indexability: (r.indexability as any) ?? "UNKNOWN",
      indexabilityStatus: r.indexabilityStatus ?? null,
      title: r.title ?? null,
      titleLength: r.titleLength ?? null,
      metaDescription: r.metaDescription ?? null,
      metaDescriptionLength: r.metaDescriptionLength ?? null,
      h1: r.h1 ?? null,
      h2: r.h2 ?? null,
      canonical: r.canonical ?? null,
      metaRobots: r.metaRobots ?? null,
      hreflang: r.hreflang ?? null,
      wordCount: r.wordCount ?? null,
      crawlDepth: r.crawlDepth ?? null,
      inlinks: r.inlinks ?? null,
      outlinks: r.outlinks ?? null,
      redirectUrl: r.redirectUrl ?? null,
      responseTimeMs: r.responseTimeMs ?? null,
      images: r.images ?? null,
      imagesMissingAlt: r.imagesMissingAlt ?? null,
      structuredData: r.structuredData ?? null,
      structuredDataTypes: r.structuredDataTypes ?? null,
      inSitemap: r.inSitemap ?? null,
      rawIssues: (r.rawIssues as any) ?? undefined,
    })),
    skipDuplicates: true,
  });

  // 3. Map URL string -> id for issue links.
  const stored = await prisma.crawledUrl.findMany({
    where: { auditId },
    select: { id: true, url: true },
  });
  const idByUrl = new Map(stored.map((s) => [s.url, s.id]));

  // 4. Run rules + score.
  const issues = runAuditEngine(unique);
  const { score, breakdown } = computeScore(issues, unique.length);

  // 5. Persist issues and their URL links.
  for (const issue of issues) {
    const created = await prisma.auditIssue.create({
      data: {
        auditId,
        ruleKey: issue.ruleKey,
        title: issue.title,
        category: issue.category as any,
        severity: issue.severity as any,
        priority: issue.priority as any,
        description: issue.description,
        seoImpact: issue.seoImpact,
        recommendation: issue.recommendation,
        effort: issue.effort as any,
        affectedCount: issue.matches.length,
        evidence: issue.evidence as any,
      },
    });

    const links = issue.matches
      .slice(0, MAX_LINKS_PER_ISSUE)
      .map((m) => ({ issueId: created.id, urlId: idByUrl.get(m.url), evidence: m.evidence ?? null }))
      .filter((l): l is { issueId: string; urlId: string; evidence: string | null } => Boolean(l.urlId));

    if (links.length > 0) {
      await prisma.auditIssueUrl.createMany({ data: links, skipDuplicates: true });
    }
  }

  // 6. Update audit rollups.
  await prisma.audit.update({
    where: { id: auditId },
    data: {
      status: "READY",
      score,
      scoreBreakdown: breakdown as any,
      totalUrls: unique.length,
    },
  });

  return { totalUrls: unique.length, issues: issues.length, score };
}
