import { describe, it, expect } from "vitest";
import { computeScore } from "@/lib/audit/score";
import type { GeneratedIssue } from "@/lib/audit/types";

function issue(severity: GeneratedIssue["severity"], affected: number): GeneratedIssue {
  return {
    ruleKey: `R_${severity}_${affected}`,
    title: "x",
    category: "METADATA",
    severity,
    priority: "P2",
    description: "",
    seoImpact: "",
    recommendation: "",
    effort: "LOW",
    matches: Array.from({ length: affected }, (_, i) => ({ url: `u${i}` })),
  };
}

describe("computeScore", () => {
  it("returns 100 for a clean site", () => {
    expect(computeScore([], 100).score).toBe(100);
  });

  it("clamps between 0 and 100", () => {
    const many = Array.from({ length: 20 }, () => issue("CRITICAL", 100));
    const r = computeScore(many, 100);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("penalises critical more than low", () => {
    const crit = computeScore([issue("CRITICAL", 50)], 100).score;
    const low = computeScore([issue("LOW", 50)], 100).score;
    expect(crit).toBeLessThan(low);
  });

  it("penalises broader issues more (reach)", () => {
    const wide = computeScore([issue("MEDIUM", 90)], 100).score;
    const narrow = computeScore([issue("MEDIUM", 5)], 100).score;
    expect(wide).toBeLessThan(narrow);
  });

  it("caps a single issue penalty", () => {
    const r = computeScore([issue("CRITICAL", 100)], 100);
    expect(r.breakdown[0].penalty).toBeLessThanOrEqual(25);
  });
});
