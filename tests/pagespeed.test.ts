import { describe, expect, it } from 'vitest';
import { cwvLabel, formatMs, parsePsiResponse } from '../src/pagespeed';

/** Fixture ridotta ma fedele alla struttura reale della risposta PSI v5. */
const RESPONSE = {
  lighthouseResult: {
    categories: { performance: { score: 0.42 } },
    audits: {
      'first-contentful-paint': { numericValue: 1800.5 },
      'largest-contentful-paint': { numericValue: 4200 },
      'total-blocking-time': { numericValue: 350 },
      'cumulative-layout-shift': { numericValue: 0.24 },
      'speed-index': { numericValue: 5100 },
    },
  },
  loadingExperience: {
    overall_category: 'AVERAGE',
    origin_fallback: true,
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100, category: 'AVERAGE' },
      INTERACTION_TO_NEXT_PAINT: { percentile: 250, category: 'AVERAGE' },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 15, category: 'FAST' },
    },
  },
};

describe('parsePsiResponse', () => {
  const parsed = parsePsiResponse(RESPONSE as never, 'mobile');

  it('estrae il punteggio in scala 0-100', () => {
    expect(parsed.lab.performanceScore).toBe(42);
  });

  it('estrae le metriche di laboratorio', () => {
    expect(parsed.lab.lcpMs).toBe(4200);
    expect(parsed.lab.tbtMs).toBe(350);
    expect(parsed.lab.cls).toBe(0.24);
  });

  it('estrae i dati sul campo, riportando il CLS in scala reale', () => {
    expect(parsed.field?.overall).toBe('AVERAGE');
    expect(parsed.field?.lcpMs).toBe(3100);
    expect(parsed.field?.inpMs).toBe(250);
    // Il percentile 15 corrisponde a un CLS di 0.15.
    expect(parsed.field?.cls).toBeCloseTo(0.15, 5);
    expect(parsed.field?.originFallback).toBe(true);
  });

  it('regge una risposta senza dati sul campo', () => {
    const noField = parsePsiResponse(
      { lighthouseResult: RESPONSE.lighthouseResult, loadingExperience: { metrics: {} } } as never,
      'desktop',
    );
    expect(noField.field).toBeNull();
    expect(noField.lab.performanceScore).toBe(42);
  });

  it('regge una risposta vuota senza lanciare', () => {
    const empty = parsePsiResponse({} as never, 'mobile');
    expect(empty.lab.performanceScore).toBeNull();
    expect(empty.field).toBeNull();
  });
});

describe('formattazione', () => {
  it('mostra i millisecondi sotto il secondo e i secondi sopra', () => {
    expect(formatMs(350)).toBe('350 ms');
    expect(formatMs(4200)).toBe('4,2 s');
    expect(formatMs(null)).toBe('—');
  });

  it('traduce i verdetti CWV', () => {
    expect(cwvLabel('FAST')).toBe('Buoni');
    expect(cwvLabel('SLOW')).toBe('Scarsi');
    expect(cwvLabel(null)).toBe('—');
  });
});
