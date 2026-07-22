import { describe, it, expect } from "vitest";
import { renderReportHtml, renderReportCsv, type ReportData } from "@/lib/report/report";

const data: ReportData = {
  auditLabel: "Audit Q3",
  projectName: "Example",
  clientName: "ACME",
  domain: "example.com",
  auditDate: "2026-07-21",
  score: 68,
  totalUrls: 120,
  counts: { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4, INFO: 0 },
  issues: [
    {
      ruleKey: "STATUS_5XX",
      title: "Errori server",
      category: "STATUS_CODE",
      severity: "CRITICAL",
      priority: "P0",
      description: "d",
      seoImpact: "impatto",
      recommendation: "fix",
      effort: "HIGH",
      affectedCount: 4,
      sampleUrls: ["https://example.com/a"],
    },
  ],
  roadmap: [
    { window: "30", issues: [] },
    { window: "60", issues: [] },
    { window: "90", issues: [] },
  ],
};

describe("report rendering", () => {
  it("renders self-contained HTML with score and issues", () => {
    const html = renderReportHtml(data);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("68");
    expect(html).toContain("Errori server");
    expect(html).toContain("Executive Summary");
    expect(html).toContain("Roadmap 30 / 60 / 90");
  });

  it("escapes HTML in values", () => {
    const html = renderReportHtml({
      ...data,
      issues: [{ ...data.issues[0], title: "<script>x</script>" }],
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders CSV with header and rows", () => {
    const csv = renderReportCsv(data);
    expect(csv.split("\n")[0]).toContain("ruleKey");
    expect(csv).toContain("STATUS_5XX");
  });
});
