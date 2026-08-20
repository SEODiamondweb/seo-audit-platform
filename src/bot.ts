import { env, slackIsConfigured } from './config/env';
import { closeBrowser } from './report/pdf';
import { createSlackApp } from './slack/app';
import { logger } from './utils/logger';

/**
 * Il processo del bot vero e proprio: apre la connessione Socket Mode e serve i comandi.
 *
 * Non tenta di riprendersi da solo. Se la connessione cade esce, e il supervisore in index.ts
 * lo rilancia da zero. La ragione e' concreta: quando `@slack/socket-mode` va in errore durante
 * l'handshake, la sua macchina a stati resta inconsistente e `app.stop()` non chiude piu' il
 * websocket. Riavviando nello stesso processo le connessioni si accumulano finche' Slack
 * risponde `too_many_websockets` a ogni tentativo, e il bot non si riprende piu'. Uscire e'
 * l'unico modo per essere certi che il sistema operativo chiuda i socket rimasti aperti.
 */

/** Codice di uscita che segnala al supervisore: rilanciami. */
export const RESTART_EXIT_CODE = 17;

let stopping = false;

async function main(): Promise<void> {
  if (!slackIsConfigured()) {
    logger.error(
      'Token Slack mancanti o non validi. Servono SLACK_BOT_TOKEN (xoxb-…) e SLACK_APP_TOKEN (xapp-…). ' +
        'Copia .env.example in .env e compila i valori. ' +
        'Per provare la pipeline senza Slack: npm run audit -- https://example.com --max 50',
    );
    // Configurazione assente: rilanciare non servirebbe a nulla.
    process.exit(1);
  }

  const app = createSlackApp();

  const fatal = (err: unknown): void => {
    if (stopping) return;
    stopping = true;
    logger.error({ err }, 'Errore fatale nella connessione a Slack, il processo esce per essere rilanciato');
    // Niente app.stop(): dopo un errore della macchina a stati non chiuderebbe comunque il
    // websocket, e attendere ritarderebbe solo il rilascio dei socket da parte del sistema.
    void closeBrowser().finally(() => process.exit(RESTART_EXIT_CODE));
    // Rete di sicurezza: se la chiusura del browser si blocca, si esce lo stesso.
    setTimeout(() => process.exit(RESTART_EXIT_CODE), 5000).unref();
  };

  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Arresto del bot…');
    try {
      await app.stop();
    } catch (err) {
      logger.warn({ err }, 'Arresto dell’app Slack non pulito');
    }
    await closeBrowser();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.start();

  logger.info(
    { command: '/' + env.SLACK_COMMAND, dataDir: env.DATA_DIR, pid: process.pid },
    'Bot avviato in Socket Mode',
  );
}

main().catch(async (err: unknown) => {
  logger.error({ err }, 'Avvio del bot fallito');
  await closeBrowser();
  process.exit(RESTART_EXIT_CODE);
});
