import 'dotenv/config';
import { z } from 'zod';
import path from 'node:path';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v)));

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max));

/**
 * Stringa con default, dove il valore vuoto equivale a "non impostato".
 *
 * Serve perché dotenv restituisce '' in casi legittimi e poco evidenti: riga presente ma
 * senza valore, oppure valore non virgolettato che inizia con '#', che dotenv interpreta
 * come commento. È il caso di `REPORT_BRAND_COLOR=#1d4ed8`, che va scritto fra virgolette.
 */
const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : v.trim()));

const schema = z.object({
  SLACK_BOT_TOKEN: z.string().optional().default(''),
  SLACK_APP_TOKEN: z.string().optional().default(''),
  SLACK_SIGNING_SECRET: z.string().optional().default(''),
  SLACK_COMMAND: str('seo-audit'),

  CRAWL_MAX_URLS: int(500, 1, 20000),
  CRAWL_MAX_DEPTH: int(10, 0, 50),
  CRAWL_CONCURRENCY: int(5, 1, 32),
  CRAWL_DELAY_MS: int(200, 0, 60000),
  CRAWL_TIMEOUT_MS: int(15000, 1000, 120000),
  CRAWL_RESPECT_ROBOTS: bool(true),
  CRAWL_INCLUDE_SUBDOMAINS: bool(false),
  CRAWL_USER_AGENT: str('SlackSeoAudit/1.0 (+https://example.com/bot)'),

  JOB_TIMEOUT_MS: int(900000, 30000, 7200000),
  JOB_CONCURRENCY: int(2, 1, 8),

  // PageSpeed Insights: fonte dei dati di velocità. Funziona anche senza chiave per
  // volumi bassi; la chiave (gratuita, da Google Cloud Console) evita il rate limiting.
  PAGESPEED_ENABLED: bool(true),
  PAGESPEED_API_KEY: z.string().optional().default(''),
  PAGESPEED_TIMEOUT_MS: int(60000, 10000, 120000),

  // Percorso della chiave JSON del service account Google, per Search Console.
  // Vuoto = integrazione disattivata. La chiave non va mai committata.
  GSC_CREDENTIALS_PATH: z.string().optional().default(''),

  // Client OAuth (tipo 'Applicazione desktop') per autorizzare i propri account Google.
  // Il client secret di un'app installata non e un vero segreto: chi ha il programma lo ha.
  // La sicurezza del flusso poggia su PKCE, non su di esso.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional().default(''),

  REPORT_BRAND_NAME: str('SEO Audit'),
  REPORT_BRAND_COLOR: str('#1d4ed8').refine(
    (v) => /^#[0-9a-fA-F]{6}$/.test(v),
    'REPORT_BRAND_COLOR deve essere un HEX a 6 cifre. Nel .env va virgolettato ' +
      '(REPORT_BRAND_COLOR="#1d4ed8"): senza virgolette dotenv legge il # come commento.',
  ),
  REPORT_LOGO_PATH: z.string().optional().default(''),
  DATA_DIR: str('./data'),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional().default(''),

  LOG_LEVEL: str('info'),
  NODE_ENV: str('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Configurazione non valida (.env):\n${details}`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  DATA_DIR: path.resolve(process.cwd(), raw.DATA_DIR),
};

export type Env = typeof env;

/** Il bot può collegarsi a Slack solo se ha entrambi i token del Socket Mode. */
export function slackIsConfigured(): boolean {
  return env.SLACK_BOT_TOKEN.startsWith('xoxb-') && env.SLACK_APP_TOKEN.startsWith('xapp-');
}
