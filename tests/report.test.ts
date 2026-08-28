import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/audit/engine';
import { renderReportHtml } from '../src/report/html';
import { resultBlocks } from '../src/slack/blocks';
import { makeCrawlResult, makePage } from './factories';

const audit = runAudit(
  makeCrawlResult([
    makePage({ url: 'https://example.com/', title: null, titleLength: 0 }),
    makePage({
      url: 'https://example.com/rotta',
      depth: 1,
      statusCode: 404,
      indexable: false,
      indexabilityStatus: 'Client Error',
      uniqueInlinks: 4,
    }),
    makePage({ url: 'https://example.com/scarna', depth: 2, wordCount: 30, h1: [] }),
  ]),
);

const branding = { brandName: 'Diamondweb', brandColor: '#1d4ed8' };

describe('report HTML', async () => {
  const html = await renderReportHtml(audit, branding);

  it('produce un documento completo', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('include tutte le sezioni previste', () => {
    for (const section of [
      'Executive summary',
      'Punteggio per area tecnica',
      'Criticità principali',
      'Problemi rilevati per priorità',
      'Metodologia e configurazione',
    ]) {
      expect(html).toContain(section);
    }
  });

  it('mostra dominio, punteggio e branding', () => {
    expect(html).toContain('example.com');
    expect(html).toContain(String(audit.score.total));
    expect(html).toContain('Diamondweb');
    expect(html).toContain('#1d4ed8');
  });

  it('elenca le issue rilevate con la soluzione consigliata', () => {
    expect(html).toContain('Soluzione consigliata');
    expect(html).toContain('Impatto SEO');
    const firstIssue = audit.issues[0];
    expect(html).toContain(firstIssue.title);
  });

  it('esegue l escaping del contenuto proveniente dal sito', async () => {
    const hostile = runAudit(
      makeCrawlResult([
        makePage({
          url: 'https://example.com/',
          title: '<script>alert(1)</script>',
          titleLength: 25,
        }),
        makePage({
          url: 'https://example.com/due',
          depth: 1,
          title: '<script>alert(1)</script>',
          titleLength: 25,
        }),
      ]),
    );
    const hostileHtml = await renderReportHtml(hostile, branding);
    expect(hostileHtml).not.toContain('<script>alert(1)</script>');
    expect(hostileHtml).toContain('&lt;script&gt;');
  });
});

describe('blocchi Slack', () => {
  it('costruisce un messaggio di riepilogo valido', () => {
    const blocks = resultBlocks(audit);
    expect(blocks[0].type).toBe('header');
    expect(JSON.stringify(blocks)).toContain('example.com');
    expect(JSON.stringify(blocks)).toContain(String(audit.score.total));
  });

  it('resta entro il limite di 50 blocchi di Slack', () => {
    expect(resultBlocks(audit).length).toBeLessThanOrEqual(50);
  });
});

describe('identità grafica del report', async () => {
  const html = await renderReportHtml(audit, branding);

  it('incorpora Montserrat come data URI, senza dipendere dalla rete', () => {
    // Se il font venisse richiamato da Google Fonts, un rendering offline o in container
    // produrrebbe un PDF con i caratteri sbagliati.
    expect(html).toContain('@font-face');
    expect(html).toContain("font-family: 'Montserrat'");
    expect(html).toContain('url(data:font/woff2;base64,');
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('dichiara Montserrat come font del documento, con ripieghi di sistema', () => {
    expect(html).toMatch(/font-family:\s*'Montserrat'[^;]*sans-serif/);
  });

  it('usa la palette scura del modello', () => {
    expect(html).toContain('--bg: #0d0b26');
    expect(html).toContain('--gradient:');
  });

  it('dipinge lo sfondo sul body, cosi da coprire anche i margini di pagina', () => {
    // La propagazione dello sfondo del body alla canvas e cio che rende scura l'intera
    // pagina PDF invece di un rettangolo su carta bianca.
    expect(html).toMatch(/body\s*\{[^}]*background:\s*var\(--bg\)/);
  });
});
