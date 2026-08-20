import { extractKeywords, keywordPlacement, overlapRatio } from './keywords';
import { analyzeOutline } from './outline';
import { computeReadability } from './readability';
import type { KeywordPlacement, KeywordStat } from './keywords';
import type { Heading, OutlineProblem } from './outline';
import type { ReadabilityStats } from './readability';

export type { KeywordStat, KeywordPlacement } from './keywords';
export type { Heading, OutlineProblem, OutlineAnalysis } from './outline';
export type { ReadabilityStats } from './readability';
export { readabilityLabel } from './readability';
export { extractKeywords, keywordPlacement, overlapRatio, tokenize, normalizeForMatch } from './keywords';
export { analyzeOutline } from './outline';
export { computeReadability } from './readability';
export { refineKeywords } from './refine';
export { stem, stemTokens } from './stemmer';
export { isLocation } from './locations';
export type { RefinablePage } from './refine';

export interface ContentAnalysis {
  keywords: KeywordStat[];
  /** La locuzione più rilevante della pagina: è quella su cui si valuta la coerenza on-page. */
  primaryKeyword: string | null;
  placement: KeywordPlacement | null;
  /** Densità della keyword principale, 0..1. Oltre il 4% è sintomo di sovra-ottimizzazione. */
  primaryDensity: number;
  readability: ReadabilityStats;
  headings: Heading[];
  outlineProblems: OutlineProblem[];
  outlineSummary: string;
  /** Sovrapposizione fra title e H1, 0..1: se è nulla i due parlano di argomenti diversi. */
  titleH1Overlap: number;
}

export interface ContentInput {
  bodyText: string;
  paragraphs: number;
  headings: Heading[];
  title: string | null;
  description: string | null;
  url: string;
  imageAlts: string[];
}

export function analyzeContent(input: ContentInput): ContentAnalysis {
  const outline = analyzeOutline(input.headings);
  const h1 = outline.headings.find((h) => h.level === 1)?.text ?? null;

  // Solo H2-H6: l'H1 serve a verificare la coerenza, non a determinare l'argomento.
  const sectionHeadings = outline.headings
    .filter((h) => h.level >= 2)
    .map((h) => h.text)
    .join(' ');

  const keywords = extractKeywords(input.bodyText, { headingsText: sectionHeadings });
  const primary = keywords[0];

  return {
    keywords,
    primaryKeyword: primary ? primary.term : null,
    primaryDensity: primary ? primary.density : 0,
    placement: primary
      ? keywordPlacement(primary.term, {
          title: input.title,
          h1,
          description: input.description,
          url: input.url,
          imageAlts: input.imageAlts,
        })
      : null,
    readability: computeReadability(input.bodyText, input.paragraphs),
    headings: outline.headings,
    outlineProblems: outline.problems,
    outlineSummary: outline.summary,
    titleH1Overlap: overlapRatio(input.title, h1),
  };
}
