export interface Heading {
  level: number;
  text: string;
}

export interface OutlineProblem {
  /** Tipo di anomalia nella gerarchia degli heading. */
  kind: 'skip' | 'empty' | 'multiple-h1' | 'missing-h1' | 'starts-below-h1';
  detail: string;
}

export interface OutlineAnalysis {
  headings: Heading[];
  problems: OutlineProblem[];
  /** Rappresentazione compatta per l'export CSV: "H1 Titolo > H2 Sezione > H3 Dettaglio". */
  summary: string;
}

const MAX_SUMMARY_HEADINGS = 20;

/**
 * Valuta la gerarchia degli heading di una pagina.
 *
 * Una struttura corretta non salta livelli: dopo un H2 può venire un H3, non direttamente un H4.
 * I salti sono quasi sempre il sintomo di heading scelti per l'aspetto grafico anziché per la
 * struttura, e privano Google e gli screen reader della gerarchia reale del contenuto.
 */
export function analyzeOutline(headings: Heading[]): OutlineAnalysis {
  const problems: OutlineProblem[] = [];
  const withText = headings.filter((h) => h.text.trim() !== '');

  const emptyCount = headings.length - withText.length;
  if (emptyCount > 0) {
    problems.push({
      kind: 'empty',
      detail: emptyCount + (emptyCount === 1 ? ' heading vuoto' : ' heading vuoti'),
    });
  }

  const h1s = withText.filter((h) => h.level === 1);
  if (h1s.length === 0 && withText.length > 0) {
    problems.push({ kind: 'missing-h1', detail: 'Nessun H1 con testo' });
  }
  if (h1s.length > 1) {
    problems.push({ kind: 'multiple-h1', detail: h1s.length + ' tag H1' });
  }

  if (withText.length > 0 && (withText[0] as Heading).level > 1) {
    problems.push({
      kind: 'starts-below-h1',
      detail: 'La struttura parte da H' + (withText[0] as Heading).level,
    });
  }

  let previous = 0;
  for (const heading of withText) {
    if (previous > 0 && heading.level > previous + 1) {
      problems.push({
        kind: 'skip',
        detail:
          'H' + previous + ' seguito da H' + heading.level + ' ("' + truncate(heading.text, 45) + '")',
      });
    }
    previous = heading.level;
  }

  const summary = withText
    .slice(0, MAX_SUMMARY_HEADINGS)
    .map((h) => 'H' + h.level + ' ' + truncate(h.text, 60))
    .join(' > ');

  return { headings: withText, problems, summary };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
}
