import type { GeneratedIssue, Severity } from "./types";

/**
 * Compute a 0..100 SEO health score.
 *
 * The score starts at 100 and subtracts a penalty per issue. Each penalty
 * scales with:
 *   - severity weight (critical worst)
 *   - the share of the site affected (percentage of crawled URLs)
 *   - importance of the affected pages (approximated by inverse crawl depth,
 *     handled upstream via evidence; here we use affected share as proxy)
 *
 * The penalty is capped per issue so a single rule cannot zero the score, and
 * the final value is clamped to [0, 100].
 */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  CRITICAL: 30,
  HIGH: 18,
  MEDIUM: 9,
  LOW: 3,
  INFO: 0.5,
};

// Max penalty a single issue can contribute.
const PER_ISSUE_CAP = 25;

export interface ScoreBreakdownItem {
  ruleKey: string;
  severity: Severity;
  affected: number;
  pctAffected: number;
  penalty: number;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdownItem[];
  totalPenalty: number;
}

export function computeScore(issues: GeneratedIssue[], totalUrls: number): ScoreResult {
  const denom = Math.max(totalUrls, 1);
  const breakdown: ScoreBreakdownItem[] = [];
  let totalPenalty = 0;

  for (const issue of issues) {
    const affected = issue.matches.length;
    const pct = affected / denom; // 0..1 share of the site
    const weight = SEVERITY_WEIGHT[issue.severity];

    // Scale factor grows with reach but with diminishing returns (sqrt),
    // so a critical issue on a few URLs still hurts, and a broad issue hurts more.
    const reach = Math.min(1, Math.sqrt(pct) * 1.3);
    const raw = weight * (0.35 + 0.65 * reach);
    const penalty = Math.min(PER_ISSUE_CAP, Math.round(raw * 10) / 10);

    totalPenalty += penalty;
    breakdown.push({
      ruleKey: issue.ruleKey,
      severity: issue.severity,
      affected,
      pctAffected: Math.round(pct * 1000) / 10,
      penalty,
    });
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
  breakdown.sort((a, b) => b.penalty - a.penalty);
  return { score, breakdown, totalPenalty: Math.round(totalPenalty * 10) / 10 };
}
