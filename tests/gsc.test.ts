import { describe, expect, it } from 'vitest';
import { classifyLinksCsv, parseCsv } from '../src/gsc/links';
import { matchProperty } from '../src/gsc/client';

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

describe('scelta della proprietà Search Console', () => {
  const fakeAccount = { keyPath: 'k.json', email: 'bot@p.iam.gserviceaccount.com', getAccessToken: async () => 't' };
  const prop = (siteUrl: string) => ({ siteUrl, permissionLevel: 'siteOwner', account: fakeAccount });

  it('preferisce la proprietà Dominio, che copre tutte le varianti', () => {
    const found = matchProperty('example.com', [
      prop('https://example.com/'),
      prop('sc-domain:example.com'),
    ]);
    expect(found?.siteUrl).toBe('sc-domain:example.com');
  });

  it('accetta una proprietà URL con lo stesso host', () => {
    expect(matchProperty('example.com', [prop('https://www.example.com/')])?.siteUrl).toBe(
      'https://www.example.com/',
    );
    expect(matchProperty('www.example.com', [prop('https://example.com/')])?.siteUrl).toBe(
      'https://example.com/',
    );
  });

  it('NON usa la proprietà di un sottodominio per il dominio principale', () => {
    // Il caso che il criterio severo esiste per prevenire: i dati dello shop
    // presentati come se fossero quelli del sito.
    expect(matchProperty('example.com', [prop('https://shop.example.com/')])).toBeNull();
  });

  it('non confonde domini che condividono un suffisso', () => {
    expect(matchProperty('example.com', [prop('sc-domain:notexample.com')])).toBeNull();
    expect(matchProperty('example.com', [prop('https://example.com.mx/')])).toBeNull();
  });

  it('ritorna null quando non c’è nessuna proprietà', () => {
    expect(matchProperty('example.com', [])).toBeNull();
  });

  it('trova la proprietà giusta in un insieme di più account', () => {
    const altro = { ...fakeAccount, email: 'cliente@x.iam.gserviceaccount.com' };
    const found = matchProperty('cliente-due.it', [
      prop('sc-domain:cliente-uno.it'),
      { siteUrl: 'sc-domain:cliente-due.it', permissionLevel: 'siteOwner', account: altro },
      prop('https://terzo.it/'),
    ]);
    expect(found?.siteUrl).toBe('sc-domain:cliente-due.it');
    expect(found?.account.email).toBe('cliente@x.iam.gserviceaccount.com');
  });
});
