import {
  CATEGORY_LABELS,
  EFFORT_LABELS,
  SEVERITY_LABELS,
} from '../audit/types';
import type {
  AuditIssue,
  AuditResult,
  Priority,
  Severity,
} from '../audit/types';
import { escapeHtml, formatPercent, truncate } from '../utils/text';
import { readabilityLabel } from '../content';
import { cwvLabel, formatMs } from '../pagespeed';
import type { PsiLabMetrics, PsiStrategyResult } from '../pagespeed';
import type { BotStats } from '../crawlers/report';
import { shortPath } from '../utils/url';

export interface ReportBranding {
  brandName: string;
  brandColor: string;
  /** Data URI (o path assoluto file://) del logo da mostrare in copertina. */
  logoDataUri?: string;
}

/** Massimo di URL elencate per ogni issue nel PDF: oltre diventa illeggibile. */
const MAX_URLS_IN_REPORT = 25;

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#b91c1c',
  high: '#c2410c',
  medium: '#a16207',
  low: '#0369a1',
  info: '#475569',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  P0: 'P0 - Bloccante',
  P1: 'P1 - Alta',
  P2: 'P2 - Media',
  P3: 'P3 - Bassa',
};

const PRIORITY_DESCRIPTIONS: Record<Priority, string> = {
  P0: 'Interventi che bloccano indicizzazione o traffico. Da risolvere immediatamente.',
  P1: 'Problemi con impatto diretto e ampio sul posizionamento organico.',
  P2: 'Ottimizzazioni con impatto misurabile nel medio periodo.',
  P3: 'Rifiniture e buone pratiche da pianificare quando le priorità superiori sono chiuse.',
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return (
    date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' +
    date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return seconds + 's';
  return minutes + 'm ' + seconds + 's';
}

function scoreColor(score: number): string {
  if (score >= 80) return '#15803d';
  if (score >= 60) return '#a16207';
  if (score >= 40) return '#c2410c';
  return '#b91c1c';
}

function scoreVerdict(score: number): string {
  if (score >= 90) return 'Solida: la base tecnica è in ordine, restano rifiniture.';
  if (score >= 80) return 'Buona: nessun blocco strutturale, margini di ottimizzazione concreti.';
  if (score >= 60)
    return 'Sufficiente: presenti problemi che limitano il potenziale organico del sito.';
  if (score >= 40)
    return 'Critica: diversi ambiti compromettono indicizzazione e visibilità.';
  return 'Grave: il sito presenta problemi tecnici che impediscono un posizionamento efficace.';
}

function severityBadge(severity: Severity): string {
  return (
    '<span class="badge" style="background:' +
    SEVERITY_COLORS[severity] +
    '">' +
    escapeHtml(SEVERITY_LABELS[severity]) +
    '</span>'
  );
}

function urlTable(issue: AuditIssue): string {
  if (issue.urls.length === 0) return '';

  const rows = issue.urls
    .slice(0, MAX_URLS_IN_REPORT)
    .map(
      (entry) =>
        '<tr><td class="url-cell"><a class="url-path" href="' +
        escapeHtml(entry.url) +
        '">' +
        escapeHtml(shortPath(entry.url, 62)) +
        '</a></td><td class="evidence-cell">' +
        escapeHtml(truncate(entry.evidence, 90)) +
        '</td></tr>',
    )
    .join('');

  const remaining = issue.affectedCount - Math.min(issue.urls.length, MAX_URLS_IN_REPORT);
  const more =
    remaining > 0
      ? '<p class="more-urls">e altre ' +
        remaining +
        ' URL: elenco completo nell’export CSV allegato.</p>'
      : '';

  return (
    '<table class="url-table"><thead><tr><th>URL</th><th>Evidenza</th></tr></thead><tbody>' +
    rows +
    '</tbody></table>' +
    more
  );
}

function issueCard(issue: AuditIssue, index: number): string {
  return [
    '<article class="issue">',
    '<header class="issue-head">',
    '<div class="issue-title"><span class="issue-index">' + index + '</span>',
    '<h3>' + escapeHtml(issue.title) + '</h3></div>',
    '<div class="issue-meta">',
    severityBadge(issue.severity),
    '<span class="chip">' + escapeHtml(CATEGORY_LABELS[issue.category]) + '</span>',
    '<span class="chip">' + escapeHtml(issue.priority) + '</span>',
    '<span class="chip">Effort ' + escapeHtml(EFFORT_LABELS[issue.effort]) + '</span>',
    '<span class="chip chip-strong">' +
      issue.affectedCount +
      ' URL (' +
      formatPercent(issue.affectedRatio) +
      ')</span>',
    '<span class="chip">-' + issue.scorePenalty.toFixed(1) + ' punti</span>',
    '</div>',
    '</header>',
    '<div class="issue-body">',
    '<p class="issue-desc">' + escapeHtml(issue.description) + '</p>',
    '<div class="issue-block"><h4>Impatto SEO</h4><p>' + escapeHtml(issue.seoImpact) + '</p></div>',
    '<div class="issue-block issue-fix"><h4>Soluzione consigliata</h4><p>' +
      escapeHtml(issue.recommendation) +
      '</p></div>',
    urlTable(issue),
    '</div>',
    '</article>',
  ].join('');
}


/**
 * Sintesi dell'analisi semantica. Nel PDF vanno solo gli aggregati e gli esempi peggiori:
 * il dettaglio pagina per pagina sta nel CSV dei contenuti, dove e consultabile davvero.
 */
function contentSection(audit: AuditResult): string {
  const analyzed = audit.crawl.pages.filter(
    (p) => p.content !== null && p.content.readability.words >= 200,
  );
  if (analyzed.length === 0) return '';

  const avgGulpease = Math.round(
    analyzed.reduce((acc, p) => acc + (p.content?.readability.gulpease ?? 0), 0) / analyzed.length,
  );
  const avgSentence = Math.round(
    analyzed.reduce((acc, p) => acc + (p.content?.readability.avgSentenceWords ?? 0), 0) /
      analyzed.length,
  );

  const withPlacement = analyzed.filter((p) => p.content?.placement);
  const avgCoverage = withPlacement.length
    ? (
        withPlacement.reduce((acc, p) => acc + (p.content?.placement?.coverage ?? 0), 0) /
        withPlacement.length
      ).toFixed(1)
    : '0';
  const alignedTitle = withPlacement.filter((p) => p.content?.placement?.inTitle).length;

  // Le pagine con la copertura piu bassa sono quelle su cui intervenire per prime.
  const worst = withPlacement
    .slice()
    .sort((a, b) => (a.content?.placement?.coverage ?? 0) - (b.content?.placement?.coverage ?? 0))
    .slice(0, 12);

  const mark = (ok: boolean | undefined): string =>
    ok ? '<span class="ok">si</span>' : '<span class="ko">no</span>';

  const rows = worst
    .map((page) => {
      const c = page.content;
      return (
        '<tr><td><a class="url-path" href="' +
        escapeHtml(page.url) +
        '">' +
        escapeHtml(shortPath(page.url, 38)) +
        '</a></td><td>' +
        escapeHtml(truncate(c?.primaryKeyword ?? '-', 32)) +
        '</td><td class="center">' +
        mark(c?.placement?.inTitle) +
        '</td><td class="center">' +
        mark(c?.placement?.inH1) +
        '</td><td class="center">' +
        mark(c?.placement?.inDescription) +
        '</td><td class="center">' +
        mark(c?.placement?.inUrl) +
        '</td><td class="center">' +
        (c?.readability.gulpease ?? 0) +
        '</td></tr>'
      );
    })
    .join('');

  return [
    '<section class="section page-break">',
    '<h2 class="section-title">Contenuti, keyword e leggibilita</h2>',
    '<p>Analisi semantica delle ' +
      analyzed.length +
      ' pagine con almeno 200 parole. Per ciascuna viene individuata la locuzione piu ricorrente ' +
      'nel testo, cioe l argomento reale della pagina, e verificato se compare nelle collocazioni ' +
      'che contano: title, H1, meta description, slug e alt delle immagini.</p>',
    '<div class="stats">',
    statCard('Pagine analizzate', analyzed.length),
    statCard('Gulpease medio', avgGulpease, readabilityLabel(avgGulpease)),
    statCard('Parole per frase', avgSentence),
    statCard('Copertura media', avgCoverage + ' / 5'),
    statCard('Argomento nel title', alignedTitle + ' / ' + withPlacement.length),
    '</div>',
    '<p class="method">L indice Gulpease misura la leggibilita di un testo italiano su una scala ' +
      '0-100: sopra 60 il testo e accessibile a chi ha la licenza elementare, sotto 40 risulta ' +
      'impegnativo anche con la licenza media. Per un sito rivolto al pubblico si punta a 50-60.</p>',
    '<h3 class="sub-title">Pagine con l argomento peggio dichiarato</h3>',
    '<p class="roadmap-sub"><strong>si</strong> e <strong>no</strong> non indicano se l elemento ' +
      'esiste, ma se vi compare l argomento rilevato: un <strong>no</strong> sotto "title" significa ' +
      'che il title c e ma parla d altro. ' +
      'Le pagine in cui la keyword principale del testo compare nel minor ' +
      'numero di collocazioni: sono quelle in cui il divario fra cio che la pagina dice e cio che ' +
      'dichiara e piu ampio.</p>',
    '<table class="data-table"><thead><tr>',
    '<th rowspan="2">URL</th><th rowspan="2">Argomento rilevato</th>',
    '<th colspan="4" class="center group-head">L argomento compare in…</th>',
    '<th rowspan="2">Gulpease</th></tr><tr>',
    '<th class="center">title</th><th class="center">H1</th><th class="center">description</th><th class="center">slug</th>',
    '</tr></thead><tbody>',
    rows,
    '</tbody></table>',
        '</section>',
  ].join('');
}

/**
 * Copertura dei dati strutturati sul sito: quali tipi Schema.org sono dichiarati, su quante
 * pagine, con quante proprieta medie e se le entita sono collegate fra loro tramite @id.
 */
function schemaSection(audit: AuditResult): string {
  const pages = audit.crawl.pages.filter(
    (p) => p.isHtml && p.statusCode >= 200 && p.statusCode < 300,
  );
  if (pages.length === 0) return '';

  interface TypeStat {
    type: string;
    pages: number;
    entities: number;
    withId: number;
    properties: Set<string>;
  }

  const byType = new Map<string, TypeStat>();
  let pagesWithSchema = 0;

  for (const page of pages) {
    const entities = page.structuredData.flatMap((block) => block.entities);
    if (entities.length > 0) pagesWithSchema += 1;

    const typesOnPage = new Set<string>();
    for (const entity of entities) {
      const key = entity.type;
      let stat = byType.get(key);
      if (!stat) {
        stat = { type: key, pages: 0, entities: 0, withId: 0, properties: new Set() };
        byType.set(key, stat);
      }
      stat.entities += 1;
      if (entity.hasId) stat.withId += 1;
      for (const prop of entity.properties) stat.properties.add(prop);
      typesOnPage.add(key);
    }
    for (const type of typesOnPage) {
      const stat = byType.get(type);
      if (stat) stat.pages += 1;
    }
  }

  const coverage = pagesWithSchema / pages.length;
  const errorPages = pages.filter((p) => p.structuredDataErrors.length > 0).length;

  if (byType.size === 0) {
    return [
      '<section class="section page-break">',
      '<h2 class="section-title">Dati strutturati</h2>',
      '<p>Nessun markup Schema.org rilevato sulle ' + pages.length + ' pagine analizzate. ',
      'Il sito non e eleggibile ad alcun risultato arricchito: ne stelle, ne breadcrumb, ne FAQ, ',
      'ne scheda organizzazione.</p>',
      '</section>',
    ].join('');
  }

  const rows = [...byType.values()]
    .sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type))
    .slice(0, 20)
    .map(
      (stat) =>
        '<tr><td><strong>' +
        escapeHtml(stat.type) +
        '</strong></td><td class="center">' +
        stat.pages +
        '</td><td class="center">' +
        formatPercent(stat.pages / pages.length, 0) +
        '</td><td class="center">' +
        stat.entities +
        '</td><td class="center">' +
        (stat.withId > 0 ? '<span class="ok">si</span>' : '<span class="ko">no</span>') +
        '</td><td>' +
        escapeHtml(truncate([...stat.properties].sort().join(', '), 70)) +
        '</td></tr>',
    )
    .join('');

  return [
    '<section class="section page-break">',
    '<h2 class="section-title">Dati strutturati</h2>',
    '<p>I dati strutturati sono il modo esplicito con cui una pagina dichiara a Google che cosa ',
    'rappresenta: un prodotto, un articolo, un percorso di navigazione, un elenco di domande. ',
    'Sono il presupposto tecnico dei risultati arricchiti in SERP.</p>',
    '<div class="stats">',
    statCard('Pagine con markup', pagesWithSchema + ' / ' + pages.length),
    statCard('Copertura', formatPercent(coverage, 0)),
    statCard('Tipi dichiarati', byType.size),
    statCard('Pagine con errori', errorPages),
    '</div>',
    '<h3 class="sub-title">Tipi Schema.org rilevati</h3>',
    '<p class="roadmap-sub">La colonna @id indica se il tipo usa identificatori stabili: senza, ',
    'le entita restano isolate invece di formare un grafo unico riutilizzabile fra le pagine.</p>',
    '<table class="data-table"><thead><tr>',
    '<th>Tipo</th><th class="center">Pagine</th><th class="center">Copertura</th>',
    '<th class="center">Entita</th><th class="center">@id</th><th>Proprieta dichiarate</th>',
    '</tr></thead><tbody>',
    rows,
    '</tbody></table>',
    '</section>',
  ].join('');
}

/**
 * Velocita misurata da PageSpeed Insights: laboratorio (Lighthouse) e campo (Chrome UX).
 * Se la misurazione e disattivata o fallita del tutto, la sezione spiega perche manca.
 */
function pagespeedSection(audit: AuditResult): string {
  const psi = audit.pagespeed;
  if (!psi) return '';

  if (!psi.mobile && !psi.desktop) {
    return [
      '<section class="section">',
      '<h2 class="section-title">Velocità (PageSpeed Insights)</h2>',
      '<p class="empty">La misurazione non è riuscita: ' +
        escapeHtml(truncate(psi.errors.join(' · '), 200)) +
        '. I dati di velocità di questo report si limitano ai tempi di risposta del server.</p>',
      '</section>',
    ].join('');
  }

  const scoreCard = (label: string, r: PsiStrategyResult | null): string => {
    const score = r?.lab.performanceScore;
    if (score === null || score === undefined) return statCard(label, '—');
    return (
      '<div class="stat"><span class="stat-value" style="color:' +
      scoreColor(score) +
      '">' +
      score +
      '</span><span class="stat-label">' +
      escapeHtml(label) +
      '</span><span class="stat-hint">su 100</span></div>'
    );
  };

  const labRow = (label: string, pick: (m: PsiLabMetrics) => string): string =>
    '<tr><th>' +
    escapeHtml(label) +
    '</th><td class="center">' +
    (psi.mobile ? pick(psi.mobile.lab) : '—') +
    '</td><td class="center">' +
    (psi.desktop ? pick(psi.desktop.lab) : '—') +
    '</td></tr>';

  const field = psi.mobile?.field ?? psi.desktop?.field ?? null;
  const fieldBlock = field
    ? [
        '<h3 class="sub-title">Core Web Vitals reali (Chrome UX Report, 28 giorni)</h3>',
        '<p class="roadmap-sub">Sono i dati degli utenti Chrome reali' +
          (field.originFallback
            ? ', aggregati sull’intero dominio perché la singola pagina non ha traffico sufficiente'
            : '') +
          ': è su questi numeri che Google valuta il sito, non su quelli di laboratorio.</p>',
        '<div class="stats">',
        statCard('Verdetto Google', cwvLabel(field.overall)),
        statCard('LCP', formatMs(field.lcpMs), 'soglia: 2,5 s'),
        statCard('INP', formatMs(field.inpMs), 'soglia: 200 ms'),
        statCard('CLS', field.cls === null ? '—' : field.cls.toFixed(2).replace('.', ','), 'soglia: 0,1'),
        '</div>',
      ].join('')
    : '<p class="roadmap-sub">Il Chrome UX Report non ha dati per questo sito: il traffico ' +
      'reale è sotto la soglia minima di campionamento. Valgono le misurazioni di laboratorio.</p>';

  return [
    '<section class="section page-break">',
    '<h2 class="section-title">Velocità (PageSpeed Insights)</h2>',
    '<p>Misurazione della home (' +
      escapeHtml(shortPath(psi.testedUrl, 60)) +
      ') eseguita da Google al momento dell’audit. Il punteggio riassume le metriche di ' +
      'laboratorio; i Core Web Vitals reali, quando disponibili, sono il segnale usato nel ranking.</p>',
    '<div class="stats">',
    scoreCard('Punteggio mobile', psi.mobile),
    scoreCard('Punteggio desktop', psi.desktop),
    '</div>',
    '<table class="config-table"><thead><tr><th></th><th class="center">Mobile</th><th class="center">Desktop</th></tr></thead><tbody>',
    labRow('Largest Contentful Paint', (m) => formatMs(m.lcpMs)),
    labRow('First Contentful Paint', (m) => formatMs(m.fcpMs)),
    labRow('Total Blocking Time', (m) => formatMs(m.tbtMs)),
    labRow('Cumulative Layout Shift', (m) => (m.cls === null ? '—' : m.cls.toFixed(3).replace('.', ','))),
    labRow('Speed Index', (m) => formatMs(m.speedIndexMs)),
    '</tbody></table>',
    fieldBlock,
    '<p class="more-urls">Report completo con i singoli interventi consigliati: ' +
      'pagespeed.web.dev</p>',
    '</section>',
  ].join('');
}


/**
 * Crawler visti nei log del server: chi, quanto e quando. Presente solo se l utente ha
 * fornito i log in DATA_DIR/logs/<dominio>/; altrimenti una nota spiega come fare.
 */
function crawlerSection(audit: AuditResult): string {
  const cr = audit.crawlers;

  if (!cr) {
    return [
      '<section class="section">',
      '<h2 class="section-title">Crawler sul sito</h2>',
      '<p class="empty">Le visite di Googlebot arrivano automaticamente da Search Console (sezione ' +
        'dedicata). Per vedere anche gli altri crawler — Bing, GPTBot, ClaudeBot, tool SEO, ' +
        'scraper — servono i log di accesso del server, che nessuna API espone: esportali dal ' +
        'pannello hosting in <code>data/logs/' +
        escapeHtml(audit.domain) +
        '/</code> e al prossimo audit questa sezione si popola da sola.</p>',
      '</section>',
    ].join('');
  }

  const period =
    cr.periodStart && cr.periodEnd
      ? formatDate(cr.periodStart) + ' – ' + formatDate(cr.periodEnd)
      : '—';

  const searchHits = cr.bots.filter((b) => b.group === 'search').reduce((s, b) => s + b.hits, 0);
  const aiHits = cr.bots.filter((b) => b.group === 'ai').reduce((s, b) => s + b.hits, 0);
  const spoofedTotal = cr.bots.reduce((s, b) => s + (b.spoofed ?? 0), 0);

  const verifyCell = (b: BotStats): string => {
    if (b.verified === null) return '—';
    if (b.spoofed === 0) return '<span class="ok">autentico</span>';
    return (
      '<span class="ko">' + b.spoofed + ' falsi</span> / ' + b.verified + ' autentici'
    );
  };

  const rows = cr.bots
    .slice(0, 25)
    .map(
      (b) =>
        '<tr><td><strong>' +
        escapeHtml(b.name) +
        '</strong><br><span class="stat-hint">' +
        escapeHtml(b.groupLabel) +
        '</span></td><td class="center">' +
        b.hits +
        '</td><td class="center">' +
        b.uniqueUrls +
        '</td><td class="center">' +
        escapeHtml(formatDateTime(b.lastSeen)) +
        '</td><td class="center">' +
        (b.hits404 > 0 ? '<span class="ko">' + b.hits404 + '</span>' : '0') +
        '</td><td class="center">' +
        verifyCell(b) +
        '</td></tr>',
    )
    .join('');

  const wastedBlock =
    cr.wasted404.length > 0
      ? [
          '<h3 class="sub-title">URL inesistenti richieste dai motori di ricerca</h3>',
          '<p class="roadmap-sub">Google e gli altri motori continuano a chiedere queste URL e ',
          'ricevono 404: sono le prime da redirigere con un 301 verso la pagina pertinente.</p>',
          '<table class="data-table"><thead><tr><th>URL richiesta</th><th class="center">Richieste</th><th>Da</th></tr></thead><tbody>',
          cr.wasted404
            .map(
              (w) =>
                '<tr><td class="url-path">' +
                escapeHtml(truncate(w.path, 70)) +
                '</td><td class="center">' +
                w.hits +
                '</td><td>' +
                escapeHtml(w.bot) +
                '</td></tr>',
            )
            .join(''),
          '</tbody></table>',
        ].join('')
      : '';

  const spoofedBlock =
    spoofedTotal > 0
      ? '<div class="callout"><strong>Bot travestiti</strong><p>' +
        spoofedTotal +
        ' richieste si presentano come Googlebot o Bingbot ma arrivano da IP fuori dagli ' +
        'intervalli ufficiali: sono scraper che ne imitano lo user agent. Se il carico disturba, ' +
        'si bloccano per IP senza alcun rischio SEO.</p></div>'
      : '';

  const verifyNote = cr.ipVerificationDone
    ? 'Le richieste di Googlebot e Bingbot sono state verificate contro gli intervalli IP ufficiali dei rispettivi motori.'
    : 'La verifica IP di Googlebot e Bingbot non è stata possibile (intervalli ufficiali non raggiungibili): i conteggi si basano sul solo user agent.';

  return [
    '<section class="section page-break">',
    '<h2 class="section-title">Crawler sul sito</h2>',
    '<p>Analisi dei log di accesso del server (' +
      cr.files.map((f) => escapeHtml(f.name)).join(', ') +
      '), periodo ' +
      escapeHtml(period) +
      '. ' +
      escapeHtml(verifyNote) +
      '</p>',
    '<div class="stats">',
    statCard('Richieste da bot', cr.totalBotHits),
    statCard('Motori di ricerca', searchHits),
    statCard('Crawler AI', aiHits),
    statCard('Bot travestiti', spoofedTotal),
    '</div>',
    '<table class="data-table"><thead><tr>',
    '<th>Crawler</th><th class="center">Richieste</th><th class="center">URL uniche</th>',
    '<th class="center">Ultima visita</th><th class="center">404</th><th class="center">Verifica IP</th>',
    '</tr></thead><tbody>',
    rows,
    '</tbody></table>',
    wastedBlock,
    spoofedBlock,
        '</section>',
  ].join('');
}


/**
 * Dati Search Console: ricerca reale, stato di indicizzazione secondo Google e profilo
 * dei link dagli export. Presente solo se il service account e configurato o se sono
 * stati forniti gli export del report Link.
 */
function gscSection(audit: AuditResult): string {
  const gsc = audit.gsc;

  if (!gsc) {
    return [
      '<section class="section">',
      '<h2 class="section-title">Google Search Console</h2>',
      '<p class="empty">Integrazione non attiva. Con un service account collegato alla ',
      'proprietà, questa sezione mostra click e query reali degli ultimi 28 giorni, lo stato ',
      'di indicizzazione pagina per pagina secondo Google e la data dell’ultima scansione di ',
      'Googlebot. La procedura di attivazione è nel README del progetto.</p>',
      '</section>',
    ].join('');
  }

  const parts: string[] = [
    '<section class="section page-break">',
    '<h2 class="section-title">Google Search Console</h2>',
  ];

  // Collegamento attivo ma nessuna proprietà per questo dominio: va detto forte e chiaro,
  // con l'elenco di ciò che il service account vede — così si capisce subito che manca solo
  // l'aggiunta dell'utente su quella proprietà. Nessun dato mostrato: mai dati di altri siti.
  if (!gsc.property && gsc.availableProperties.length > 0) {
    parts.push(
      '<div class="callout"><strong>Proprietà non trovata per ' +
        escapeHtml(audit.domain) +
        '</strong><p>Il collegamento a Search Console funziona, ma nessuna delle proprietà ' +
        'accessibili al service account corrisponde a questo dominio, quindi qui non viene ' +
        'mostrato alcun dato. Proprietà visibili: ' +
        escapeHtml(truncate(gsc.availableProperties.join(', '), 300)) +
        '.</p><p>Per attivare i dati: Search Console → proprietà di ' +
        escapeHtml(audit.domain) +
        ' → Impostazioni → Utenti e autorizzazioni → aggiungi l’email del service account.</p></div>',
    );
  }

  if (gsc.property) {
    parts.push(
      '<p>Proprietà <strong>' +
        escapeHtml(gsc.property) +
        '</strong>' +
        (gsc.viaAccount ? ' (via ' + escapeHtml(gsc.viaAccount) + ')' : '') +
        ', dati di ricerca dal ' +
        escapeHtml(gsc.periodStart) +
        ' al ' +
        escapeHtml(gsc.periodEnd) +
        '. A differenza del resto dell’audit, qui nulla è stimato: è Google a riferire come ' +
        'vede il sito e come gli utenti lo trovano.</p>',
      '<div class="stats">',
      statCard('Click', gsc.totalClicks),
      statCard('Impression', gsc.totalImpressions),
      statCard(
        'CTR medio',
        gsc.totalImpressions > 0
          ? ((gsc.totalClicks / gsc.totalImpressions) * 100).toFixed(1).replace('.', ',') + '%'
          : '—',
      ),
      statCard('Pagine ispezionate', gsc.inspections.length),
      '</div>',
    );

    if (gsc.topPages.length > 0) {
      parts.push(
        '<h3 class="sub-title">Pagine più cercate</h3>',
        '<table class="data-table"><thead><tr><th>Pagina</th><th class="center">Click</th>',
        '<th class="center">Impression</th><th class="center">CTR</th><th class="center">Pos. media</th></tr></thead><tbody>',
        gsc.topPages
          .slice(0, 12)
          .map(
            (r) =>
              '<tr><td><a class="url-path" href="' +
              escapeHtml(r.keys[0] ?? '') +
              '">' +
              escapeHtml(shortPath(r.keys[0] ?? '', 46)) +
              '</a></td><td class="center">' +
              r.clicks +
              '</td><td class="center">' +
              r.impressions +
              '</td><td class="center">' +
              (r.ctr * 100).toFixed(1).replace('.', ',') +
              '%</td><td class="center">' +
              r.position.toFixed(1).replace('.', ',') +
              '</td></tr>',
          )
          .join(''),
        '</tbody></table>',
      );
    }

    if (gsc.topQueries.length > 0) {
      parts.push(
        '<h3 class="sub-title">Query principali</h3>',
        '<table class="data-table"><thead><tr><th>Query</th><th class="center">Click</th>',
        '<th class="center">Impression</th><th class="center">Pos. media</th></tr></thead><tbody>',
        gsc.topQueries
          .slice(0, 12)
          .map(
            (r) =>
              '<tr><td>' +
              escapeHtml(truncate(r.keys[0] ?? '', 55)) +
              '</td><td class="center">' +
              r.clicks +
              '</td><td class="center">' +
              r.impressions +
              '</td><td class="center">' +
              r.position.toFixed(1).replace('.', ',') +
              '</td></tr>',
          )
          .join(''),
        '</tbody></table>',
      );
    }

    if (gsc.inspections.length > 0) {
      parts.push(
        '<h3 class="sub-title">Indicizzazione e ultima scansione di Google</h3>',
        '<p class="roadmap-sub">Stato dichiarato dalla URL Inspection API per le pagine più ',
        'importanti: è il dato più diretto possibile su quando Googlebot ha visto ogni pagina.</p>',
        '<table class="data-table"><thead><tr><th>Pagina</th><th>Stato</th>',
        '<th class="center">Ultima scansione</th></tr></thead><tbody>',
        gsc.inspections
          .map(
            (i) =>
              '<tr><td><a class="url-path" href="' +
              escapeHtml(i.url) +
              '">' +
              escapeHtml(shortPath(i.url, 40)) +
              '</a></td><td>' +
              (i.verdict === 'PASS'
                ? '<span class="ok">' + escapeHtml(truncate(i.coverageState, 42)) + '</span>'
                : '<span class="ko">' + escapeHtml(truncate(i.coverageState, 42)) + '</span>') +
              '</td><td class="center">' +
              (i.lastCrawlTime ? escapeHtml(formatDateTime(i.lastCrawlTime)) : 'mai') +
              '</td></tr>',
          )
          .join(''),
        '</tbody></table>',
      );
    }
  }

  const links = gsc.links;
  if (links) {
    parts.push(
      '<h3 class="sub-title">Profilo dei link (export Search Console)</h3>',
      '<p class="roadmap-sub">Dati del report Link di Google (' +
        escapeHtml(links.files.join(', ')) +
        '). La “tossicità” dei link è una metrica proprietaria dei tool a pagamento e non è ' +
        'verificabile: qui c’è il profilo reale, senza punteggi inventati.</p>',
    );

    if (links.topLinkingSites.length > 0) {
      parts.push(
        '<div class="stats">',
        statCard('Siti che linkano', links.totalLinkingSites + (links.totalLinkingSites >= 30 ? '+' : '')),
        '</div>',
        '<table class="data-table"><thead><tr><th>Sito</th><th class="center">Pagine con link</th>',
        '<th class="center">Pagine di destinazione</th></tr></thead><tbody>',
        links.topLinkingSites
          .slice(0, 15)
          .map(
            (s) =>
              '<tr><td>' +
              escapeHtml(truncate(s.site, 55)) +
              '</td><td class="center">' +
              s.linkingPages +
              '</td><td class="center">' +
              s.targetPages +
              '</td></tr>',
          )
          .join(''),
        '</tbody></table>',
      );
    }

    if (links.topLinkedPages.length > 0) {
      parts.push(
        '<h3 class="sub-title">Pagine più linkate dall’esterno</h3>',
        '<table class="data-table"><thead><tr><th>Pagina</th><th class="center">Link in ingresso</th>',
        '<th class="center">Siti</th></tr></thead><tbody>',
        links.topLinkedPages
          .slice(0, 10)
          .map(
            (p) =>
              '<tr><td class="url-path">' +
              escapeHtml(shortPath(p.page, 55)) +
              '</td><td class="center">' +
              p.incomingLinks +
              '</td><td class="center">' +
              p.linkingSites +
              '</td></tr>',
          )
          .join(''),
        '</tbody></table>',
      );
    }
  }

  if (gsc.errors.length > 0) {
    parts.push(
      '<p class="more-urls">Note: ' + escapeHtml(truncate(gsc.errors.join(' · '), 260)) + '</p>',
    );
  }

  parts.push('</section>');
  return parts.join('');
}

function statCard(label: string, value: string | number, hint?: string): string {
  return (
    '<div class="stat"><span class="stat-value">' +
    escapeHtml(String(value)) +
    '</span><span class="stat-label">' +
    escapeHtml(label) +
    '</span>' +
    (hint ? '<span class="stat-hint">' + escapeHtml(hint) + '</span>' : '') +
    '</div>'
  );
}

export function renderReportHtml(audit: AuditResult, branding: ReportBranding): string {
  const { score, summary, issues, crawl } = audit;

  const byPriority: Record<Priority, AuditIssue[]> = { P0: [], P1: [], P2: [], P3: [] };
  for (const issue of issues) byPriority[issue.priority].push(issue);

  const topIssues = issues.slice(0, 5);

  const categoryRows = score.categories
    .slice()
    .sort((a, b) => b.penalty - a.penalty)
    .map((cat) => {
      const width = Math.max(2, cat.score);
      return (
        '<tr><td class="cat-name">' +
        escapeHtml(cat.label) +
        '</td><td class="cat-bar-cell"><div class="cat-bar"><div class="cat-bar-fill" style="width:' +
        width +
        '%;background:' +
        scoreColor(cat.score) +
        '"></div></div></td><td class="cat-score">' +
        cat.score +
        '/100</td><td class="cat-issues">' +
        cat.issueCount +
        '</td><td class="cat-penalty">-' +
        cat.penalty.toFixed(1) +
        '</td></tr>'
      );
    })
    .join('');

  const topIssuesList = topIssues
    .map(
      (issue, i) =>
        '<li><div class="top-issue"><span class="top-rank">' +
        (i + 1) +
        '</span><div><strong>' +
        escapeHtml(issue.title) +
        '</strong>' +
        severityBadge(issue.severity) +
        '<p>' +
        escapeHtml(truncate(issue.seoImpact, 200)) +
        '</p><span class="top-meta">' +
        issue.affectedCount +
        (issue.affectedCount === 1 ? ' URL coinvolta · ' : ' URL coinvolte · ') +
        escapeHtml(CATEGORY_LABELS[issue.category]) +
        ' · impatto sul punteggio -' +
        issue.scorePenalty.toFixed(1) +
        '</span></div></div></li>',
    )
    .join('');

  const prioritySections = (['P0', 'P1', 'P2', 'P3'] as Priority[])
    .filter((priority) => byPriority[priority].length > 0)
    .map((priority) => {
      const list = byPriority[priority];
      let counter = 0;
      return [
        '<section class="priority-section">',
        '<div class="priority-head priority-' + priority + '">',
        '<h2>' + escapeHtml(PRIORITY_LABELS[priority]) + '</h2>',
        '<span>' + list.length + ' problemi</span>',
        '</div>',
        '<p class="priority-desc">' + escapeHtml(PRIORITY_DESCRIPTIONS[priority]) + '</p>',
        list
          .map((issue) => {
            counter += 1;
            return issueCard(issue, counter);
          })
          .join(''),
        '</section>',
      ].join('');
    })
    .join('');

  const warnings = crawl.warnings.length
    ? '<div class="callout"><strong>Note sulla scansione</strong><ul>' +
      crawl.warnings.map((w) => '<li>' + escapeHtml(w) + '</li>').join('') +
      '</ul></div>'
    : '';

  const logo = branding.logoDataUri
    ? '<img class="cover-logo" src="' + escapeHtml(branding.logoDataUri) + '" alt="">'
    : '';

  const configRows = [
    ['URL di partenza', crawl.config.startUrl],
    ['URL analizzate', String(crawl.pages.length) + ' (limite ' + crawl.config.maxUrls + ')'],
    ['Profondità massima', String(crawl.config.maxDepth)],
    ['Rispetto del robots.txt', crawl.config.respectRobots ? 'Si' : 'No'],
    ['Sottodomini inclusi', crawl.config.includeSubdomains ? 'Si' : 'No'],
    ['User agent', crawl.config.userAgent],
    ['Concorrenza / delay', crawl.config.concurrency + ' richieste parallele, ' + crawl.config.delayMs + ' ms'],
    ['Inclusioni', crawl.config.include.length ? crawl.config.include.join(', ') : '—'],
    ['Esclusioni', crawl.config.exclude.length ? crawl.config.exclude.join(', ') : '—'],
    ['Sitemap trovate', crawl.sitemap.sources.length ? crawl.sitemap.sources.join(', ') : 'nessuna'],
    ['Durata scansione', formatDuration(crawl.durationMs)],
  ]
    .map(
      ([label, value]) =>
        '<tr><th>' + escapeHtml(String(label)) + '</th><td>' + escapeHtml(String(value)) + '</td></tr>',
    )
    .join('');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>SEO Audit ${escapeHtml(audit.domain)}</title>
<style>
  :root {
    --brand: ${branding.brandColor};
    --ink: #0f172a;
    --muted: #64748b;
    --line: #e2e8f0;
    --bg-soft: #f8fafc;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: var(--ink);
    font-size: 10.5pt;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page { size: A4; margin: 18mm 14mm 20mm; }
  @page :first { margin: 0; }

  h1, h2, h3, h4 { margin: 0 0 .4em; line-height: 1.25; }
  p { margin: 0 0 .7em; }
  ul { margin: 0 0 .7em; padding-left: 1.1em; }

  /* ── Copertina ───────────────────────────────────────────────────────── */
  .cover {
    height: 297mm;
    padding: 26mm 20mm;
    background: linear-gradient(160deg, var(--brand) 0%, #0f172a 100%);
    color: #fff;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-after: always;
  }
  .cover-logo { max-height: 48px; max-width: 220px; margin-bottom: 18mm; }
  .cover-kicker { text-transform: uppercase; letter-spacing: .22em; font-size: 9pt; opacity: .8; }
  .cover h1 { font-size: 34pt; margin: 6mm 0 3mm; letter-spacing: -.02em; }
  .cover .domain { font-size: 16pt; opacity: .92; word-break: break-all; }
  .cover-score {
    margin-top: 14mm;
    display: flex;
    align-items: center;
    gap: 8mm;
  }
  .score-ring {
    /* flex-basis fisso: senza, il cerchio viene schiacciato in un’ellisse */
    flex: 0 0 46mm; box-sizing: border-box;
    width: 46mm; height: 46mm; border-radius: 50%;
    border: 3mm solid rgba(255,255,255,.28);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(255,255,255,.08);
  }
  .score-ring .value { font-size: 30pt; font-weight: 700; line-height: 1; }
  .score-ring .max { font-size: 9pt; opacity: .75; margin-top: 2mm; }
  .score-side .grade { font-size: 13pt; font-weight: 600; margin-bottom: 2mm; }
  .score-side p { font-size: 10pt; opacity: .9; max-width: 90mm; }
  .cover-foot { font-size: 9pt; opacity: .85; display: flex; justify-content: space-between; }

  /* ── Struttura ───────────────────────────────────────────────────────── */
  .section { page-break-inside: avoid; margin-bottom: 9mm; }
  .section-title {
    font-size: 15pt;
    padding-bottom: 2mm;
    margin-bottom: 4mm;
    border-bottom: 2px solid var(--brand);
  }
  .page-break { page-break-before: always; }

  .lead { font-size: 11pt; color: #1e293b; }
  .callout {
    background: var(--bg-soft);
    border-left: 3px solid var(--brand);
    padding: 4mm 5mm;
    margin: 4mm 0;
    font-size: 9.5pt;
  }
  .callout ul { margin: .3em 0 0; }

  /* ── Statistiche ─────────────────────────────────────────────────────── */
  .stats { display: flex; flex-wrap: wrap; gap: 3mm; margin: 4mm 0; }
  .stat {
    flex: 1 1 30mm;
    min-width: 30mm;
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 3mm;
    text-align: center;
    background: #fff;
  }
  .stat-value { display: block; font-size: 16pt; font-weight: 700; color: var(--brand); }
  .stat-label { display: block; font-size: 8pt; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .stat-hint { display: block; font-size: 8pt; color: var(--muted); margin-top: 1mm; }

  /* ── Tabelle ─────────────────────────────────────────────────────────── */
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .data-table th, .data-table td, .config-table th, .config-table td {
    border-bottom: 1px solid var(--line);
    padding: 2mm 2.5mm;
    text-align: left;
    vertical-align: top;
  }
  .data-table thead th { background: var(--bg-soft); font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .config-table th { width: 45mm; color: var(--muted); font-weight: 600; }

  .cat-name { width: 45mm; font-weight: 600; }
  .cat-bar { background: var(--line); border-radius: 2px; height: 4mm; width: 100%; }
  .cat-bar-fill { height: 4mm; border-radius: 2px; }
  .cat-bar-cell { width: auto; }
  .cat-score, .cat-issues, .cat-penalty { width: 18mm; text-align: right; white-space: nowrap; }

  /* ── Criticità principali ────────────────────────────────────────────── */
  .top-list { list-style: none; padding: 0; margin: 0; }
  .top-list li { margin-bottom: 4mm; page-break-inside: avoid; }
  .top-issue { display: flex; gap: 4mm; }
  .top-rank {
    flex: 0 0 8mm; height: 8mm; border-radius: 50%;
    background: var(--brand); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 10pt;
  }
  .top-issue .badge { margin-left: 2mm; vertical-align: 1px; }
  .top-issue p { margin: 1mm 0; font-size: 9.5pt; color: #334155; }
  .top-meta { font-size: 8.5pt; color: var(--muted); }

  /* ── Issue ───────────────────────────────────────────────────────────── */
  .priority-section { margin-bottom: 8mm; }
  .priority-head {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 3mm 4mm; border-radius: 3px; color: #fff; margin-bottom: 2mm;
  }
  .priority-head h2 { font-size: 12pt; margin: 0; }
  .priority-head span { font-size: 9pt; opacity: .9; }
  .priority-P0 { background: #b91c1c; }
  .priority-P1 { background: #c2410c; }
  .priority-P2 { background: #a16207; }
  .priority-P3 { background: #0369a1; }
  .priority-desc { font-size: 9pt; color: var(--muted); margin-bottom: 4mm; }

  .issue {
    border: 1px solid var(--line);
    border-radius: 3px;
    margin-bottom: 4mm;
    page-break-inside: avoid;
  }
  .issue-head { padding: 3mm 4mm; background: var(--bg-soft); border-bottom: 1px solid var(--line); }
  .issue-title { display: flex; align-items: baseline; gap: 3mm; }
  .issue-index { color: var(--muted); font-size: 9pt; font-weight: 700; }
  .issue-title h3 { font-size: 11.5pt; margin: 0; }
  .issue-meta { margin-top: 2mm; display: flex; flex-wrap: wrap; gap: 2mm; }
  .badge, .chip {
    display: inline-block; font-size: 8pt; padding: .8mm 2mm; border-radius: 2px; white-space: nowrap;
  }
  .badge { color: #fff; font-weight: 600; }
  .chip { background: #fff; border: 1px solid var(--line); color: var(--muted); }
  .chip-strong { border-color: var(--brand); color: var(--brand); font-weight: 600; }

  .issue-body { padding: 3mm 4mm 4mm; }
  .issue-desc { font-size: 9.5pt; }
  .issue-block h4 {
    font-size: 8.5pt; text-transform: uppercase; letter-spacing: .06em;
    color: var(--muted); margin: 3mm 0 1mm;
  }
  .issue-block p { font-size: 9.5pt; margin: 0; }
  .issue-fix { border-left: 2px solid var(--brand); padding-left: 3mm; background: var(--bg-soft); padding-top: 2mm; padding-bottom: 2mm; }

  .url-table { margin-top: 3mm; font-size: 8.5pt; }
  .url-table th { text-align: left; padding: 1.5mm 2mm; background: var(--bg-soft); color: var(--muted); font-size: 8pt; text-transform: uppercase; }
  .url-table td { padding: 1.5mm 2mm; border-bottom: 1px solid var(--line); vertical-align: top; }
  .url-cell { width: 55%; }
  /* Nel PDF i link restano cliccabili: portano dritti alla pagina da correggere. */
  a.url-path, .url-path { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; word-break: break-all; }
  a.url-path { color: var(--brand); text-decoration: none; }
  .evidence-cell { color: var(--muted); }
  .more-urls { font-size: 8.5pt; color: var(--muted); margin-top: 2mm; font-style: italic; }

  /* ── Sottotitoli di sezione ── */
  .roadmap-sub { font-size: 9pt; color: var(--muted); margin-bottom: 2mm; }
  .empty { font-size: 9pt; color: var(--muted); font-style: italic; }

  .sub-title { font-size: 11.5pt; margin-top: 6mm; color: var(--ink); }
  .center { text-align: center; }
  .group-head { background: var(--bg-soft); border-bottom: 1px solid var(--line); }
  .ok { color: #15803d; font-weight: 600; }
  .ko { color: #b91c1c; font-weight: 600; }
  .method { font-size: 9pt; color: #334155; }
  .method h3 { font-size: 10.5pt; margin-top: 4mm; }
</style>
</head>
<body>

<section class="cover">
  <div>
    ${logo}
    <div class="cover-kicker">SEO Audit tecnico</div>
    <h1>Analisi tecnica<br>del sito</h1>
    <div class="domain">${escapeHtml(audit.domain)}</div>
  </div>

  <div class="cover-score">
    <div class="score-ring">
      <span class="value">${score.total}</span>
      <span class="max">/ 100</span>
    </div>
    <div class="score-side">
      <div class="grade">Valutazione ${escapeHtml(score.grade)} — ${escapeHtml(scoreVerdict(score.total))}</div>
      <p>${summary.totalPages} URL analizzate · ${issues.length} problemi rilevati · ${summary.issuesByPriority.P0} interventi bloccanti</p>
    </div>
  </div>

  <div class="cover-foot">
    <span>${escapeHtml(branding.brandName)}</span>
    <span>${escapeHtml(formatDate(audit.createdAt))}</span>
  </div>
</section>

<section class="section">
  <h2 class="section-title">Executive summary</h2>
  <p class="lead">
    L’analisi tecnica di <strong>${escapeHtml(audit.domain)}</strong> ha esaminato
    <strong>${summary.totalPages} URL</strong> il ${escapeHtml(formatDateTime(audit.createdAt))},
    rilevando <strong>${issues.length} problemi</strong> distribuiti su
    ${score.categories.filter((c) => c.issueCount > 0).length} aree tecniche.
    Il punteggio complessivo è <strong>${score.total}/100</strong> (${escapeHtml(score.grade)}).
  </p>
  <p>
    ${summary.issuesBySeverity.critical} problemi sono classificati come critici e
    ${summary.issuesBySeverity.high} come ad alta severità: insieme rappresentano gli interventi da
    affrontare nei primi 30 giorni. Delle ${summary.totalPages} URL analizzate,
    <strong>${summary.indexablePages}</strong> risultano indicizzabili
    (${escapeHtml(formatPercent(summary.indexablePages / Math.max(1, summary.totalPages)))}),
    mentre ${summary.brokenPages} rispondono con errore client e ${summary.serverErrors} con errore server.
  </p>

  <div class="stats">
    ${statCard('URL analizzate', summary.totalPages)}
    ${statCard('Indicizzabili', summary.indexablePages)}
    ${statCard('Errori 4xx', summary.brokenPages)}
    ${statCard('Errori 5xx', summary.serverErrors)}
    ${statCard('Redirect', summary.redirects)}
    ${statCard('Pagine orfane', summary.orphanPages)}
  </div>
  <div class="stats">
    ${statCard('Tempo medio', summary.avgResponseTimeMs + ' ms')}
    ${statCard('Parole medie', summary.avgWordCount)}
    ${statCard('Profondità max', summary.maxDepth)}
    ${statCard('URL in sitemap', summary.sitemapUrls)}
    ${statCard('Immagini uniche', summary.totalImages)}
    ${statCard('Senza alt', summary.imagesMissingAlt)}
  </div>

  ${warnings}
</section>

<section class="section">
  <h2 class="section-title">Punteggio per area tecnica</h2>
  <p>
    Ogni area contribuisce al punteggio con un peso proprio. La penalità dipende dalla severità dei
    problemi, dalla quota di pagine coinvolte e dall’importanza delle pagine interessate.
  </p>
  <table class="data-table">
    <thead><tr><th>Area</th><th>Salute</th><th>Score</th><th>Issue</th><th>Punti</th></tr></thead>
    <tbody>${categoryRows}</tbody>
  </table>
</section>

<section class="section page-break">
  <h2 class="section-title">Criticità principali</h2>
  <p>I cinque problemi con il maggiore impatto sul punteggio complessivo.</p>
  <ol class="top-list">${topIssuesList || '<li class="empty">Nessun problema rilevato.</li>'}</ol>
</section>

${contentSection(audit)}

${schemaSection(audit)}

${pagespeedSection(audit)}

${crawlerSection(audit)}

${gscSection(audit)}

<div class="page-break"></div>
<h2 class="section-title">Problemi rilevati per priorità</h2>
${prioritySections || '<p class="empty">Nessun problema rilevato durante la scansione.</p>'}

<section class="section page-break">
  <h2 class="section-title">Metodologia e configurazione</h2>
  <div class="method">
    <p>
      La scansione è stata eseguita con un crawler HTTP che segue i link interni a partire dalla URL
      di origine, ricostruisce le catene di redirect, legge robots.txt e sitemap XML e analizza
      l’HTML servito dal server. Le pagine non sono renderizzate lato client: i contenuti generati
      esclusivamente via JavaScript possono non essere rilevati.
    </p>
    <h3>Come si legge il punteggio</h3>
    <p>
      Il punteggio parte da 100. Ogni area tecnica ha un peso proprio e può erodere al massimo quel
      peso: severità, percentuale di pagine coinvolte e presenza di pagine di primo livello
      determinano quanta parte di quel peso viene effettivamente sottratta.
    </p>
    <h3>Priorità</h3>
    <p>
      P0 indica problemi che bloccano indicizzazione o traffico; P1 problemi con impatto diretto e
      ampio; P2 ottimizzazioni con impatto misurabile; P3 rifiniture e buone pratiche.
    </p>
    <h3>Configurazione della scansione</h3>
    <table class="config-table"><tbody>${configRows}</tbody></table>
  </div>
</section>

</body>
</html>`;
}
