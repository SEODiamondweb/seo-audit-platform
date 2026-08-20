import { describe, expect, it } from 'vitest';
import { classifyLinksCsv, parseCsv } from '../src/gsc/links';

describe('parser CSV degli export GSC', () => {
  it('gestisce virgolette, virgole nei valori e BOM', () => {
    const rows = parseCsv('﻿Sito,"Pagine, con link",Destinazioni\r\nexample.com,"1.234",5\r\n');
    expect(rows[0]).toEqual(['Sito', 'Pagine, con link', 'Destinazioni']);
    expect(rows[1]).toEqual(['example.com', '1.234', '5']);
  });

  it('ignora le righe vuote', () => {
    const rows = parseCsv('a,b\n\n1,2\n\n');
    expect(rows).toHaveLength(2);
  });
});

describe('classificazione degli export del report Link', () => {
  it('riconosce l’elenco dei siti che linkano (nome file irrilevante)', () => {
    const rows = parseCsv(
      'Siti principali con link,Pagine con link,Pagine di destinazione\nblog-partner.it,42,7\naltro-sito.com,11,3\n',
    );
    const result = classifyLinksCsv(rows);
    expect(result?.kind).toBe('sites');
    if (result?.kind !== 'sites') return;
    expect(result.data[0]).toEqual({ site: 'blog-partner.it', linkingPages: 42, targetPages: 7 });
  });

  it('riconosce l’elenco delle pagine collegate', () => {
    const rows = parseCsv(
      'Pagine di destinazione principali,Link in ingresso,Siti con link\nhttps://example.com/guida/,120,15\n',
    );
    const result = classifyLinksCsv(rows);
    expect(result?.kind).toBe('pages');
    if (result?.kind !== 'pages') return;
    expect(result.data[0]).toEqual({
      page: 'https://example.com/guida/',
      incomingLinks: 120,
      linkingSites: 15,
    });
  });

  it('interpreta i numeri con separatore delle migliaia italiano', () => {
    const rows = parseCsv('Sito,Pagine,Dest\nbig-site.com,"1.234",9\n');
    const result = classifyLinksCsv(rows);
    if (result?.kind !== 'sites') throw new Error('classificazione errata');
    expect(result.data[0]?.linkingPages).toBe(1234);
  });

  it('scarta i CSV che non sono un report Link', () => {
    expect(classifyLinksCsv(parseCsv('Query,Click\nscarpe rosse,10\n'))).toBeNull();
    expect(classifyLinksCsv(parseCsv('solo intestazione\n'))).toBeNull();
  });
});
