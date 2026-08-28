import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../utils/logger';

/**
 * Montserrat incorporato nel report.
 *
 * Il font viene letto dal disco e inserito nell'HTML come data URI, non richiamato da Google
 * Fonts: al momento del rendering Chromium non deve dipendere dalla rete, che in un container
 * o su una macchina offline non c'è. Un PDF con i caratteri sbagliati è un PDF da rifare.
 *
 * È un font variabile: un unico file copre tutti i pesi da 100 a 900, quindi si dichiara un
 * solo @font-face con un intervallo di peso invece di quattro file distinti.
 *
 * Licenza SIL Open Font License 1.1 (assets/fonts/OFL.txt), che ne consente esplicitamente
 * l'incorporamento nei documenti.
 */

const FONT_FILE = 'montserrat-variable.woff2';

/** Letto una volta sola: il file non cambia durante l'esecuzione. */
let cached: string | null = null;

function fontPath(): string {
  // In sviluppo si esegue da src/, in produzione da dist/: assets sta accanto a entrambe.
  return path.join(__dirname, '..', '..', 'assets', 'fonts', FONT_FILE);
}

/**
 * Il blocco @font-face con il font incorporato.
 * Se il file manca, il report si genera comunque con i font di sistema: manca lo stile,
 * non il contenuto.
 */
export async function montserratFontFace(): Promise<string> {
  if (cached !== null) return cached;

  try {
    const buffer = await fs.readFile(fontPath());
    cached = `@font-face {
    font-family: 'Montserrat';
    font-style: normal;
    font-weight: 100 900;
    font-display: block;
    src: url(data:font/woff2;base64,${buffer.toString('base64')}) format('woff2');
  }`;
  } catch (err) {
    logger.warn(
      { err, path: fontPath() },
      'Font Montserrat non trovato: il report userà i font di sistema',
    );
    cached = '';
  }

  return cached;
}
