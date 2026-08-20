import type { CrawlConfig } from '../crawler/types';

export interface ParsedCommand {
  kind: 'audit' | 'help';
  url: string;
  overrides: Partial<Omit<CrawlConfig, 'startUrl'>>;
  warnings: string[];
}

export class CommandError extends Error {}

/** Tokenizza rispettando le virgolette singole e doppie. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function readInt(name: string, value: string | undefined, min: number, max: number): number {
  if (value === undefined) throw new CommandError('L’opzione --' + name + ' richiede un valore numerico.');
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new CommandError('Valore non numerico per --' + name + ': "' + value + '".');
  }
  if (parsed < min || parsed > max) {
    throw new CommandError(
      'Valore fuori intervallo per --' + name + ': ammessi da ' + min + ' a ' + max + '.',
    );
  }
  return parsed;
}

const USER_AGENT_PRESETS: Record<string, string> = {
  googlebot:
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'googlebot-mobile':
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
};

/**
 * Interpreta il testo del comando slash.
 *
 * Esempi:
 *   example.com
 *   https://example.com --max 300 --depth 4
 *   example.com --subdomains --no-robots --ua googlebot --exclude "\\?s="
 */
export function parseCommand(text: string): ParsedCommand {
  const tokens = tokenize(text ?? '');
  const warnings: string[] = [];
  const overrides: Partial<Omit<CrawlConfig, 'startUrl'>> = {};

  if (tokens.length === 0 || tokens[0] === 'help' || tokens[0] === '--help' || tokens[0] === '-h') {
    return { kind: 'help', url: '', overrides, warnings };
  }

  const url = tokens[0] as string;
  if (url.startsWith('-')) {
    throw new CommandError('Il primo argomento deve essere il dominio da analizzare.');
  }

  const include: string[] = [];
  const exclude: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const next = tokens[i + 1];

    switch (token) {
      case '--max':
      case '--limit':
        overrides.maxUrls = readInt('max', next, 1, 20000);
        i++;
        break;

      case '--depth':
        overrides.maxDepth = readInt('depth', next, 0, 50);
        i++;
        break;

      case '--delay':
        overrides.delayMs = readInt('delay', next, 0, 60000);
        i++;
        break;

      case '--concurrency':
        overrides.concurrency = readInt('concurrency', next, 1, 32);
        i++;
        break;

      case '--timeout':
        overrides.timeoutMs = readInt('timeout', next, 1000, 120000);
        i++;
        break;

      case '--subdomains':
        overrides.includeSubdomains = true;
        break;

      case '--no-robots':
        overrides.respectRobots = false;
        warnings.push(
          'Il robots.txt verrà ignorato: usa questa opzione solo su siti di cui hai il controllo.',
        );
        break;

      case '--ua':
      case '--user-agent': {
        if (next === undefined) throw new CommandError('L’opzione --ua richiede un valore.');
        overrides.userAgent = USER_AGENT_PRESETS[next.toLowerCase()] ?? next;
        i++;
        break;
      }

      case '--include':
        if (next === undefined) throw new CommandError('L’opzione --include richiede una regex.');
        include.push(next);
        i++;
        break;

      case '--exclude':
        if (next === undefined) throw new CommandError('L’opzione --exclude richiede una regex.');
        exclude.push(next);
        i++;
        break;

      case '--sitemap':
        if (next === undefined) throw new CommandError('L’opzione --sitemap richiede una URL.');
        overrides.sitemapUrl = next;
        i++;
        break;

      default:
        if (token.startsWith('-')) {
          throw new CommandError(
            'Opzione non riconosciuta: ' + token + '. Usa `help` per l’elenco completo.',
          );
        }
        warnings.push('Argomento ignorato: ' + token);
        break;
    }
  }

  if (include.length > 0) overrides.include = include;
  if (exclude.length > 0) overrides.exclude = exclude;

  return { kind: 'audit', url, overrides, warnings };
}

export const HELP_TEXT = [
  '*SEO Audit — guida rapida*',
  '',
  '`/COMMAND example.com` avvia la scansione e restituisce il PDF nel canale.',
  '',
  '*Opzioni*',
  '• `--max N` numero massimo di URL da scansionare (default da configurazione)',
  '• `--depth N` profondità massima di click dalla home',
  '• `--delay N` pausa in ms fra un blocco di richieste e il successivo',
  '• `--concurrency N` richieste parallele (1-32)',
  '• `--timeout N` timeout per richiesta in ms',
  '• `--subdomains` include i sottodomini nel perimetro',
  '• `--no-robots` ignora il robots.txt (solo su siti propri)',
  '• `--ua googlebot|googlebot-mobile|chrome|bingbot|<stringa>` user agent',
  '• `--include <regex>` scansiona solo le URL che corrispondono',
  '• `--exclude <regex>` esclude le URL che corrispondono',
  '• `--sitemap <url>` indica esplicitamente la sitemap da usare',
  '',
  '*Esempi*',
  '`/COMMAND miosito.it --max 300 --depth 4`',
  '`/COMMAND miosito.it --include "/blog" --exclude "\\?s="`',
  '`/COMMAND miosito.it --subdomains --ua googlebot`',
].join('\n');
