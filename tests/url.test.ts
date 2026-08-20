import { describe, expect, it } from 'vitest';
import {
  isSameSite,
  looksLikeAsset,
  normalizeUrl,
  pathDepth,
  safeParseUrl,
  shortPath,
} from '../src/utils/url';

describe('normalizeUrl', () => {
  it('rimuove il fragment', () => {
    expect(normalizeUrl('https://example.com/pagina#sezione')).toBe('https://example.com/pagina');
  });

  it('rimuove i parametri di tracking mantenendo gli altri', () => {
    expect(normalizeUrl('https://example.com/p?utm_source=news&id=7&gclid=abc')).toBe(
      'https://example.com/p?id=7',
    );
  });

  it('conserva lo slash finale, che per il server e significativo', () => {
    // Toglierlo trasformerebbe ogni URL WordPress in un redirect verso la versione con slash.
    expect(normalizeUrl('https://example.com/blog/')).toBe('https://example.com/blog/');
    expect(normalizeUrl('https://example.com/blog')).toBe('https://example.com/blog');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('tratta come distinte le due varianti con e senza slash', () => {
    expect(normalizeUrl('https://example.com/blog/')).not.toBe(normalizeUrl('https://example.com/blog'));
  });

  it('collassa gli slash ripetuti nel path', () => {
    expect(normalizeUrl('https://example.com//blog///post/')).toBe('https://example.com/blog/post/');
  });

  it('rimuove la porta di default e normalizza l host', () => {
    expect(normalizeUrl('https://EXAMPLE.com:443/pagina')).toBe('https://example.com/pagina');
  });

  it('ordina i parametri per rendere stabile la deduplica', () => {
    expect(normalizeUrl('https://example.com/p?b=2&a=1')).toBe(normalizeUrl('https://example.com/p?a=1&b=2'));
  });

  it('scarta i protocolli non http', () => {
    expect(normalizeUrl('mailto:info@example.com')).toBeNull();
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
  });

  it('risolve le URL relative sulla base', () => {
    expect(normalizeUrl('/contatti', 'https://example.com/blog/post')).toBe(
      'https://example.com/contatti',
    );
  });
});

describe('isSameSite', () => {
  const root = safeParseUrl('https://example.com/') as URL;

  it('considera www e non-www lo stesso sito', () => {
    expect(isSameSite(safeParseUrl('https://www.example.com/x') as URL, root, false)).toBe(true);
  });

  it('esclude i sottodomini se non richiesti', () => {
    expect(isSameSite(safeParseUrl('https://blog.example.com/x') as URL, root, false)).toBe(false);
    expect(isSameSite(safeParseUrl('https://blog.example.com/x') as URL, root, true)).toBe(true);
  });

  it('esclude sempre i domini esterni', () => {
    expect(isSameSite(safeParseUrl('https://altrosito.it/x') as URL, root, true)).toBe(false);
  });
});

describe('looksLikeAsset', () => {
  it('riconosce le estensioni non HTML', () => {
    expect(looksLikeAsset(safeParseUrl('https://example.com/file.pdf') as URL)).toBe(true);
    expect(looksLikeAsset(safeParseUrl('https://example.com/img.webp') as URL)).toBe(true);
  });

  it('non scarta le pagine senza estensione', () => {
    expect(looksLikeAsset(safeParseUrl('https://example.com/servizi/seo') as URL)).toBe(false);
  });
});

describe('helper di percorso', () => {
  it('calcola la profondità dal path', () => {
    expect(pathDepth(safeParseUrl('https://example.com/') as URL)).toBe(0);
    expect(pathDepth(safeParseUrl('https://example.com/a/b/c') as URL)).toBe(3);
  });

  it('accorcia i path lunghi per le tabelle del report', () => {
    const long = 'https://example.com/' + 'segmento/'.repeat(20);
    expect(shortPath(long, 30).length).toBeLessThanOrEqual(30);
  });
});
