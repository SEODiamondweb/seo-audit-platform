import { describe, expect, it } from 'vitest';
import { parseHtml } from '../src/crawler/parse';

const HTML = `<!doctype html>
<html lang="it">
<head>
  <title>  Pagina   di   prova  </title>
  <meta name="description" content="Descrizione di prova">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://example.com/pagina">
  <link rel="alternate" hreflang="en" href="https://example.com/en/page">
  <link rel="alternate" hreflang="x-default" href="https://example.com/">
  <meta property="og:title" content="Titolo social">
  <meta property="og:image" content="https://example.com/og.png">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Article","headline":"Un titolo"}
  </script>
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product"}
  </script>
  <script type="application/ld+json">{ non valido }</script>
</head>
<body>
  <h1>Titolo principale</h1>
  <h2>Prima sezione</h2>
  <h2>Seconda sezione</h2>
  <p>Testo della pagina con alcune parole utili al conteggio.</p>
  <img src="/img/foto.jpg" alt="Una foto" width="800" height="600">
  <img src="/img/deco.png">
  <img src="/img/vuoto.png" alt="">
  <script src="http://cdn.example.com/legacy.js"></script>
  <a href="/interna">Pagina interna</a>
  <a href="https://esterno.it/x" rel="nofollow noopener">Sito esterno</a>
  <a href="#ancora">Ancora</a>
  <a href="mailto:info@example.com">Mail</a>
  <script>var ignorato = "questo testo non conta";</script>
</body>
</html>`;

describe('parseHtml', () => {
  const parsed = parseHtml(HTML, 'https://example.com/pagina');

  it('normalizza gli spazi nel title', () => {
    expect(parsed.title).toBe('Pagina di prova');
  });

  it('estrae description, canonical e lang', () => {
    expect(parsed.metaDescription).toBe('Descrizione di prova');
    expect(parsed.canonical).toBe('https://example.com/pagina');
    expect(parsed.lang).toBe('it');
    expect(parsed.hasViewport).toBe(true);
  });

  it('estrae heading e hreflang', () => {
    expect(parsed.h1).toEqual(['Titolo principale']);
    expect(parsed.h2).toHaveLength(2);
    expect(parsed.hreflang.map((h) => h.lang)).toEqual(['en', 'x-default']);
  });

  it('distingue alt assente da alt vuoto', () => {
    expect(parsed.images).toHaveLength(3);
    expect(parsed.images.filter((i) => !i.hasAltAttribute)).toHaveLength(1);
    expect(parsed.images.filter((i) => i.hasAltAttribute && i.alt === '')).toHaveLength(1);
  });

  it('risolve le URL delle immagini in assoluto', () => {
    expect(parsed.images[0].src).toBe('https://example.com/img/foto.jpg');
  });

  it('ignora ancore, mailto e link vuoti', () => {
    expect(parsed.links).toHaveLength(2);
    expect(parsed.links.filter((l) => l.nofollow)).toHaveLength(1);
  });

  it('segnala il contenuto misto su pagina HTTPS', () => {
    expect(parsed.mixedContent).toContain('http://cdn.example.com/legacy.js');
  });

  it('raccoglie i tipi di dati strutturati e gli errori', () => {
    const jsonLd = parsed.structuredData.filter((b) => b.format === 'json-ld');
    expect(jsonLd).toHaveLength(3);

    const types = jsonLd.flatMap((b) => b.types);
    expect(types).toContain('Article');
    expect(types).toContain('Product');

    const errors = jsonLd.flatMap((b) => b.errors);
    // Product senza "name" + blocco non parsabile
    expect(errors.some((e) => e.includes('name'))).toBe(true);
    expect(errors.some((e) => e.includes('non parsabile'))).toBe(true);
  });

  it('non conta il testo degli script nel word count', () => {
    expect(parsed.wordCount).toBeGreaterThan(5);
    expect(parsed.wordCount).toBeLessThan(40);
  });
});

describe('parseHtml su HTML degenere', () => {
  it('non lancia su documento vuoto', () => {
    const parsed = parseHtml('', 'https://example.com/');
    expect(parsed.title).toBeNull();
    expect(parsed.h1).toEqual([]);
    expect(parsed.wordCount).toBe(0);
  });

  it('rispetta il tag base per le URL relative', () => {
    const html = '<html><head><base href="https://example.com/sub/"></head><body><a href="x">x</a></body></html>';
    const parsed = parseHtml(html, 'https://example.com/altro/pagina');
    expect(parsed.links[0].url).toBe('https://example.com/sub/x');
  });
});
