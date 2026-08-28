import { truncate } from '../../utils/text';
import type { IssueUrl, Rule } from '../types';

/**
 * Regole basate sui dati di Search Console: sono l'unica fonte in cui non si stima nulla,
 * perché a parlare è Google stesso — stato di indicizzazione reale e comportamento reale
 * degli utenti in SERP.
 */
export const gscRules: Rule[] = [
  {
    id: 'gsc-not-indexed',
    title: 'Pagine importanti escluse dall’indice secondo Google',
    category: 'crawling_indexing',
    severity: 'high',
    effort: 'medium',
    description:
      'La URL Inspection API di Search Console riporta che queste pagine non sono indicizzate. ' +
      'Non è una stima del crawler: è lo stato dichiarato da Google.',
    seoImpact:
      'Una pagina fuori dall’indice non può comparire per nessuna ricerca, qualunque sia la ' +
      'qualità del contenuto. Se è una pagina di valore, il traffico perso è totale.',
    recommendation:
      'Il motivo esatto è nella colonna dello stato: "Crawled - currently not indexed" indica ' +
      'un problema di qualità o duplicazione percepita; "Discovered - currently not indexed" ' +
      'un problema di crawl budget; "Excluded by noindex" una direttiva da rimuovere. Dopo la ' +
      'correzione, richiedi l’indicizzazione da Search Console.',
    evaluate(ctx) {
      const inspections = ctx.gsc?.inspections ?? [];
      const urls: IssueUrl[] = inspections
        .filter((i) => i.verdict !== 'PASS' && i.coverageState !== '—')
        .map((i) => ({
          url: i.url,
          evidence:
            truncate(i.coverageState, 60) +
            (i.lastCrawlTime
              ? ' · ultima scansione ' + i.lastCrawlTime.slice(0, 10)
              : ' · mai scansionata'),
        }));
      if (urls.length === 0) return null;
      return { urls, scopeSize: Math.max(1, inspections.length) };
    },
  },
  {
    id: 'gsc-low-ctr',
    title: 'Pagine visibili in SERP ma poco cliccate',
    category: 'metadata',
    severity: 'medium',
    effort: 'low',
    description:
      'Pagine che negli ultimi 28 giorni hanno avuto molte impression in posizioni visibili ' +
      'ma un CTR sotto l’1%: gli utenti le vedono e scelgono altro.',
    seoImpact:
      'Sono i casi in cui riscrivere title e meta description rende di più: la visibilità ' +
      'c’è già, manca solo il click. Un CTR che sale è traffico immediato senza guadagnare ' +
      'una posizione.',
    recommendation:
      'Riscrivi title e description delle pagine elencate guardando la query principale per ' +
      'cui compaiono: promessa esplicita, numeri concreti, invito coerente con l’intento. ' +
      'Confronta il CTR in Search Console dopo 2-3 settimane.',
    evaluate(ctx) {
      const rows = ctx.gsc?.topPages ?? [];
      const urls: IssueUrl[] = rows
        .filter((r) => r.impressions >= 200 && r.ctr < 0.01 && r.position <= 20)
        .slice(0, 25)
        .map((r) => ({
          url: r.keys[0] ?? '',
          evidence:
            r.impressions +
            ' impression · CTR ' +
            (r.ctr * 100).toFixed(1) +
            '% · posizione media ' +
            r.position.toFixed(1),
        }))
        .filter((u) => u.url !== '');
      if (urls.length === 0) return null;
      return { urls, scopeSize: Math.max(1, rows.length) };
    },
  },
];
