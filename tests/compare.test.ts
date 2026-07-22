import { describe, it, expect } from "vitest";
import { diffAudits } from "@/lib/compare/compare";

describe("diffAudits", () => {
  const result = diffAudits({
    base: {
      score: 60,
      issues: [
        { ruleKey: "STATUS_4XX", title: "4xx", severity: "HIGH", affectedCount: 5 },
        { ruleKey: "META_TITLE_MISSING", title: "title", severity: "HIGH", affectedCount: 3 },
      ],
      urls: [
        { url: "https://a.com/1", statusCode: 200, title: "One", canonical: "https://a.com/1", indexability: "INDEXABLE" },
        { url: "https://a.com/removed", statusCode: 200, title: "R", canonical: null, indexability: "INDEXABLE" },
      ],
    },
    current: {
      score: 72,
      issues: [
        { ruleKey: "META_TITLE_MISSING", title: "title", severity: "HIGH", affectedCount: 1 },
        { ruleKey: "SLOW_RESPONSE", title: "slow", severity: "MEDIUM", affectedCount: 2 },
      ],
      urls: [
        { url: "https://a.com/1", statusCode: 301, title: "One v2", canonical: "https://a.com/1", indexability: "NON_INDEXABLE" },
        { url: "https://a.com/new", statusCode: 200, title: "New", canonical: null, indexability: "INDEXABLE" },
      ],
    },
  });

  it("computes score delta", () => {
    expect(result.scoreDelta).toBe(12);
  });

  it("classifies new/resolved/persistent issues", () => {
    expect(result.newIssues.map((i) => i.ruleKey)).toContain("SLOW_RESPONSE");
    expect(result.resolvedIssues.map((i) => i.ruleKey)).toContain("STATUS_4XX");
    expect(result.persistentIssues[0].ruleKey).toBe("META_TITLE_MISSING");
    expect(result.persistentIssues[0].fromCount).toBe(3);
    expect(result.persistentIssues[0].toCount).toBe(1);
  });

  it("tracks url set and field changes", () => {
    expect(result.newUrls).toContain("https://a.com/new");
    expect(result.removedUrls).toContain("https://a.com/removed");
    expect(result.statusChanges[0]).toMatchObject({ from: 200, to: 301 });
    expect(result.titleChanges[0]).toMatchObject({ from: "One", to: "One v2" });
    expect(result.indexabilityChanges[0]).toMatchObject({ from: "INDEXABLE", to: "NON_INDEXABLE" });
  });
});
