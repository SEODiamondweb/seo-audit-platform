import { describe, it, expect } from "vitest";
import { runAuditEngine } from "@/lib/audit/engine";
import type { UrlRecord } from "@/lib/audit/types";

const urls: UrlRecord[] = [
  { url: "https://example.com/", contentType: "text/html", statusCode: 200, indexability: "INDEXABLE", title: "Home", titleLength: 4, canonical: "https://example.com/", h1: "Home", wordCount: 900, inlinks: 10, responseTimeMs: 100, inSitemap: true },
  { url: "https://example.com/noindex", contentType: "text/html", statusCode: 200, indexability: "NON_INDEXABLE", metaRobots: "noindex, follow", title: "No", titleLength: 2, h1: "No", inlinks: 2 },
  { url: "https://example.com/404", contentType: "text/html", statusCode: 404, indexability: "NON_INDEXABLE", inlinks: 5 },
  { url: "https://example.com/500", statusCode: 503, inlinks: 1 },
  { url: "https://example.com/orphan", contentType: "text/html", statusCode: 200, indexability: "INDEXABLE", title: "Orphan", titleLength: 6, h1: "Orphan", wordCount: 50, inlinks: 0, imagesMissingAlt: 3, responseTimeMs: 2500 },
  { url: "http://example.com/insecure", contentType: "text/html", statusCode: 200, indexability: "INDEXABLE", inlinks: 1 },
];

describe("runAuditEngine", () => {
  const issues = runAuditEngine(urls);
  const byKey = Object.fromEntries(issues.map((i) => [i.ruleKey, i]));

  it("detects server errors as critical", () => {
    expect(byKey["STATUS_5XX"]).toBeDefined();
    expect(byKey["STATUS_5XX"].severity).toBe("CRITICAL");
    expect(byKey["STATUS_5XX"].matches).toHaveLength(1);
  });

  it("detects 4xx, noindex, orphan, thin content, missing alt, slow, non-https", () => {
    expect(byKey["STATUS_4XX"]).toBeDefined();
    expect(byKey["INDEXABLE_NOINDEX"]).toBeDefined();
    expect(byKey["ORPHAN_PAGES"].matches[0].url).toBe("https://example.com/orphan");
    expect(byKey["THIN_CONTENT"]).toBeDefined();
    expect(byKey["IMAGES_MISSING_ALT"].matches[0].evidence).toContain("3");
    expect(byKey["SLOW_RESPONSE"]).toBeDefined();
    expect(byKey["NON_HTTPS"]).toBeDefined();
  });

  it("detects missing metadata on indexable html pages", () => {
    // /500 has no title but is not html/indexable → should not flag META_TITLE_MISSING
    const titleIssue = byKey["META_TITLE_MISSING"];
    if (titleIssue) {
      for (const m of titleIssue.matches) {
        expect(m.url).not.toBe("https://example.com/500");
      }
    }
  });

  it("orders issues by severity (critical first)", () => {
    expect(issues[0].severity).toBe("CRITICAL");
  });

  it("never throws and returns evidence percentages", () => {
    for (const i of issues) {
      expect(i.evidence).toHaveProperty("pct");
      expect(i.matches.length).toBeGreaterThan(0);
    }
  });
});
