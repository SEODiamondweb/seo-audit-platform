import { describe, expect, it } from 'vitest';
import {
  analyzeContent,
  analyzeOutline,
  computeReadability,
  extractKeywords,
  keywordPlacement,
  overlapRatio,
  readabilityLabel,
  tokenize,
  stem,
  isLocation,
} from '../src/content';
import { parseHtml } from '../src/crawler/parse';

describe('tokenize', () => {
  it('conserva le lettere accentate', () => {
    expect(tokenize('Città perché così')).toEqual(['città', 'perché', 'così']);
  });

  it('separa sugli apostrofi e sulla punteggiatura', () => {
    expect(tokenize("L'agenzia, e il web-marketing.")).toEqual([
      'l', 'agenzia', 'e', 'il', 'web', 'marketing',
    ]);
  });
});

describe('extractKeywords', () => {
  const text = [
    'La consulenza SEO per aziende parte sempre da un audit tecnico.',
    'Una consulenza SEO per aziende seria misura i risultati.',
    'Chi cerca consulenza SEO per aziende vuole risultati misurabili.',
  ].join(' ');

  const keywords = extractKeywords(text);

  it('individua la locuzione ricorrente come keyword principale', () => {
    // Con n-grammi fino a 3 parole vince 'seo per aziende': le stopword interne sono ammesse
    // perche fanno parte di query reali, quelle iniziali e finali no.
    expect(keywords[0].term).toContain('seo');
    expect(keywords[0].term).toContain('aziende');
  });

  it('preferisce le locuzioni alle parole singole', () => {
    expect(keywords[0].words).toBeGreaterThan(1);
  });

  it('non restituisce locuzioni che iniziano o finiscono con una stopword', () => {
    for (const k of keywords) {
      expect(k.term.startsWith('per ')).toBe(false);
      expect(k.term.startsWith('la ')).toBe(false);
      expect(k.term.endsWith(' per')).toBe(false);
      expect(k.term.endsWith(' da')).toBe(false);
    }
  });

  it('scarta le parole isolate non ripetute', () => {
    expect(keywords.some((k) => k.term === 'misurabili')).toBe(false);
  });

  it('calcola una densita coerente', () => {
    expect(keywords[0].density).toBeGreaterThan(0);
    expect(keywords[0].density).toBeLessThan(1);
  });

  it('restituisce un elenco vuoto su testo vuoto', () => {
    expect(extractKeywords('')).toEqual([]);
  });
});

describe('keywordPlacement', () => {
  const page = {
    title: 'Consulenza SEO per aziende | Diamondweb',
    h1: 'Consulenza SEO su misura',
    description: 'Analisi e strategia per la tua azienda.',
    url: 'https://example.com/consulenza-seo-aziende/',
    imageAlts: ['team al lavoro'],
  };

  it('riconosce la keyword nel title', () => {
    expect(keywordPlacement('consulenza seo', page).inTitle).toBe(true);
  });

  it('riconosce la keyword nello slug ignorando i trattini', () => {
    expect(keywordPlacement('consulenza seo', page).inUrl).toBe(true);
  });

  it('non trova quello che non c e', () => {
    const placement = keywordPlacement('sviluppo app mobile', page);
    expect(placement.inTitle).toBe(false);
    expect(placement.coverage).toBe(0);
  });

  it('conta le collocazioni coperte', () => {
    const placement = keywordPlacement('consulenza seo', page);
    expect(placement.coverage).toBeGreaterThanOrEqual(2);
    expect(placement.coverage).toBeLessThanOrEqual(5);
  });
});

describe('overlapRatio', () => {
  it('e 1 su testi equivalenti a meno di stopword', () => {
    expect(overlapRatio('Consulenza SEO', 'La consulenza SEO')).toBe(1);
  });

  it('e 0 su argomenti diversi', () => {
    expect(overlapRatio('Consulenza SEO', 'Ricette di cucina')).toBe(0);
  });

  it('e 0 se manca uno dei due', () => {
    expect(overlapRatio(null, 'qualcosa')).toBe(0);
  });
});

describe('computeReadability', () => {
  it('calcola il Gulpease nella scala 0-100', () => {
    const stats = computeReadability('Il gatto dorme. Il cane corre. La casa e bella.', 1);
    expect(stats.gulpease).toBeGreaterThanOrEqual(0);
    expect(stats.gulpease).toBeLessThanOrEqual(100);
    expect(stats.sentences).toBe(3);
  });

  it('assegna un punteggio piu alto alle frasi brevi', () => {
    const facile = computeReadability('Il sole splende. Il mare e blu. Il cielo e sereno.', 1);
    const difficile = computeReadability(
      'La determinazione dell approccio metodologico implica una valutazione preliminare ' +
        'delle condizioni infrastrutturali sottostanti, considerate nella loro complessita.',
      1,
    );
    expect(facile.gulpease).toBeGreaterThan(difficile.gulpease);
  });

  it('non divide per zero su testo vuoto', () => {
    const stats = computeReadability('', 0);
    expect(stats.words).toBe(0);
    expect(stats.gulpease).toBe(0);
    expect(stats.avgSentenceWords).toBe(0);
  });

  it('etichetta la leggibilita', () => {
    expect(readabilityLabel(85)).toBe('Molto facile');
    expect(readabilityLabel(30)).toBe('Difficile');
  });
});

describe('analyzeOutline', () => {
  it('accetta una gerarchia corretta', () => {
    const outline = analyzeOutline([
      { level: 1, text: 'Titolo' },
      { level: 2, text: 'Sezione' },
      { level: 3, text: 'Dettaglio' },
      { level: 2, text: 'Altra sezione' },
    ]);
    expect(outline.problems).toEqual([]);
  });

  it('segnala i salti di livello', () => {
    const outline = analyzeOutline([
      { level: 1, text: 'Titolo' },
      { level: 4, text: 'Salto' },
    ]);
    expect(outline.problems.some((p) => p.kind === 'skip')).toBe(true);
  });

  it('segnala gli heading vuoti', () => {
    const outline = analyzeOutline([
      { level: 1, text: 'Titolo' },
      { level: 2, text: '  ' },
    ]);
    expect(outline.problems.some((p) => p.kind === 'empty')).toBe(true);
    expect(outline.headings).toHaveLength(1);
  });

  it('segnala H1 mancante e H1 multipli', () => {
    expect(
      analyzeOutline([{ level: 2, text: 'Solo H2' }]).problems.some((p) => p.kind === 'missing-h1'),
    ).toBe(true);
    expect(
      analyzeOutline([
        { level: 1, text: 'Uno' },
        { level: 1, text: 'Due' },
      ]).problems.some((p) => p.kind === 'multiple-h1'),
    ).toBe(true);
  });

  it('costruisce un outline leggibile', () => {
    const outline = analyzeOutline([
      { level: 1, text: 'Titolo' },
      { level: 2, text: 'Sezione' },
    ]);
    expect(outline.summary).toBe('H1 Titolo > H2 Sezione');
  });
});

describe('analyzeContent', () => {
  it('mette insieme keyword, collocazione, leggibilita e outline', () => {
    const bodyText = [
      'La consulenza SEO per aziende richiede metodo.',
      'Ogni consulenza SEO per aziende parte da un audit.',
      'La nostra consulenza SEO per aziende misura i risultati nel tempo.',
    ].join(' ');

    const analysis = analyzeContent({
      bodyText,
      paragraphs: 3,
      headings: [
        { level: 1, text: 'Consulenza SEO per aziende' },
        { level: 2, text: 'Come lavoriamo' },
      ],
      title: 'Consulenza SEO per aziende | Diamondweb',
      description: 'Metodo e risultati misurabili.',
      url: 'https://example.com/consulenza-seo-aziende/',
      imageAlts: [],
    });

    expect(analysis.primaryKeyword).toContain('seo');
    expect(analysis.placement?.inTitle).toBe(true);
    expect(analysis.placement?.inH1).toBe(true);
    expect(analysis.placement?.inUrl).toBe(true);
    expect(analysis.titleH1Overlap).toBeGreaterThan(0);
    expect(analysis.outlineProblems).toEqual([]);
    expect(analysis.readability.words).toBeGreaterThan(20);
  });
});

describe('integrazione con il parser HTML', () => {
  const html = `<!doctype html>
<html lang="it">
<head><title>Consulenza SEO per aziende</title>
<meta name="description" content="Metodo e risultati."></head>
<body>
  <h1>Consulenza SEO per aziende</h1>
  <p>La consulenza SEO per aziende richiede metodo e misurazione continua dei risultati.</p>
  <h4>Sezione con livello saltato</h4>
  <p>Ogni consulenza SEO per aziende parte da un audit tecnico accurato del sito.</p>
  <h2></h2>
</body></html>`;

  const parsed = parseHtml(html, 'https://example.com/consulenza-seo-aziende/');

  it('popola l analisi dei contenuti', () => {
    expect(parsed.content.primaryKeyword).toContain('seo');
    expect(parsed.content.readability.words).toBeGreaterThan(10);
  });

  it('rileva il salto di gerarchia e l heading vuoto', () => {
    const kinds = parsed.content.outlineProblems.map((p) => p.kind);
    expect(kinds).toContain('skip');
    expect(kinds).toContain('empty');
  });

  it('conta i paragrafi con testo', () => {
    expect(parsed.content.readability.paragraphs).toBe(2);
  });
});

describe('stem', () => {
  it('riconduce singolare e plurale alla stessa forma', () => {
    expect(stem('linea')).toBe(stem('linee'));
    expect(stem('pannello')).toBe(stem('pannelli'));
    expect(stem('copertura')).toBe(stem('coperture'));
    expect(stem('impianto')).toBe(stem('impianti'));
  });

  it('gestisce le uscite palatali', () => {
    expect(stem('amico')).toBe(stem('amici'));
    expect(stem('amica')).toBe(stem('amiche'));
    expect(stem('lago')).toBe(stem('laghi'));
  });

  it('lascia intatte le parole corte, dove accorciare creerebbe collisioni', () => {
    expect(stem('via')).toBe('via');
    expect(stem('seo')).toBe('seo');
  });

  it('non tocca le parole che finiscono per consonante', () => {
    expect(stem('web')).toBe('web');
    expect(stem('marketing')).toBe('marketing');
  });
});

describe('località', () => {
  it('riconosce capoluoghi e regioni', () => {
    expect(isLocation('torino')).toBe(true);
    expect(isLocation('Milano')).toBe(true);
    expect(isLocation('piemonte')).toBe(true);
    expect(isLocation('provincia')).toBe(true);
  });

  it('non tratta come località le parole comuni omonime di comuni', () => {
    // "linea vita" e un dispositivo anticaduta: Vita e anche un comune del trapanese,
    // ma filtrarlo spezzerebbe una keyword legittima.
    expect(isLocation('vita')).toBe(false);
    expect(isLocation('prato')).toBe(false);
    expect(isLocation('massa')).toBe(false);
    expect(isLocation('alba')).toBe(false);
  });

  it('esclude le località dalle keyword estratte', () => {
    const text = [
      'Installiamo impianti fotovoltaici a Torino e provincia.',
      'I nostri impianti fotovoltaici a Torino sono certificati.',
      'Scegli impianti fotovoltaici per la tua azienda di Torino.',
    ].join(' ');
    const keywords = extractKeywords(text);
    expect(keywords.some((k) => k.term.split(' ').includes('torino'))).toBe(false);
    expect(keywords[0].term).toContain('impianti fotovoltaici');
  });
});

describe('varianti singolare/plurale nelle keyword', () => {
  const text = [
    'La linea vita va installata da personale abilitato.',
    'Le linee vita richiedono una verifica periodica.',
    'Ogni linea vita viene certificata dopo il collaudo.',
    'Installiamo linee vita su coperture di ogni tipo.',
  ].join(' ');

  const keywords = extractKeywords(text);

  it('raggruppa le varianti in un unico argomento', () => {
    const varianti = keywords.filter((k) => /line[ae] vita/.test(k.term));
    expect(varianti).toHaveLength(1);
    expect(varianti[0].count).toBe(4);
  });

  it('mostra la forma piu usata nel testo', () => {
    const primo = keywords.find((k) => /line[ae] vita/.test(k.term));
    expect(['linea vita', 'linee vita']).toContain(primo?.term);
  });

  it('trova la keyword anche se title e H1 usano l altro numero', () => {
    const placement = keywordPlacement('linea vita', {
      title: 'Linee vita certificate | Atena',
      h1: 'Linee vita su misura',
      description: null,
      url: 'https://example.com/linee-vita/',
      imageAlts: [],
    });
    expect(placement.inTitle).toBe(true);
    expect(placement.inH1).toBe(true);
    expect(placement.inUrl).toBe(true);
  });

  it('non confonde parole che condividono solo il prefisso', () => {
    const placement = keywordPlacement('linea', {
      title: 'Servizi lineari e modulari',
      h1: null,
      description: null,
      url: 'https://example.com/servizi/',
      imageAlts: [],
    });
    expect(placement.inTitle).toBe(false);
  });
});
