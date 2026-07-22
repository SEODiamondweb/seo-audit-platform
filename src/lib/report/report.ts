export interface ReportIssue {
  ruleKey: string;
  title: string;
  category: string;
  severity: string;
  priority: string;
  description: string;
  seoImpact: string;
  recommendation: string;
  effort: string;
  affectedCount: number;
  sampleUrls: string[];
}

export interface ReportData {
  auditLabel: string;
  projectName: string;
  clientName: string;
  domain: string;
  auditDate: string;
  score: number | null;
  totalUrls: number;
  counts: Record<string, number>; // severity -> count
  issues: ReportIssue[];
  roadmap: { window: "30" | "60" | "90"; issues: ReportIssue[] }[];
}

const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

/** Assemble the full report data model for an audit. */
export async function buildReportData(auditId: string): Promise<ReportData> {
  const { prisma } = await import("../prisma");
  const audit = await prisma.audit.findUniqueOrThrow({
    where: { id: auditId },
    include: {
      project: { include: { client: true } },
      issues: {
        include: { urls: { include: { url: { select: { url: true } } }, take: 5 } },
      },
    },
  });

  const issues: ReportIssue[] = audit.issues
    .map((i) => ({
      ruleKey: i.ruleKey,
      title: i.title,
      category: i.category,
      severity: i.severity,
      priority: i.priority,
      description: i.description,
      seoImpact: i.seoImpact,
      recommendation: i.recommendation,
      effort: i.effort,
      affectedCount: i.affectedCount,
      sampleUrls: i.urls.map((u) => u.url.url),
    }))
    .sort(
      (a, b) =>
        SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) ||
        b.affectedCount - a.affectedCount,
    );

  const counts: Record<string, number> = {};
  for (const i of issues) counts[i.severity] = (counts[i.severity] ?? 0) + 1;

  // Roadmap buckets: P0/P1 → 30 days, P2 → 60 days, P3 → 90 days.
  const roadmap = [
    { window: "30" as const, issues: issues.filter((i) => i.priority === "P0" || i.priority === "P1") },
    { window: "60" as const, issues: issues.filter((i) => i.priority === "P2") },
    { window: "90" as const, issues: issues.filter((i) => i.priority === "P3") },
  ];

  return {
    auditLabel: audit.label,
    projectName: audit.project.name,
    clientName: audit.project.client.name,
    domain: audit.project.domain,
    auditDate: audit.auditDate.toISOString().slice(0, 10),
    score: audit.score,
    totalUrls: audit.totalUrls,
    counts,
    issues,
    roadmap,
  };
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Render a self-contained, printable HTML report. */
export function renderReportHtml(d: ReportData): string {
  const critical = d.issues.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
  const scoreColor = (d.score ?? 0) >= 80 ? "#16a34a" : (d.score ?? 0) >= 50 ? "#d97706" : "#dc2626";

  const issueRows = d.issues
    .map(
      (i) => `<tr>
        <td><span class="badge sev-${i.severity}">${esc(i.severity)}</span></td>
        <td>${esc(i.priority)}</td>
        <td><strong>${esc(i.title)}</strong><br><span class="muted">${esc(i.category)}</span></td>
        <td class="num">${i.affectedCount}</td>
        <td>${esc(i.recommendation)}</td>
      </tr>`,
    )
    .join("");

  const roadmapHtml = d.roadmap
    .map(
      (r) => `<div class="road">
        <h3>Prossimi ${r.window} giorni</h3>
        ${
          r.issues.length
            ? `<ul>${r.issues.map((i) => `<li><strong>${esc(i.title)}</strong> — ${i.affectedCount} URL (${esc(i.effort)} effort)</li>`).join("")}</ul>`
            : `<p class="muted">Nessuna attività pianificata.</p>`
        }
      </div>`,
    )
    .join("");

  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SEO Audit — ${esc(d.projectName)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:0;padding:40px;line-height:1.5}
  h1{margin:0 0 4px} .muted{color:#666;font-size:12px}
  .head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #eee;padding-bottom:16px;margin-bottom:24px}
  .score{font-size:52px;font-weight:800;color:${scoreColor}}
  .cards{display:flex;gap:12px;margin:16px 0}
  .card{flex:1;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px}
  .card b{font-size:26px;display:block}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  th,td{text-align:left;padding:8px;border-bottom:1px solid #eee;vertical-align:top}
  th{background:#f1f5f9} td.num{text-align:right;font-variant-numeric:tabular-nums}
  .badge{padding:2px 8px;border-radius:99px;color:#fff;font-size:11px;font-weight:700}
  .sev-CRITICAL{background:#dc2626}.sev-HIGH{background:#ea580c}.sev-MEDIUM{background:#d97706}.sev-LOW{background:#65a30d}.sev-INFO{background:#0891b2}
  .road{background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:8px 0}
  h2{margin-top:32px;border-left:4px solid #3b6fe0;padding-left:10px}
</style></head><body>
<div class="head">
  <div>
    <h1>SEO Audit — ${esc(d.projectName)}</h1>
    <div class="muted">${esc(d.clientName)} · ${esc(d.domain)} · ${esc(d.auditDate)} · ${esc(d.auditLabel)}</div>
  </div>
  <div style="text-align:right"><div class="score">${d.score ?? "—"}</div><div class="muted">SEO Score / 100</div></div>
</div>

<h2>Executive Summary</h2>
<p>L'audit ha analizzato <strong>${d.totalUrls}</strong> URL e rilevato <strong>${d.issues.length}</strong> tipologie di problema.
Sono presenti <strong>${critical.length}</strong> criticità ad alta priorità che richiedono intervento immediato.</p>
<div class="cards">
  ${SEV_ORDER.map((s) => `<div class="card"><span class="muted">${s}</span><b>${d.counts[s] ?? 0}</b></div>`).join("")}
</div>

<h2>Criticità principali</h2>
${
  critical.length
    ? `<ul>${critical.slice(0, 8).map((i) => `<li><strong>${esc(i.title)}</strong> — ${i.affectedCount} URL. ${esc(i.seoImpact)}</li>`).join("")}</ul>`
    : `<p class="muted">Nessuna criticità critica o alta rilevata.</p>`
}

<h2>Issue per priorità</h2>
<table><thead><tr><th>Severità</th><th>Priorità</th><th>Issue</th><th class="num">URL</th><th>Soluzione consigliata</th></tr></thead>
<tbody>${issueRows || '<tr><td colspan="5" class="muted">Nessuna issue.</td></tr>'}</tbody></table>

<h2>Roadmap 30 / 60 / 90 giorni</h2>
${roadmapHtml}

<p class="muted" style="margin-top:40px">Report generato automaticamente dalla SEO Audit Platform.</p>
</body></html>`;
}

/** Render issues as CSV. */
export function renderReportCsv(d: ReportData): string {
  const header = ["ruleKey", "title", "category", "severity", "priority", "effort", "affectedCount", "seoImpact", "recommendation"];
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [header.join(",")];
  for (const i of d.issues) {
    lines.push([i.ruleKey, i.title, i.category, i.severity, i.priority, i.effort, i.affectedCount, i.seoImpact, i.recommendation].map(q).join(","));
  }
  return lines.join("\n");
}

/**
 * Render the HTML report to PDF using Playwright's bundled Chromium when
 * available. Falls back to null (caller serves HTML) if Playwright is absent.
 */
export async function renderReportPdf(html: string): Promise<Buffer | null> {
  try {
    // Dynamic, unresolved import so the app builds/runs even without Playwright
    // installed. The specifier is computed to avoid static type resolution.
    const mod: any = await import(/* @vite-ignore */ ["play", "wright"].join(""));
    const chromium = mod.chromium;
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" } });
    await browser.close();
    return pdf as Buffer;
  } catch {
    return null;
  }
}
