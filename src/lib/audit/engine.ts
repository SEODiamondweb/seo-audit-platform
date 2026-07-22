import { RULES } from "./rules";
import type { GeneratedIssue, UrlRecord } from "./types";

/**
 * Run the full rule catalogue over a set of crawled URLs and produce
 * structured issues (only rules with at least one match are returned).
 */
export function runAuditEngine(urls: UrlRecord[]): GeneratedIssue[] {
  const issues: GeneratedIssue[] = [];
  for (const rule of RULES) {
    let matches;
    try {
      matches = rule.evaluate(urls);
    } catch {
      continue; // a faulty rule must never break the whole audit
    }
    if (matches.length === 0) continue;

    issues.push({
      ruleKey: rule.key,
      title: rule.title,
      category: rule.category,
      severity: rule.severity,
      priority: rule.priority,
      description: rule.description,
      seoImpact: rule.seoImpact,
      recommendation: rule.recommendation,
      effort: rule.effort,
      matches,
      evidence: {
        affected: matches.length,
        total: urls.length,
        pct: urls.length ? Math.round((matches.length / urls.length) * 1000) / 10 : 0,
      },
    });
  }
  // Sort by severity then affected count for stable, meaningful ordering.
  const sevRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  return issues.sort(
    (a, b) => sevRank[a.severity] - sevRank[b.severity] || b.matches.length - a.matches.length,
  );
}
