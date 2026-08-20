import { describe, expect, it } from 'vitest';
import { CommandError, parseCommand, tokenize } from '../src/slack/parseArgs';
import { resolveStartUrl } from '../src/pipeline';

describe('tokenize', () => {
  it('rispetta le virgolette', () => {
    expect(tokenize('example.com --ua "Mozilla 5.0 Test"')).toEqual([
      'example.com',
      '--ua',
      'Mozilla 5.0 Test',
    ]);
  });

  it('gestisce spazi multipli', () => {
    expect(tokenize('  a   b  ')).toEqual(['a', 'b']);
  });
});

describe('parseCommand', () => {
  it('restituisce l aiuto senza argomenti', () => {
    expect(parseCommand('').kind).toBe('help');
    expect(parseCommand('help').kind).toBe('help');
  });

  it('legge il dominio e le opzioni numeriche', () => {
    const parsed = parseCommand('example.com --max 300 --depth 4 --delay 500');
    expect(parsed.kind).toBe('audit');
    expect(parsed.url).toBe('example.com');
    expect(parsed.overrides.maxUrls).toBe(300);
    expect(parsed.overrides.maxDepth).toBe(4);
    expect(parsed.overrides.delayMs).toBe(500);
  });

  it('legge i flag booleani', () => {
    const parsed = parseCommand('example.com --subdomains --no-robots');
    expect(parsed.overrides.includeSubdomains).toBe(true);
    expect(parsed.overrides.respectRobots).toBe(false);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('espande i preset di user agent', () => {
    const parsed = parseCommand('example.com --ua googlebot');
    expect(parsed.overrides.userAgent).toContain('Googlebot');
  });

  it('accumula include ed exclude', () => {
    const parsed = parseCommand('example.com --include "/blog" --exclude "\\?s=" --exclude "/tag/"');
    expect(parsed.overrides.include).toEqual(['/blog']);
    expect(parsed.overrides.exclude).toEqual(['\\?s=', '/tag/']);
  });

  it('rifiuta le opzioni sconosciute', () => {
    expect(() => parseCommand('example.com --sconosciuta')).toThrow(CommandError);
  });

  it('rifiuta i valori non numerici', () => {
    expect(() => parseCommand('example.com --max tanti')).toThrow(CommandError);
  });

  it('rifiuta i valori fuori intervallo', () => {
    expect(() => parseCommand('example.com --max 999999')).toThrow(CommandError);
  });
});

describe('resolveStartUrl', () => {
  it('aggiunge https quando manca il protocollo', () => {
    expect(resolveStartUrl('example.com')).toBe('https://example.com/');
  });

  it('scarta il formato link di Slack', () => {
    expect(resolveStartUrl('<https://example.com/blog|example.com/blog>')).toBe(
      'https://example.com/blog',
    );
  });

  it('rifiuta le stringhe che non sono domini', () => {
    expect(() => resolveStartUrl('non-un-dominio')).toThrow();
    expect(() => resolveStartUrl('')).toThrow();
  });
});
