import {
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_WEIGHTS,
  SEVERITY_IMPACT,
} from './types';
import type { AuditIssue, AuditScore, Category, CategoryScore, Priority, Severity } from './types';

/**
 * Fattore di copertura di una issue: 0..1.
 *
 * - Una issue che tocca una sola URL su mille non è irrilevante, quindi la curva parte da 0.15.
 * - La radice quadrata evita che un problema diffuso al 10% pesi solo un decimo di uno diffuso al 100%:
 *   in SEO la diffusione conta, ma anche un problema circoscritto va risolto.
 * - Le pagine a profondità 0-1 (home e primo livello) valgono di più: la copertura viene maggiorata del 15%.
 */
export function coverageFactor(affectedRatio: number, touchesTopPages: boolean): number {
  const clamped = Math.min(1, Math.max(0, affectedRatio));
  const base = 0.15 + 0.85 * Math.sqrt(clamped);
  const boosted = touchesTopPages ? base * 1.15 : base;
  return Math.min(1, boosted);
}

export function priorityFor(severity: Severity, affectedRatio: number): Priority {
  switch (severity) {
    case 'critical':
      return 'P0';
    case 'high':
      return affectedRatio > 0.1 ? 'P0' : 'P1';
    case 'medium':
      return affectedRatio > 0.25 ? 'P1' : 'P2';
    case 'low':
      return 'P3';
    default:
      return 'P3';
  }
}

export function gradeFor(score: number): AuditScore['grade'] {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  if (score >= 50) return 'E';
  return 'F';
}

export interface ScoreInput {
  issue: AuditIssue;
  touchesTopPages: boolean;
}

/**
 * Calcola il punteggio 0-100 e la ripartizione per categoria.
 * Ogni categoria può erodere al massimo il proprio peso: un solo ambito disastrato
 * non azzera il punteggio complessivo, ma quindici ambiti mediocri si.
 *
 * Muta `issue.scorePenalty` con la penalità effettivamente applicata (dopo il capping).
 */
export function computeScore(inputs: ScoreInput[]): AuditScore {
  const rawByCategory = new Map<Category, { total: number; entries: ScoreInput[] }>();

  for (const category of CATEGORIES) {
    rawByCategory.set(category, { total: 0, entries: [] });
  }

  const rawPenalties = new Map<string, number>();

  for (const input of inputs) {
    const { issue, touchesTopPages } = input;
    const impact = SEVERITY_IMPACT[issue.severity];
    const coverage = coverageFactor(issue.affectedRatio, touchesTopPages);
    const raw = impact * coverage;
    rawPenalties.set(issue.id, raw);
    const bucket = rawByCategory.get(issue.category);
    if (bucket) {
      bucket.total += raw;
      bucket.entries.push(input);
    }
  }

  const categories: CategoryScore[] = [];
  let totalPenalty = 0;

  for (const category of CATEGORIES) {
    const weight = CATEGORY_WEIGHTS[category];
    const bucket = rawByCategory.get(category);
    const rawTotal = bucket ? bucket.total : 0;
    const capped = Math.min(1, rawTotal);
    const penalty = weight * capped;
    // Se il totale grezzo superava 1, le penalità delle singole issue vengono
    // riscalate in proporzione così che la somma resti uguale alla penalità di categoria.
    const scale = rawTotal > 0 ? capped / rawTotal : 0;

    for (const entry of bucket ? bucket.entries : []) {
      const raw = rawPenalties.get(entry.issue.id) ?? 0;
      entry.issue.scorePenalty = Number((raw * scale * weight).toFixed(2));
    }

    totalPenalty += penalty;
    categories.push({
      category,
      label: CATEGORY_LABELS[category],
      weight,
      penalty: Number(penalty.toFixed(2)),
      score: Math.round(100 - capped * 100),
      issueCount: bucket ? bucket.entries.length : 0,
    });
  }

  const total = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

  return { total, grade: gradeFor(total), categories };
}
