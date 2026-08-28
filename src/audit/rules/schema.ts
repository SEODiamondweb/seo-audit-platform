import { truncate } from '../../utils/text';
import type { CrawledUrl, StructuredDataEntity } from '../../crawler/types';
import type { IssueUrl, Rule } from '../types';

/** Tutte le entità dichiarate su una pagina, di qualunque formato. */
function entitiesOf(page: CrawledUrl): StructuredDataEntity[] {
  return page.structuredData.flatMap((block) => block.entities);
}

function hasType(page: CrawledUrl, ...types: string[]): boolean {
  const wanted = types.map((t) => t.toLowerCase());
  return entitiesOf(page).some((entity) => wanted.includes(entity.type.toLowerCase()));
}

function entitiesByType(page: CrawledUrl, ...types: string[]): StructuredDataEntity[] {
  const wanted = types.map((t) => t.toLowerCase());
  return entitiesOf(page).filter((entity) => wanted.includes(entity.type.toLowerCase()));
}

/** Proprietà attese ma assenti, confrontate senza distinzione di maiuscole. */
function missingProperties(entity: StructuredDataEntity, expected: string[]): string[] {
  const present = new Set(entity.properties.map((p) => p.toLowerCase()));
  return expected.filter((prop) => !present.has(prop.toLowerCase()));
}

const ARTICLE_TYPES = ['Article', 'NewsArticle', 'BlogPosting', 'TechArticle'];
const BUSINESS_TYPES = ['Organization', 'LocalBusiness', 'Corporation', 'ProfessionalService'];

/**
 * Tipi che hanno senso una volta sola per pagina.
 *
 * Gli altri no: un'azienda che opera in sette città dichiara sette City, sette Service e
 * sette Offer, ed è corretto. Segnalare quelli come duplicati sarebbe un falso positivo.
 */
const SINGLETON_TYPES = new Set([
  'organization',
  'localbusiness',
  'corporation',
  'professionalservice',
  'homeandconstructionbusiness',
  'website',
  'webpage',
  'collectionpage',
  'profilepage',
  'breadcrumblist',
  'article',
  'newsarticle',
  'blogposting',
  'techarticle',
  'product',
  'faqpage',
  'searchaction',
]);

/**
 * Un'entità con @id e quasi nessuna proprietà è un riferimento a un'entità definita altrove,
 * non una dichiarazione incompleta: non va segnalata come tale.
 */
function isReference(entity: StructuredDataEntity): boolean {
  return entity.hasId && entity.properties.length <= 1;
}

export const schemaRules: Rule[] = [
  {
    id: 'schema-missing-organization',
    title: 'Home page senza markup dell’organizzazione',
    category: 'structured_data',
    severity: 'medium',
    effort: 'low',
    description:
      'La home page non dichiara un’entità Organization o LocalBusiness in JSON-LD.',
    seoImpact:
      'È il markup con cui si dichiara a Google chi è il soggetto dietro al sito: nome ufficiale, ' +
      'logo, contatti e profili social. Senza, il knowledge panel e il logo in SERP non hanno una ' +
      'fonte dichiarata e Google deve dedurli.',
    recommendation:
      'Aggiungi in home un blocco JSON-LD Organization (o LocalBusiness per un’attività locale) con ' +
      'name, url, logo, sameAs verso i profili social e i dati di contatto.',
    evaluate(ctx) {
      const home = ctx.indexablePages.find((p) => p.depth === 0);
      if (!home || hasType(home, ...BUSINESS_TYPES)) return null;
      return {
        urls: [{ url: home.url, evidence: 'Nessuna entità Organization o LocalBusiness' }],
        scopeSize: 1,
      };
    },
  },
  {
    id: 'schema-organization-incomplete',
    title: 'Markup dell’organizzazione incompleto',
    category: 'structured_data',
    severity: 'low',
    effort: 'low',
    description:
      'L’entità Organization o LocalBusiness è dichiarata ma priva di proprietà fondamentali.',
    seoImpact:
      'Le proprietà mancanti sono quelle che alimentano knowledge panel e scheda locale: senza ' +
      'logo, contatti o sameAs, Google non collega il sito all’entità reale dell’azienda.',
    recommendation:
      'Completa il markup con url, logo, sameAs (profili social ufficiali) e, per un’attività ' +
      'locale, address e telephone in formato strutturato.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.indexablePages) {
        for (const entity of entitiesByType(page, ...BUSINESS_TYPES)) {
          if (isReference(entity)) continue;
          const isLocal = /local|professional/i.test(entity.type);
          const expected = isLocal
            ? ['name', 'url', 'logo', 'address', 'telephone']
            : ['name', 'url', 'logo', 'sameAs'];
          const missing = missingProperties(entity, expected);
          if (missing.length > 0) {
            urls.push({
              url: page.url,
              evidence: entity.type + ': manca ' + missing.join(', '),
            });
          }
        }
      }
      // Il markup dell'organizzazione e di solito identico su tutto il sito: una segnalazione basta.
      const unique = urls.filter(
        (entry, i) => urls.findIndex((other) => other.evidence === entry.evidence) === i,
      );
      return unique.length > 0 ? { urls: unique, scopeSize: Math.max(1, unique.length) } : null;
    },
  },
  {
    id: 'schema-article-incomplete',
    title: 'Markup Article privo dei dati editoriali',
    category: 'structured_data',
    severity: 'medium',
    effort: 'low',
    description:
      'Entità Article, NewsArticle o BlogPosting senza autore, data di pubblicazione o immagine.',
    seoImpact:
      'Sono le proprietà che rendono un articolo eleggibile ai risultati arricchiti e ai caroselli ' +
      'editoriali. Senza autore e data, Google non può nemmeno valutare freschezza e paternità del ' +
      'contenuto, due elementi centrali per i criteri E-E-A-T.',
    recommendation:
      'Completa il markup con headline, author (con name), datePublished, dateModified e image ' +
      'ad alta risoluzione.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.indexablePages) {
        for (const entity of entitiesByType(page, ...ARTICLE_TYPES)) {
          if (isReference(entity)) continue;
          const missing = missingProperties(entity, [
            'headline',
            'author',
            'datePublished',
            'image',
          ]);
          if (missing.length > 0) {
            urls.push({ url: page.url, evidence: entity.type + ': manca ' + missing.join(', ') });
          }
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'schema-product-incomplete',
    title: 'Markup Product senza offerta o valutazioni',
    category: 'structured_data',
    severity: 'high',
    effort: 'medium',
    description:
      'Entità Product prive di offers, quindi senza prezzo e disponibilità dichiarati.',
    seoImpact:
      'Senza offers il prodotto non è eleggibile ai rich result commerciali: niente prezzo, ' +
      'disponibilità o stelle in SERP, che sono gli elementi che alzano il CTR sulle query ' +
      'transazionali.',
    recommendation:
      'Aggiungi offers con price, priceCurrency e availability, e dove esistono recensioni reali ' +
      'anche aggregateRating e review.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.indexablePages) {
        for (const entity of entitiesByType(page, 'Product')) {
          if (isReference(entity)) continue;
          const missing = missingProperties(entity, ['offers']);
          if (missing.length > 0) {
            urls.push({ url: page.url, evidence: 'Product senza offers (prezzo e disponibilità)' });
          }
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'schema-no-entity-linking',
    title: 'Entità Schema non collegate fra loro',
    category: 'structured_data',
    severity: 'low',
    effort: 'medium',
    description:
      'Il sito dichiara markup strutturato ma nessuna entità usa @id, quindi ogni blocco resta ' +
      'isolato dagli altri.',
    seoImpact:
      'Con @id le entità si referenziano a vicenda e formano un grafo unico: l’articolo punta ' +
      'all’autore, l’autore all’organizzazione. Senza, Google vede entità scollegate e ripetute ' +
      'e ricostruisce le relazioni per conto proprio, con esiti meno prevedibili.',
    recommendation:
      'Assegna un @id stabile a ogni entità persistente (organizzazione, sito, autori) e riferisci ' +
      'quelle entità dagli altri blocchi con { "@id": "..." } invece di riscriverle ogni volta.',
    evaluate(ctx) {
      const withSchema = ctx.indexablePages.filter((p) => entitiesOf(p).length > 0);
      if (withSchema.length < 3) return null;
      const withIds = withSchema.filter((p) => entitiesOf(p).some((e) => e.hasId));
      if (withIds.length > 0) return null;
      return {
        urls: withSchema
          .slice(0, 50)
          .map((p) => ({ url: p.url, evidence: 'Nessun @id fra le entità dichiarate' })),
        note: 'Nessuna delle ' + withSchema.length + ' pagine con markup usa @id.',
      };
    },
  },
  {
    id: 'schema-faq-incomplete',
    title: 'Markup FAQPage incompleto',
    category: 'structured_data',
    severity: 'medium',
    effort: 'low',
    description: 'Entità FAQPage senza mainEntity, oppure Question senza acceptedAnswer.',
    seoImpact:
      'Un FAQPage senza la catena mainEntity → Question → acceptedAnswer viene ignorato: la pagina ' +
      'perde l’eleggibilità al rich result a fisarmonica, che occupa molto spazio in SERP.',
    recommendation:
      'Struttura il markup come FAQPage con mainEntity, un elenco di Question ciascuna con name e ' +
      'acceptedAnswer di tipo Answer con text. Le domande devono essere visibili anche in pagina.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.indexablePages) {
        for (const entity of entitiesByType(page, 'FAQPage')) {
          if (missingProperties(entity, ['mainEntity']).length > 0) {
            urls.push({ url: page.url, evidence: 'FAQPage senza mainEntity' });
          }
        }
        for (const entity of entitiesByType(page, 'Question')) {
          const missing = missingProperties(entity, ['name', 'acceptedAnswer']);
          if (missing.length > 0) {
            urls.push({ url: page.url, evidence: 'Question: manca ' + missing.join(', ') });
          }
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
  {
    id: 'schema-types-inconsistent',
    title: 'Entità Schema singleton dichiarate più volte',
    category: 'structured_data',
    severity: 'low',
    effort: 'low',
    description:
      'La stessa pagina dichiara più volte un tipo che dovrebbe comparire una volta sola ' +
      '(Organization, WebSite, la pagina stessa, l’articolo), quasi sempre perché più plugin ' +
      'generano markup in parallelo.',
    seoImpact:
      'Le dichiarazioni concorrenti possono contraddirsi e Google ne sceglie una in modo non ' +
      'prevedibile: il markup diventa inaffidabile e i rich result intermittenti.',
    recommendation:
      'Individua quale plugin o template genera il markup e disattiva gli altri, lasciando una ' +
      'sola fonte per ogni tipo di entità.',
    evaluate(ctx) {
      const urls: IssueUrl[] = [];
      for (const page of ctx.indexablePages) {
        const counts = new Map<string, number>();
        for (const entity of entitiesOf(page)) {
          const key = entity.type.toLowerCase();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const duplicated = [...counts.entries()]
          .filter(([type, count]) => count > 1 && SINGLETON_TYPES.has(type))
          .map(([type, count]) => type + ' ×' + count);
        if (duplicated.length > 0) {
          urls.push({ url: page.url, evidence: truncate(duplicated.join(', '), 90) });
        }
      }
      return urls.length > 0 ? { urls } : null;
    },
  },
];
