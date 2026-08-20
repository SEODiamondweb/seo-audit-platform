import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        executablePath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
      })
      .catch((err: unknown) => {
        browserPromise = null;
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          'Impossibile avviare Chromium per la generazione del PDF. ' +
            'Verifica che Chromium sia installato e che PUPPETEER_EXECUTABLE_PATH sia corretto. ' +
            'Dettaglio: ' +
            message,
        );
      });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (err) {
    logger.warn({ err }, 'Chiusura del browser fallita');
  } finally {
    browserPromise = null;
  }
}

export interface PdfOptions {
  /** Testo mostrato nel piè di pagina, a sinistra. */
  footerLeft: string;
}

/**
 * Renderizza l’HTML del report in un PDF A4 con numerazione di pagina.
 * Il PDF viene scritto su `outputPath` e il buffer restituito al chiamante.
 */
export async function renderPdf(
  html: string,
  outputPath: string,
  options: PdfOptions,
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
    await page.emulateMediaType('print');

    const footer = `
      <div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7pt;color:#94a3b8;
                  padding:0 14mm;display:flex;justify-content:space-between;">
        <span>${escapeForTemplate(options.footerLeft)}</span>
        <span>Pagina <span class="pageNumber"></span> di <span class="totalPages"></span></span>
      </div>`;

    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: footer,
      margin: { top: '18mm', right: '14mm', bottom: '20mm', left: '14mm' },
      timeout: 120000,
    });

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const nodeBuffer = Buffer.from(buffer);
    await fs.writeFile(outputPath, nodeBuffer);
    return nodeBuffer;
  } finally {
    await page.close().catch(() => undefined);
  }
}

function escapeForTemplate(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
