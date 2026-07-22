import { NextResponse } from "next/server";
import { buildReportData, renderReportHtml, renderReportCsv, renderReportPdf } from "@/lib/report/report";

export const dynamic = "force-dynamic";

/**
 * Download an audit report in the requested format.
 *   GET /api/reports/:auditId?format=html|pdf|csv
 * PDF falls back to HTML when Playwright/Chromium is not installed.
 */
export async function GET(
  req: Request,
  { params }: { params: { auditId: string } },
) {
  const format = new URL(req.url).searchParams.get("format") ?? "html";
  let data;
  try {
    data = await buildReportData(params.auditId);
  } catch {
    return NextResponse.json({ error: "Audit non trovato" }, { status: 404 });
  }

  const base = `seo-audit-${data.projectName}-${data.auditDate}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();

  if (format === "csv") {
    return new NextResponse(renderReportCsv(data), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    });
  }

  const html = renderReportHtml(data);

  if (format === "pdf") {
    const pdf = await renderReportPdf(html);
    if (pdf) {
      return new NextResponse(pdf as any, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${base}.pdf"`,
        },
      });
    }
    // Fallback: serve HTML with a note when Chromium is unavailable.
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "X-PDF-Fallback": "playwright-missing" },
    });
  }

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
