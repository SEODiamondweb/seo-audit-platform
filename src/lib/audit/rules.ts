import type { Rule, UrlRecord, IssueMatch } from "./types";

// Helpers ---------------------------------------------------------------------
const isHtml = (u: UrlRecord) =>
  !u.contentType || /html/i.test(u.contentType ?? "");
const isIndexable = (u: UrlRecord) => u.indexability === "INDEXABLE";
const has = (v: unknown) => v != null && String(v).trim() !== "";
const match = (u: UrlRecord, evidence?: string): IssueMatch => ({ url: u.url, evidence });

// Thresholds ------------------------------------------------------------------
export const THRESHOLDS = {
  titleMin: 30,
  titleMax: 60,
  metaMin: 70,
  metaMax: 160,
  thinContent: 200,
  slowResponseMs: 1000,
  deepCrawl: 5,
};

/**
 * The rule catalogue. Each rule is pure: (urls) => matching urls.
 * The engine converts non-empty matches into structured AuditIssues.
 */
export const RULES: Rule[] = [
  // --- Crawlability / indexing ---------------------------------------------
  {
    key: "INDEXABLE_NOINDEX",
    title: "Pagine indicizzabili con meta robots noindex",
    category: "CRAWLABILITY",
    severity: "HIGH",
    priority: "P1",
    effort: "LOW",
    description: "URL che restituiscono 200 ma contengono una direttiva noindex.",
    seoImpact: "Le pagine non verranno indicizzate, con perdita di visibilità organica.",
    recommendation: "Rimuovere noindex dalle pagine che devono essere indicizzate.",
    evaluate: (urls) =>
      urls
        .filter((u) => /noindex/i.test(u.metaRobots ?? "") && u.statusCode === 200)
        .map((u) => match(u, u.metaRobots ?? undefined)),
  },
  {
    key: "NON_INDEXABLE_PAGES",
    title: "Pagine non indicizzabili",
    category: "CRAWLABILITY",
    severity: "MEDIUM",
    priority: "P2",
    effort: "MEDIUM",
    description: "URL marcati come non indicizzabili da Screaming Frog.",
    seoImpact: "Riduzione delle pagine idonee al posizionamento.",
    recommendation: "Verificare che l'esclusione dall'indice sia intenzionale.",
    evaluate: (urls) =>
      urls
        .filter((u) => u.indexability === "NON_INDEXABLE")
        .map((u) => match(u, u.indexabilityStatus ?? undefined)),
  },
  {
    key: "ORPHAN_PAGES",
    title: "Pagine orfane (0 inlink interni)",
    category: "INTERNAL_LINKING",
    severity: "MEDIUM",
    priority: "P2",
    effort: "MEDIUM",
    description: "Pagine senza link interni in entrata.",
    seoImpact: "Difficoltà di scoperta e distribuzione del link equity.",
    recommendation: "Collegare le pagine orfane dalla struttura interna.",
    evaluate: (urls) =>
      urls
        .filter((u) => isHtml(u) && isIndexable(u) && (u.inlinks ?? 0) === 0)
        .map((u) => match(u, "0 inlinks")),
  },
  {
    key: "DEEP_PAGES",
    title: "Pagine troppo profonde",
    category: "INTERNAL_LINKING",
    severity: "LOW",
    priority: "P3",
    effort: "MEDIUM",
    description: `Pagine a profondità di crawl > ${THRESHOLDS.deepCrawl}.`,
    seoImpact: "Le pagine profonde ricevono meno crawl budget e autorità.",
    recommendation: "Appiattire l'architettura per le pagine importanti.",
    evaluate: (urls) =>
      urls
        .filter((u) => (u.crawlDepth ?? 0) > THRESHOLDS.deepCrawl)
        .map((u) => match(u, `depth ${u.crawlDepth}`)),
  },

  // --- Status codes ---------------------------------------------------------
  {
    key: "STATUS_5XX",
    title: "Errori server (5xx)",
    category: "STATUS_CODE",
    severity: "CRITICAL",
    priority: "P0",
    effort: "HIGH",
    description: "URL che restituiscono un errore server 5xx.",
    seoImpact: "Contenuti inaccessibili a utenti e crawler.",
    recommendation: "Investigare l'infrastruttura e ripristinare le risorse.",
    evaluate: (urls) =>
      urls.filter((u) => (u.statusCode ?? 0) >= 500).map((u) => match(u, `HTTP ${u.statusCode}`)),
  },
  {
    key: "STATUS_4XX",
    title: "Pagine non trovate (4xx)",
    category: "STATUS_CODE",
    severity: "HIGH",
    priority: "P1",
    effort: "MEDIUM",
    description: "URL che restituiscono un errore client 4xx.",
    seoImpact: "Link rotti, cattiva esperienza utente e crawl budget sprecato.",
    recommendation: "Correggere o reindirizzare gli URL 4xx.",
    evaluate: (urls) =>
      urls
        .filter((u) => (u.statusCode ?? 0) >= 400 && (u.statusCode ?? 0) < 500)
        .map((u) => match(u, `HTTP ${u.statusCode}`)),
  },
  {
    key: "BROKEN_INTERNAL_LINKS",
    title: "Link interni rotti",
    category: "INTERNAL_LINKING",
    severity: "HIGH",
    priority: "P1",
    effort: "MEDIUM",
    description: "URL 4xx/5xx raggiunti tramite link interni.",
    seoImpact: "Dispersione di link equity e navigazione interrotta.",
    recommendation: "Aggiornare i link interni verso URL validi.",
    evaluate: (urls) =>
      urls
        .filter((u) => (u.statusCode ?? 0) >= 400 && (u.inlinks ?? 0) > 0)
        .map((u) => match(u, `HTTP ${u.statusCode}, ${u.inlinks} inlinks`)),
  },

  // --- Redirect -------------------------------------------------------------
  {
    key: "REDIRECT_3XX",
    title: "Redirect (3xx)",
    category: "REDIRECT",
    severity: "MEDIUM",
    priority: "P2",
    effort: "LOW",
    description: "URL che restituiscono un redirect 3xx.",
    seoImpact: "Piccola perdita di equity e latenza aggiuntiva.",
    recommendation: "Aggiornare i link interni per puntare alla destinazione finale.",
    evaluate: (urls) =>
      urls
        .filter((u) => (u.statusCode ?? 0) >= 300 && (u.statusCode ?? 0) < 400)
        .map((u) => match(u, `→ ${u.redirectUrl ?? "?"}`)),
  },
  {
    key: "REDIRECT_CHAIN",
    title: "Redirect chain / loop",
    category: "REDIRECT",
    severity: "HIGH",
    priority: "P1",
    effort: "MEDIUM",
    description: "Redirect che puntano ad altri redirect o a se stessi (loop).",
    seoImpact: "Perdita di equity, latenza e possibili loop non risolvibili.",
    recommendation: "Ridurre le catene a un singolo redirect verso la destinazione finale.",
    evaluate: (urls) => {
      const targets = new Map(urls.map((u) => [u.url, u]));
      return urls
        .filter((u) => {
          if (!has(u.redirectUrl)) return false;
          if (u.redirectUrl === u.url) return true; // loop
          const dest = targets.get(u.redirectUrl!);
          return dest ? (dest.statusCode ?? 0) >= 300 && (dest.statusCode ?? 0) < 400 : false;
        })
        .map((u) => match(u, `→ ${u.redirectUrl}`));
    },
  },

  // --- Canonical ------------------------------------------------------------
  {
    key: "CANONICAL_MISSING",
    title: "Canonical mancante",
    category: "CANONICAL",
    severity: "MEDIUM",
    priority: "P2",
    effort: "LOW",
    description: "Pagine HTML indicizzabili senza tag canonical.",
    seoImpact: "Rischio di contenuti duplicati e consolidamento non controllato.",
    recommendation: "Aggiungere un canonical self-referencing dove appropriato.",
    evaluate: (urls) =>
      urls
        .filter((u) => isHtml(u) && isIndexable(u) && !has(u.canonical))
        .map((u) => match(u)),
  },
  {
    key: "CANONICAL_NON_SELF",
    title: "Canonical verso un altro URL",
    category: "CANONICAL",
    severity: "LOW",
    priority: "P3",
    effort: "LOW",
    description: "Pagine con canonical che punta a un URL diverso dal proprio.",
    seoImpact: "Le pagine potrebbero essere deindicizzate a favore del canonical.",
    recommendation: "Verificare che il canonical cross-URL sia intenzionale.",
    evaluate: (urls) =>
      urls
        .filter((u) => has(u.canonical) && u.canonical !== u.url && isHtml(u))
        .map((u) => match(u, `canonical → ${u.canonical}`)),
  },

  // --- Metadata -------------------------------------------------------------
  {
    key: "META_TITLE_MISSING",
    title: "Title mancante",
    category: "METADATA",
    severity: "HIGH",
    priority: "P1",
    effort: "LOW",
    description: "Pagine HTML indicizzabili senza title.",
    seoImpact: "Perdita di rilevanza e CTR nelle SERP.",
    recommendation: "Scrivere title unici e descrittivi per ogni pagina.",
    evaluate: (urls) =>
      urls.filter((u) => isHtml(u) && isIndexable(u) && !has(u.title)).map((u) => match(u)),
  },
  {
    key: "META_TITLE_LENGTH",
    title: "Title troppo corto o troppo lungo",
    category: "METADATA",
    severity: "LOW",
    priority: "P3",
    effort: "LOW",
    description: `Title fuori dall'intervallo ${THRESHOLDS.titleMin}-${THRESHOLDS.titleMax} caratteri.`,
    seoImpact: "Title troncati o poco descrittivi riducono il CTR.",
    recommendation: "Ottimizzare la lunghezza dei title.",
    evaluate: (urls) =>
      urls
        .filter((u) => isHtml(u) && has(u.title) && u.titleLength != null &&
          (u.titleLength < THRESHOLDS.titleMin || u.titleLength > THRESHOLDS.titleMax))
        .map((u) => match(u, `${u.titleLength} caratteri`)),
  },
  {
    key: "META_TITLE_DUPLICATE",
    title: "Title duplicati",
    category: "METADATA",
    severity: "MEDIUM",
    priority: "P2",
    effort: "MEDIUM",
    description: "Più pagine indicizzabili condividono lo stesso title.",
    seoImpact: "Cannibalizzazione e difficoltà di differenziazione nelle SERP.",
    recommendation: "Rendere unici i title delle pagine indicizzabili.",
    evaluate: (urls) => duplicatesBy(urls.filter((u) => isIndexable(u) && isHtml(u)), (u) => u.title),
  },
  {
    key: "META_DESC_MISSING",
    title: "Meta description mancante",
    category: "METADATA",
    severity: "MEDIUM",
    priority: "P2",
    effort: "LOW",
    description: "Pagine HTML indicizzabili senza meta description.",
    seoImpact: "Snippet generati automaticamente, CTR potenzialmente inferiore.",
    recommendation: "Aggiungere meta description uniche e persuasive.",
    evaluate: (urls) =>
      urls
        .filter((u) => isHtml(u) && isIndexable(u) && !has(u.metaDescription))
        .map((u) => match(u)),
  },
  {
    key: "META_DESC_LENGTH",
    title: "Meta description fuori lunghezza",
    category: "METADATA",
    severity: "LOW",
    priority: "P3",
    effort: "LOW",
    description: `Meta description fuori dall'intervallo ${THRESHOLDS.metaMin}-${THRESHOLDS.metaMax} caratteri.`,
    seoImpact: "Snippet troncati o poco informativi.",
    recommendation: "Ottimizzare la lunghezza delle meta description.",
    evaluate: (urls) =>
      urls
        .filter((u) => has(u.metaDescription) && u.metaDescriptionLength != null &&
          (u.metaDescriptionLength < THRESHOLDS.metaMin || u.metaDescriptionLength > THRESHOLDS.metaMax))
        .map((u) => match(u, `${u.metaDescriptionLength} caratteri`)),
  },

  // --- Headings -------------------------------------------------------------
  {
    key: "H1_MISSING",
    title: "H1 mancante",
    category: "HEADING",
    severity: "MEDIUM",
    priority: "P2",
    effort: "LOW",
    description: "Pagine HTML indicizzabili senza H1.",
    seoImpact: "Perdita di segnali sul tema principale della pagina.",
    recommendation: "Aggiungere un H1 unico e pertinente.",
    evaluate: (urls) =>
      urls.filter((u) => isHtml(u) && isIndexable(u) && !has(u.h1)).map((u) => match(u)),
  },
  {
    key: "H1_DUPLICATE",
    title: "H1 duplicati",
    category: "HEADING",
    severity: "LOW",
    priority: "P3",
    effort: "MEDIUM",
    description: "Più pagine indicizzabili condividono lo stesso H1.",
    seoImpact: "Segnali tematici sovrapposti tra pagine.",
    recommendation: "Differenziare gli H1 delle pagine.",
    evaluate: (urls) => duplicatesBy(urls.filter((u) => isIndexable(u)), (u) => u.h1),
  },

  // --- Content --------------------------------------------------------------
  {
    key: "THIN_CONTENT",
    title: "Contenuto scarno (thin content)",
    category: "CONTENT",
    severity: "MEDIUM",
    priority: "P2",
    effort: "HIGH",
    description: `Pagine indicizzabili con meno di ${THRESHOLDS.thinContent} parole.`,
    seoImpact: "Basso valore percepito e difficoltà di posizionamento.",
    recommendation: "Ampliare i contenuti o consolidare le pagine.",
    evaluate: (urls) =>
      urls
        .filter((u) => isHtml(u) && isIndexable(u) && u.wordCount != null && u.wordCount < THRESHOLDS.thinContent)
        .map((u) => match(u, `${u.wordCount} parole`)),
  },

  // --- Images ---------------------------------------------------------------
  {
    key: "IMAGES_MISSING_ALT",
    title: "Immagini senza alt text",
    category: "IMAGES",
    severity: "LOW",
    priority: "P3",
    effort: "MEDIUM",
    description: "Pagine con immagini prive di attributo alt.",
    seoImpact: "Accessibilità ridotta e perdita di contesto per l'image search.",
    recommendation: "Aggiungere alt text descrittivi alle immagini.",
    evaluate: (urls) =>
      urls
        .filter((u) => (u.imagesMissingAlt ?? 0) > 0)
        .map((u) => match(u, `${u.imagesMissingAlt} immagini`)),
  },

  // --- Hreflang -------------------------------------------------------------
  {
    key: "HREFLANG_ERROR",
    title: "Errori hreflang",
    category: "HREFLANG",
    severity: "MEDIUM",
    priority: "P2",
    effort: "MEDIUM",
    description: "Pagine con problemi hreflang segnalati da Screaming Frog.",
    seoImpact: "Targeting internazionale non corretto.",
    recommendation: "Verificare la reciprocità e i codici lingua hreflang.",
    evaluate: (urls) =>
      urls
        .filter((u) => (u.rawIssues ?? []).some((i) => /hreflang/i.test(i)))
        .map((u) => match(u)),
  },

  // --- Structured data ------------------------------------------------------
  {
    key: "STRUCTURED_DATA_INVALID",
    title: "Dati strutturati non validi",
    category: "STRUCTURED_DATA",
    severity: "LOW",
    priority: "P3",
    effort: "MEDIUM",
    description: "Pagine con errori nei dati strutturati.",
    seoImpact: "Perdita di rich result idonei.",
    recommendation: "Correggere gli errori di validazione schema.org.",
    evaluate: (urls) =>
      urls
        .filter((u) => (u.rawIssues ?? []).some((i) => /structured data|schema/i.test(i)))
        .map((u) => match(u)),
  },

  // --- Performance ----------------------------------------------------------
  {
    key: "SLOW_RESPONSE",
    title: "Tempo di risposta elevato",
    category: "PERFORMANCE",
    severity: "MEDIUM",
    priority: "P2",
    effort: "HIGH",
    description: `Pagine con tempo di risposta > ${THRESHOLDS.slowResponseMs} ms.`,
    seoImpact: "Peggior esperienza utente e possibile impatto sul ranking.",
    recommendation: "Ottimizzare TTFB, caching e infrastruttura.",
    evaluate: (urls) =>
      urls
        .filter((u) => (u.responseTimeMs ?? 0) > THRESHOLDS.slowResponseMs)
        .map((u) => match(u, `${u.responseTimeMs} ms`)),
  },

  // --- Sitemap --------------------------------------------------------------
  {
    key: "INDEXABLE_NOT_IN_SITEMAP",
    title: "Pagine indicizzabili non in sitemap",
    category: "SITEMAP",
    severity: "LOW",
    priority: "P3",
    effort: "LOW",
    description: "Pagine indicizzabili assenti dalla sitemap XML.",
    seoImpact: "Scoperta più lenta da parte dei motori di ricerca.",
    recommendation: "Includere le pagine importanti nella sitemap.",
    evaluate: (urls) =>
      urls
        .filter((u) => isHtml(u) && isIndexable(u) && u.inSitemap === false)
        .map((u) => match(u)),
  },

  // --- Security -------------------------------------------------------------
  {
    key: "NON_HTTPS",
    title: "URL non HTTPS",
    category: "SECURITY",
    severity: "HIGH",
    priority: "P1",
    effort: "MEDIUM",
    description: "URL serviti su HTTP anziché HTTPS.",
    seoImpact: "Segnale di sicurezza negativo e possibili avvisi del browser.",
    recommendation: "Forzare HTTPS e reindirizzare le versioni HTTP.",
    evaluate: (urls) =>
      urls.filter((u) => /^http:\/\//i.test(u.url)).map((u) => match(u)),
  },
];

/** Group URLs by a derived key and return matches for keys with >1 URL. */
function duplicatesBy(urls: UrlRecord[], keyFn: (u: UrlRecord) => string | null | undefined): IssueMatch[] {
  const groups = new Map<string, UrlRecord[]>();
  for (const u of urls) {
    const k = keyFn(u);
    if (!has(k)) continue;
    const norm = String(k).trim().toLowerCase();
    const arr = groups.get(norm) ?? [];
    arr.push(u);
    groups.set(norm, arr);
  }
  const out: IssueMatch[] = [];
  for (const [, arr] of groups) {
    if (arr.length > 1) {
      for (const u of arr) out.push(match(u, `${arr.length} occorrenze`));
    }
  }
  return out;
}
