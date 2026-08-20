import { describe, expect, it } from 'vitest';
import { computeScore, coverageFactor, gradeFor, priorityFor } from '../src/audit/score';
import { CATEGORY_WEIGHTS } from '../src/audit/types';
import type { AuditIssue } from '../src/audit/types';

function makeIssue(overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: overrides.id ?? 'issue-' + Math.random().toString(36).slice(2),
    title: 'Titolo',
    category: 'metadata',
    severity: 'medium',
    priority: 'P2',
    description: '',
    seoImpact: '',
    recommendation: '',
    effort: 'low',
    status: 'open',
    assignee: null,
    urls: [],
    affectedCount: 1,
    affectedRatio: 0.1,
    scorePenalty: 0,
    ...overrides,
  };
}

describe('coverageFactor', () => {
  it('non e mai zero anche per una sola URL', () => {
    expect(coverageFactor(0.001, false)).toBeGreaterThan(0.1);
  });

  it('cresce con la diffusione del problema', () => {
    expect(coverageFactor(0.5, false)).toBeGreaterThan(coverageFactor(0.05, false));
  });

  it('satura a 1 sulla copertura totale', () => {
    expect(coverageFactor(1, false)).toBeCloseTo(1, 5);
    expect(coverageFactor(1, true)).toBe(1);
  });

  it('maggiora quando sono coinvolte le pagine di primo livello', () => {
    expect(coverageFactor(0.2, true)).toBeGreaterThan(coverageFactor(0.2, false));
  });
});

describe('priorityFor', () => {
  it('mette sempre i problemi critici in P0', () => {
    expect(priorityFor('critical', 0.001)).toBe('P0');
  });

  it('promuove gli alti diffusi a P0', () => {
    expect(priorityFor('high', 0.5)).toBe('P0');
    expect(priorityFor('high', 0.01)).toBe('P1');
  });

  it('classifica i medi in base alla diffusione', () => {
    expect(priorityFor('medium', 0.5)).toBe('P1');
    expect(priorityFor('medium', 0.01)).toBe('P2');
  });

  it('tiene i bassi in P3', () => {
    expect(priorityFor('low', 1)).toBe('P3');
  });
});

describe('gradeFor', () => {
  it('mappa il punteggio sulle lettere', () => {
    expect(gradeFor(95)).toBe('A');
    expect(gradeFor(85)).toBe('B');
    expect(gradeFor(75)).toBe('C');
    expect(gradeFor(65)).toBe('D');
    expect(gradeFor(55)).toBe('E');
    expect(gradeFor(10)).toBe('F');
  });
});

describe('computeScore', () => {
  it('restituisce 100 senza problemi', () => {
    const score = computeScore([]);
    expect(score.total).toBe(100);
    expect(score.grade).toBe('A');
    expect(score.categories).toHaveLength(15);
  });

  it('non lascia che una categoria eroda piu del proprio peso', () => {
    const issues = Array.from({ length: 12 }, (_, i) =>
      makeIssue({
        id: 'metadata-' + i,
        category: 'metadata',
        severity: 'critical',
        affectedRatio: 1,
      }),
    );
    const score = computeScore(issues.map((issue) => ({ issue, touchesTopPages: true })));

    expect(score.total).toBe(Math.round(100 - CATEGORY_WEIGHTS.metadata));

    const metadata = score.categories.find((c) => c.category === 'metadata');
    expect(metadata?.penalty).toBeCloseTo(CATEGORY_WEIGHTS.metadata, 1);
    expect(metadata?.score).toBe(0);
  });

  it('somma le penalita di categorie diverse', () => {
    const score = computeScore([
      { issue: makeIssue({ id: 'a', category: 'metadata', severity: 'critical', affectedRatio: 1 }), touchesTopPages: false },
      { issue: makeIssue({ id: 'b', category: 'security', severity: 'critical', affectedRatio: 1 }), touchesTopPages: false },
    ]);
    expect(score.total).toBe(
      Math.round(100 - CATEGORY_WEIGHTS.metadata - CATEGORY_WEIGHTS.security),
    );
  });

  it('assegna a ogni issue la penalita effettiva', () => {
    const issue = makeIssue({ id: 'solo', category: 'images', severity: 'high', affectedRatio: 0.4 });
    const score = computeScore([{ issue, touchesTopPages: false }]);

    expect(issue.scorePenalty).toBeGreaterThan(0);
    expect(issue.scorePenalty).toBeLessThanOrEqual(CATEGORY_WEIGHTS.images);
    expect(score.total).toBeLessThan(100);
  });

  it('ignora le issue informative', () => {
    const issue = makeIssue({ id: 'info', severity: 'info', affectedRatio: 1 });
    const score = computeScore([{ issue, touchesTopPages: true }]);
    expect(score.total).toBe(100);
    expect(issue.scorePenalty).toBe(0);
  });
});
