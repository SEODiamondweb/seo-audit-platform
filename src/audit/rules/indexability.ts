import { truncate } from '../../utils/text';
import { shortPath } from '../../utils/url';
import type { IssueUrl, Rule } from '../types';

/** "linkata da /a, /b": indica dove andare a correggere il link, non solo che è rotto. */
function linkedFromNote(page: { linkedFrom: string[]; uniqueInlinks: number }): string {
  if (page.linkedFrom.length === 0) return '';
  const shown = page.linkedFrom.map((u) => shortPath(u, 28)).join(', ');
  const more = page.uniqueInlinks - page.linkedFrom.length;
  return ' — linkata da: ' + shown + (more > 0 ? ' (+' + more + ')' : '');
}

/**
 * Regole su scansione, indicizzazione, status code, redirect, canonical, robots.txt e sitemap.
 * Ogni regola ritorna `null` quando non ha nulla da segnalare.
 */
export const indexabilityRules: Rule[] = [
  // ── Scansione e indicizzazione ─────────────────────────────────────────────
  {
    id: 'robots-blocks-site',
    title: 'Il robots.txt blocca la scansione dell’intero sito',
    category: 'crawling_indexing',
    severity: 'critical',
    effort: 'low',
    description:
      'Il file robots.txt contiene una direttiva Disallow che impedisce ai crawler di accedere alla root del sito.',
    seoImpact:
      'Nessuna pagina può essere scansionata: il sito esce progressivamente dall’indice e perde tutto il traffico organico.',
    recommendation:
      'Rimuovi o restringi la direttiva Disallow: / nel robots.txt, lasciando bloccate solo le sezioni che non devono essere scansionate (area riservata, carrello, parametri di filtro).',
    evaluate(ctx) {
      if (!ctx.crawl.robots.blocksEverything) return null;
      return {
        urls: [
          {
            url: ctx.crawl.robots.url,
            evidence: 'Disallow: / attivo per lo user agent utilizzato',
          },
        ],
        scopeSize: 1,
      };
    },
  },
  {
    id: 'pages-blocked-by-robots',
    title: 'Pagine linkate internamente ma bloccate da robots.txt',
    category: 'crawling_indexing',
    severity: 'high',
    effort: 'medium',
    description:
      'Alcune URL raggiungibili tramite link interni sono escluse dalla scansione dal robots.txt.',
    seoImpact:
      'Google non può leggere il contenuto né i link in uscita di queste pagine: il PageRank interno che ricevono viene sprecato e le pagine non possono posizionarsi.',
    recommendation:
      'Decidi se la pagina deve essere indicizzata: in tal caso sbloccala nel robots.txt; se invece deve restare fuori dall’indice, usa meta robots noindex (non il Disallow) e rimuovi i link interni che la puntano.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => p.indexabilityStatus === 'Blocked by robots.txt')
        .map((p) => ({ url: p.url, evidence: 'Bloccata dal robots.txt' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'noindex-pages',
    title: 'Pagine con direttiva noindex',
    category: 'crawling_indexing',
    severity: 'medium',
    effort: 'low',
    description:
      'Queste pagine contengono un meta robots o un header X-Robots-Tag con direttiva noindex.',
    seoImpact:
      'Le pagine sono escluse dall’indice. Se l’esclusione non è intenzionale si perdono posizionamenti e traffico; su pagine strategiche l’impatto è immediato.',
    recommendation:
      'Verifica pagina per pagina che il noindex sia voluto. Rimuovilo dalle pagine che devono posizionarsi; mantienilo su pagine di servizio, risultati di ricerca interni e contenuti duplicati.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.noindex)
        .map((p) => ({
          url: p.url,
          evidence: 'Direttiva: ' + truncate(p.metaRobots ?? p.xRobotsTag ?? 'noindex', 120),
        }));
      if (urls.length === 0) return null;
      const ratio = urls.length / Math.max(1, ctx.htmlPages.length);
      return { urls, severityOverride: ratio > 0.3 ? 'high' : undefined };
    },
  },
  {
    id: 'low-indexable-ratio',
    title: 'Quota elevata di pagine non indicizzabili',
    category: 'crawling_indexing',
    severity: 'medium',
    effort: 'medium',
    description:
      'Piu di un terzo delle pagine HTML scansionate non è indicizzabile (noindex, canonical verso altre URL, redirect o errori).',
    seoImpact:
      'Il crawl budget viene consumato da URL che non possono posizionarsi, rallentando la scoperta e l’aggiornamento delle pagine che contano.',
    recommendation:
      'Riduci le URL non indicizzabili raggiungibili: elimina i link interni verso pagine noindex o canonicalizzate, consolida le varianti con parametri e blocca in robots.txt le sezioni puramente funzionali.',
    evaluate(ctx) {
      const total = ctx.htmlPages.length;
      if (total < 10) return null;
      const nonIndexable = ctx.htmlPages.filter((p) => !p.indexable);
      const ratio = nonIndexable.length / total;
      if (ratio <= 0.33) return null;
      return {
        urls: nonIndexable
          .slice(0, 200)
          .map((p) => ({ url: p.url, evidence: 'Stato: ' + p.indexabilityStatus })),
        note:
          'Non indicizzabili: ' +
          nonIndexable.length +
          ' su ' +
          total +
          ' pagine HTML analizzate.',
      };
    },
  },
  {
    id: 'orphan-pages',
    title: 'Pagine orfane (nessun link interno in entrata)',
    category: 'crawling_indexing',
    severity: 'medium',
    effort: 'medium',
    description:
      'Queste URL sono state trovate in sitemap ma nessuna pagina del sito le collega tramite un link interno.',
    seoImpact:
      'Senza link interni la pagina non riceve autorevolezza, viene scansionata di rado e comunica a Google di avere poca importanza nella struttura del sito.',
    recommendation:
      'Inserisci link interni contestuali dalle pagine tematicamente vicine e, se la pagina è rilevante, collegala dal menu o da una pagina hub. Se invece non serve, rimuovila dalla sitemap.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.isOrphan && p.statusCode >= 200 && p.statusCode < 300)
        .map((p) => ({
          url: p.url,
          evidence: p.inSitemap ? 'In sitemap, 0 link interni' : '0 link interni in entrata',
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Status code ────────────────────────────────────────────────────────────
  {
    id: 'broken-internal-links',
    title: 'Link interni rotti (4xx)',
    category: 'status_codes',
    severity: 'critical',
    effort: 'medium',
    description:
      'Pagine linkate internamente che rispondono con un errore client (404, 410, 403...).',
    seoImpact:
      'Interrompono il percorso di navigazione e la trasmissione di autorevolezza interna, degradano l’esperienza utente e sprecano crawl budget.',
    recommendation:
      'Per ogni URL rotta: correggi il link se è un refuso, aggiornalo verso la nuova destinazione se il contenuto è stato spostato, oppure imposta un redirect 301 verso la pagina equivalente più pertinente.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => p.statusCode >= 400 && p.statusCode < 500)
        .map((p) => ({
          url: p.url,
          evidence: 'HTTP ' + p.statusCode + linkedFromNote(p),
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'server-errors',
    title: 'Errori server (5xx)',
    category: 'status_codes',
    severity: 'critical',
    effort: 'high',
    description: 'URL che rispondono con un errore lato server durante la scansione.',
    seoImpact:
      'Google riduce la frequenza di scansione dopo errori 5xx ripetuti e può deindicizzare le pagine che restano irraggiungibili.',
    recommendation:
      'Analizza i log applicativi e del web server per le URL elencate. Verifica timeout PHP, limiti di memoria, query lente e capacità del server sotto il carico del crawler.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => p.statusCode >= 500)
        .map((p) => ({ url: p.url, evidence: 'HTTP ' + p.statusCode + ' ' + p.statusText }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'fetch-errors',
    title: 'URL non raggiungibili durante la scansione',
    category: 'status_codes',
    severity: 'high',
    effort: 'high',
    description:
      'Richieste terminate con timeout, DNS non risolto, errore TLS o connessione rifiutata.',
    seoImpact:
      'Le pagine non raggiungibili non possono essere indicizzate; errori intermittenti riducono la fiducia del crawler nel sito.',
    recommendation:
      'Verifica la stabilità del server, la validità del certificato TLS e la presenza di rate limiting o WAF che blocchino i crawler. Se il blocco è dovuto al firewall, autorizza lo user agent usato per l’audit.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => p.fetchError !== null)
        .map((p) => ({ url: p.url, evidence: truncate(p.fetchError ?? '', 140) }));
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Redirect ───────────────────────────────────────────────────────────────
  {
    id: 'redirect-loops',
    title: 'Loop di redirect',
    category: 'redirects',
    severity: 'critical',
    effort: 'medium',
    description: 'URL che rimandano ciclicamente a se stesse o a una URL già attraversata.',
    seoImpact:
      'La pagina è completamente irraggiungibile sia per gli utenti sia per i motori di ricerca.',
    recommendation:
      'Ricostruisci la catena di redirect e individua la regola in conflitto (spesso fra .htaccess/nginx e le regole applicative, o fra redirect www/non-www e http/https). Mantieni una sola regola per ogni trasformazione.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => p.redirectLoop)
        .map((p) => ({
          url: p.url,
          evidence: 'Catena: ' + truncate(p.redirectChain.map((h) => h.status).join(' -> '), 100),
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'redirect-chains',
    title: 'Catene di redirect (2 o più salti)',
    category: 'redirects',
    severity: 'high',
    effort: 'medium',
    description: 'URL che raggiungono la destinazione finale dopo due o più redirect consecutivi.',
    seoImpact:
      'Ogni salto aggiunge latenza e disperde parte del segnale di link. Oltre i 3-5 salti Google può interrompere la scansione.',
    recommendation:
      'Riscrivi le regole in modo che la URL di partenza punti direttamente alla destinazione finale con un unico 301, e aggiorna i link interni verso la URL definitiva.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => !p.redirectLoop && p.redirectChain.length >= 2)
        .map((p) => ({
          url: p.url,
          evidence:
            p.redirectChain.length +
            ' salti -> ' +
            truncate(p.finalUrl, 90),
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'internal-links-to-redirects',
    title: 'Link interni che puntano a URL con redirect',
    category: 'redirects',
    severity: 'medium',
    effort: 'medium',
    description:
      'Link interni che non puntano alla URL finale ma a una URL che risponde con un redirect.',
    seoImpact:
      'Rallentano la navigazione, consumano crawl budget e attenuano la trasmissione di autorevolezza fra le pagine.',
    recommendation:
      'Aggiorna gli href nei template, nei menu e nei contenuti in modo che puntino direttamente alla URL di destinazione finale.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter(
          (p) =>
            p.redirectChain.length >= 1 &&
            !p.redirectLoop &&
            p.uniqueInlinks > 0,
        )
        .map((p) => ({
          url: p.url,
          evidence:
            'HTTP ' +
            (p.redirectChain[0]?.status ?? 301) +
            ' -> ' +
            truncate(shortPath(p.finalUrl, 40), 40) +
            linkedFromNote(p),
        }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'temporary-redirects',
    title: 'Redirect temporanei (302 / 307)',
    category: 'redirects',
    severity: 'medium',
    effort: 'low',
    description:
      'URL che usano un redirect temporaneo dove ci si aspetterebbe uno spostamento permanente.',
    seoImpact:
      'Un 302 dice a Google di mantenere in indice la URL di partenza: il consolidamento dei segnali sulla nuova URL viene rallentato o non avviene.',
    recommendation:
      'Se lo spostamento è definitivo sostituisci il 302/307 con un 301 (o 308). Mantieni il redirect temporaneo solo per situazioni realmente transitorie come manutenzioni o A/B test.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.pages
        .filter((p) => p.redirectChain.some((hop) => hop.status === 302 || hop.status === 307))
        .map((p) => {
          const hop = p.redirectChain.find((h) => h.status === 302 || h.status === 307);
          return {
            url: p.url,
            evidence: 'HTTP ' + (hop?.status ?? 302) + ' -> ' + truncate(hop?.location ?? '', 90),
          };
        });
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Canonical ──────────────────────────────────────────────────────────────
  {
    id: 'missing-canonical',
    title: 'Pagine senza tag canonical',
    category: 'canonical',
    severity: 'medium',
    effort: 'low',
    description: 'Pagine HTML indicizzabili prive di un link rel="canonical".',
    seoImpact:
      'Senza canonical, varianti della stessa pagina (parametri, paginazione, maiuscole, slash finale) possono essere trattate come contenuti distinti e duplicati, disperdendo i segnali di ranking.',
    recommendation:
      'Aggiungi un canonical autoreferenziale assoluto su ogni pagina indicizzabile, generato lato template a partire dalla URL pulita.',
    evaluate(ctx) {
      const urls: IssueUrl[] = ctx.htmlPages
        .filter((p) => p.statusCode < 300 && !p.canonical)
        .map((p) => ({ url: p.url, evidence: 'Nessun link rel=canonical nell head' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'canonical-to-broken',
    title: 'Canonical che punta a una URL non valida',
    category: 'canonical',
    severity: 'high',
    effort: 'medium',
    description:
      'Il canonical dichiarato punta a una URL che nel crawl risulta in errore, in redirect o non indicizzabile.',
    seoImpact:
      'Google riceve un segnale di consolidamento verso una pagina che non può indicizzare: nel dubbio ignora il canonical o esclude entrambe le URL.',
    recommendation:
      'Fai puntare il canonical alla URL finale, in stato 200 e indicizzabile. Non usare mai come canonical una URL che a sua volta redirige.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        if (!page.canonicalResolved || page.isSelfCanonical) continue;
        const target = ctx.pagesByUrl.get(page.canonicalResolved);
        if (!target) continue;
        if (target.statusCode >= 300 || !target.indexable) {
          urls.push({
            url: page.url,
            evidence:
              'Canonical -> ' +
              truncate(page.canonicalResolved, 70) +
              ' (' +
              (target.statusCode > 0 ? 'HTTP ' + target.statusCode : target.indexabilityStatus) +
              ')',
          });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'canonical-cross-protocol',
    title: 'Canonical con protocollo o host incoerente',
    category: 'canonical',
    severity: 'medium',
    effort: 'low',
    description:
      'Pagine servite in HTTPS con canonical in HTTP, oppure canonical che punta a un host diverso da quello della pagina.',
    seoImpact:
      'Segnale contraddittorio sulla versione preferita della pagina: può causare indicizzazione della versione sbagliata o esclusione dall’indice.',
    recommendation:
      'Genera il canonical dalla stessa base URL usata dal sito (protocollo, host con o senza www) in modo coerente in tutti i template.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.htmlPages) {
        if (!page.canonicalResolved) continue;
        try {
          const canonical = new URL(page.canonicalResolved);
          const current = new URL(page.url);
          if (current.protocol === 'https:' && canonical.protocol === 'http:') {
            urls.push({ url: page.url, evidence: 'Pagina HTTPS con canonical HTTP' });
          } else if (canonical.hostname !== current.hostname) {
            urls.push({
              url: page.url,
              evidence: 'Canonical verso host diverso: ' + canonical.hostname,
            });
          }
        } catch {
          urls.push({ url: page.url, evidence: 'Canonical non risolvibile: ' + truncate(page.canonical ?? '', 80) });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },

  // ── Robots.txt ─────────────────────────────────────────────────────────────
  {
    id: 'robots-missing',
    title: 'File robots.txt assente',
    category: 'robots_txt',
    severity: 'low',
    effort: 'low',
    description: 'La richiesta a /robots.txt non ha restituito un file valido.',
    seoImpact:
      'Non è un blocco all’indicizzazione, ma il sito perde il controllo sulle sezioni da escludere dalla scansione e il puntamento esplicito alla sitemap.',
    recommendation:
      'Pubblica un robots.txt in root con le direttive minime e la riga Sitemap: che punta alla sitemap XML.',
    evaluate(ctx) {
      if (ctx.crawl.robots.found) return null;
      return {
        urls: [
          {
            url: ctx.crawl.robots.url,
            evidence: 'HTTP ' + ctx.crawl.robots.statusCode,
          },
        ],
        scopeSize: 1,
      };
    },
  },
  {
    id: 'robots-without-sitemap',
    title: 'Robots.txt senza direttiva Sitemap',
    category: 'robots_txt',
    severity: 'low',
    effort: 'low',
    description: 'Il robots.txt esiste ma non dichiara l’indirizzo della sitemap XML.',
    seoImpact:
      'I motori devono scoprire la sitemap per tentativi: la scoperta di nuove URL risulta più lenta, soprattutto sui siti grandi.',
    recommendation:
      'Aggiungi in fondo al robots.txt una riga Sitemap: https://dominio/sitemap.xml (una riga per ogni sitemap o indice).',
    evaluate(ctx) {
      if (!ctx.crawl.robots.found || ctx.crawl.robots.sitemaps.length > 0) return null;
      return {
        urls: [{ url: ctx.crawl.robots.url, evidence: 'Nessuna direttiva Sitemap trovata' }],
        scopeSize: 1,
      };
    },
  },

  // ── Sitemap ────────────────────────────────────────────────────────────────
  {
    id: 'sitemap-missing',
    title: 'Sitemap XML non trovata',
    category: 'sitemap',
    severity: 'high',
    effort: 'low',
    description:
      'Nessuna sitemap valida trovata tramite robots.txt né ai percorsi convenzionali (/sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml).',
    seoImpact:
      'La scoperta delle URL dipende esclusivamente dai link interni: pagine nuove, profonde o poco linkate vengono indicizzate con forte ritardo o non vengono trovate.',
    recommendation:
      'Genera una sitemap XML con le sole URL indicizzabili in stato 200, dichiarala nel robots.txt e inviala in Google Search Console.',
    evaluate(ctx) {
      if (ctx.crawl.sitemap.found) return null;
      return {
        urls: [{ url: ctx.crawl.rootUrl, evidence: 'Nessuna sitemap raggiungibile' }],
        scopeSize: 1,
      };
    },
  },
  {
    id: 'sitemap-non-indexable',
    title: 'Sitemap contenente URL non indicizzabili',
    category: 'sitemap',
    severity: 'medium',
    effort: 'low',
    description:
      'La sitemap dichiara URL che rispondono con errore, redirect, noindex oppure sono canonicalizzate altrove.',
    seoImpact:
      'Una sitemap sporca riduce la fiducia di Google nel file e spreca crawl budget su URL che non possono comparire in indice.',
    recommendation:
      'Filtra la generazione della sitemap includendo solo URL in stato 200, indicizzabili e autoreferenziali sul canonical.',
    evaluate(ctx) {
      if (!ctx.crawl.sitemap.found) return null;
      const urls: IssueUrl[] = [];
      for (const url of ctx.crawl.sitemap.urls) {
        const page = ctx.pagesByUrl.get(url);
        if (!page) continue;
        if (!page.indexable) {
          urls.push({
            url,
            evidence:
              page.statusCode >= 300 || page.statusCode === 0
                ? 'HTTP ' + page.statusCode + ' (' + page.indexabilityStatus + ')'
                : page.indexabilityStatus,
          });
        }
      }
      if (urls.length === 0) return null;
      return { urls, scopeSize: Math.max(1, ctx.crawl.sitemap.urls.length) };
    },
  },
  {
    id: 'sitemap-missing-pages',
    title: 'Pagine indicizzabili assenti dalla sitemap',
    category: 'sitemap',
    severity: 'medium',
    effort: 'low',
    description:
      'Pagine in stato 200 e indicizzabili trovate durante il crawl ma non dichiarate in nessuna sitemap.',
    seoImpact:
      'Le pagine restano scopribili solo tramite link interni: su siti ampi questo si traduce in indicizzazione lenta o parziale.',
    recommendation:
      'Verifica le regole di generazione della sitemap e includi tutti i tipi di contenuto indicizzabili (post, pagine, tassonomie, prodotti, contenuti custom).',
    evaluate(ctx) {
      if (!ctx.crawl.sitemap.found) return null;
      const urls: IssueUrl[] = ctx.indexablePages
        .filter((p) => !p.inSitemap)
        .map((p) => ({ url: p.url, evidence: 'Indicizzabile ma non presente in sitemap' }));
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'sitemap-errors',
    title: 'Errori nel recupero o nel parsing della sitemap',
    category: 'sitemap',
    severity: 'medium',
    effort: 'low',
    description: 'Una o più sitemap dichiarate non sono scaricabili o non sono XML validi.',
    seoImpact:
      'Le URL contenute nei file in errore non vengono comunicate ai motori di ricerca.',
    recommendation:
      'Correggi i file segnalati: verifica che rispondano 200, che siano XML validi e che i <loc> usino URL assolute con lo stesso protocollo e host del sito.',
    evaluate(ctx) {
      const errors = ctx.crawl.sitemap.errors;
      if (errors.length === 0) return null;
      return {
        urls: errors.map((e) => {
          const separator = e.indexOf(': ');
          return {
            url: separator > 0 ? e.slice(0, separator) : e,
            evidence: separator > 0 ? e.slice(separator + 2) : 'Errore di parsing',
          };
        }),
        scopeSize: Math.max(1, errors.length),
      };
    },
  },
];
