/**
 * Demo seed: an organization, users, a client, a project and two manual-import
 * audits (a baseline and a follow-up) so the comparison and reports work out of
 * the box. No credentials or license data are stored.
 */
import { prisma } from "../src/lib/prisma";
import { processAudit } from "../src/lib/audit/persist";
import type { UrlRecord } from "../src/lib/audit/types";

function makeUrls(seed: number, count: number): UrlRecord[] {
  const urls: UrlRecord[] = [];
  for (let i = 0; i < count; i++) {
    const bad = (i + seed) % 5 === 0;
    const worse = (i + seed) % 9 === 0;
    urls.push({
      url: `https://demo-shop.example/page-${i}`,
      contentType: "text/html",
      statusCode: worse ? 404 : bad ? 301 : 200,
      indexability: bad ? "NON_INDEXABLE" : "INDEXABLE",
      indexabilityStatus: bad ? "Redirected" : "",
      title: i % 7 === 0 ? "" : `Prodotto ${i} — Demo Shop`,
      titleLength: i % 7 === 0 ? 0 : 24,
      metaDescription: i % 4 === 0 ? "" : `Descrizione del prodotto ${i}.`,
      metaDescriptionLength: i % 4 === 0 ? 0 : 30,
      h1: i % 6 === 0 ? "" : `Prodotto ${i}`,
      canonical: bad ? "" : `https://demo-shop.example/page-${i}`,
      metaRobots: worse ? "noindex, follow" : "index, follow",
      wordCount: i % 8 === 0 ? 80 : 600,
      crawlDepth: (i % 7) + 1,
      inlinks: i % 11 === 0 ? 0 : 5,
      outlinks: 12,
      redirectUrl: bad ? `https://demo-shop.example/page-${i}-new` : "",
      responseTimeMs: i % 10 === 0 ? 1800 : 220,
      images: 4,
      imagesMissingAlt: i % 3 === 0 ? 2 : 0,
      structuredData: i % 2 === 0,
      inSitemap: i % 5 !== 0,
      rawIssues: i % 13 === 0 ? ["Hreflang: Missing Return Links"] : [],
    });
  }
  return urls;
}

async function main() {
  console.log("Seeding demo data…");

  const org = await prisma.organization.upsert({
    where: { slug: "demo-agency" },
    update: {},
    create: { name: "Demo SEO Agency", slug: "demo-agency" },
  });

  const owner = await prisma.user.upsert({
    where: { email: "owner@demo-agency.test" },
    update: {},
    create: { organizationId: org.id, email: "owner@demo-agency.test", name: "Owner", role: "OWNER" },
  });
  await prisma.user.upsert({
    where: { email: "seo@demo-agency.test" },
    update: {},
    create: { organizationId: org.id, email: "seo@demo-agency.test", name: "SEO Specialist", role: "MEMBER" },
  });

  const client = await prisma.client.create({
    data: { organizationId: org.id, name: "Demo Shop S.r.l.", contactEmail: "marketing@demo-shop.example" },
  });

  const project = await prisma.project.create({
    data: { clientId: client.id, name: "Demo Shop — sito principale", domain: "https://demo-shop.example" },
  });

  // Baseline audit (more issues).
  const baseline = await prisma.audit.create({
    data: {
      projectId: project.id,
      label: "Baseline",
      source: "MANUAL_IMPORT",
      auditDate: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      config: { note: "Import demo baseline" },
    },
  });
  const baseRes = await processAudit(baseline.id, makeUrls(0, 60));
  console.log(`Baseline: ${baseRes.totalUrls} URL, ${baseRes.issues} issue, score ${baseRes.score}`);

  // Follow-up audit (fewer issues → higher score).
  const followup = await prisma.audit.create({
    data: {
      projectId: project.id,
      label: "Follow-up",
      source: "MANUAL_IMPORT",
      config: { note: "Import demo follow-up" },
    },
  });
  const upRes = await processAudit(followup.id, makeUrls(3, 60));
  console.log(`Follow-up: ${upRes.totalUrls} URL, ${upRes.issues} issue, score ${upRes.score}`);

  // A couple of demo tasks tied to top issues.
  const topIssues = await prisma.auditIssue.findMany({
    where: { auditId: followup.id },
    orderBy: { affectedCount: "desc" },
    take: 2,
  });
  for (const issue of topIssues) {
    await prisma.task.create({
      data: {
        projectId: project.id,
        issueId: issue.id,
        title: `Risolvere: ${issue.title}`,
        description: issue.recommendation,
        priority: issue.priority,
        assigneeId: owner.id,
        status: "TODO",
      },
    });
  }

  console.log("Seed completato.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
