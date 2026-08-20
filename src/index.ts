import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { AlreadyRunningError, acquireLock } from './lock';
import { logger } from './utils/logger';

/**
 * Supervisore del bot.
 *
 * Non parla con Slack: si limita a tenere vivo il processo figlio che lo fa. La separazione
 * non e' cerimonia — quando `@slack/socket-mode` va in errore durante l'handshake lascia il
 * websocket aperto e non piu' chiudibile, quindi l'unico riavvio davvero pulito e' quello di
 * un processo nuovo. Un supervisore interno al bot accumulerebbe connessioni a ogni tentativo
 * fino a farsi rifiutare da Slack con `too_many_websockets`.
 *
 * Il lock di istanza singola vive qui, perche' e' questo processo a rappresentare "il bot in
 * esecuzione" attraverso i riavvii del figlio.
 */

/**
 * Dopo questo tempo di funzionamento regolare il conteggio dei tentativi riparte da zero.
 *
 * I limiti sono volutamente generosi: un rifiuto per eccesso di connessioni si risolve solo
 * quando Slack scade le sessioni rimaste aperte, e un bot che si arrende dopo un minuto
 * lascerebbe il comando muto proprio nel caso in cui basterebbe aspettare.
 */
const STABLE_AFTER_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const BASE_BACKOFF_MS = 3000;
const MAX_BACKOFF_MS = 300000;
/** Uscita richiesta esplicitamente dal figlio: vedi RESTART_EXIT_CODE in bot.ts. */
const RESTART_EXIT_CODE = 17;

let child: ChildProcess | null = null;
let shuttingDown = false;

/**
 * Percorso del bot, con la stessa estensione di questo file: bot.ts quando si gira con tsx,
 * bot.js dopo la compilazione.
 */
function botEntryPoint(): string {
  return path.join(__dirname, 'bot' + path.extname(__filename));
}

function spawnBot(): ChildProcess {
  // execArgv porta con se' i flag del runtime attuale, incluso il loader di tsx in sviluppo.
  return spawn(process.execPath, [...process.execArgv, botEntryPoint()], {
    stdio: 'inherit',
    env: process.env,
  });
}

function waitForExit(proc: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    proc.once('exit', (code, signal) => resolve({ code, signal }));
    proc.once('error', (err) => {
      logger.error({ err }, 'Impossibile avviare il processo del bot');
      resolve({ code: 1, signal: null });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function supervise(): Promise<number> {
  let attempt = 0;

  for (;;) {
    const startedAt = Date.now();
    child = spawnBot();
    const { code, signal } = await waitForExit(child);
    child = null;

    if (shuttingDown) return 0;

    // Uscita pulita del figlio: non c'e' nulla da rilanciare.
    if (code === 0) {
      logger.info('Il bot è uscito senza errori, il supervisore termina');
      return 0;
    }

    // Configurazione mancante o non valida: rilanciare non cambierebbe l'esito.
    if (code === 1) {
      logger.error('Il bot non è avviabile con la configurazione attuale, il supervisore termina');
      return 1;
    }

    if (Date.now() - startedAt > STABLE_AFTER_MS) attempt = 0;
    attempt += 1;

    if (attempt > MAX_ATTEMPTS) {
      logger.error(
        { attempts: attempt },
        'Il bot non riesce a restare connesso: il supervisore esce e lascia il rilancio a Docker o all’Utilità di pianificazione',
      );
      return 1;
    }

    const wait = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    logger.warn(
      { code, signal, attempt, waitMs: wait, expected: code === RESTART_EXIT_CODE },
      'Il bot si è fermato, verrà rilanciato dopo l’attesa indicata',
    );
    await sleep(wait);
  }
}

async function main(): Promise<void> {
  let releaseLock: () => void;
  try {
    releaseLock = acquireLock();
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      logger.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Arresto in corso…');
    // Il figlio chiude da solo la connessione e il browser headless.
    child?.kill(signal);
    setTimeout(() => {
      child?.kill('SIGKILL');
      releaseLock();
      process.exit(0);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info({ pid: process.pid }, 'Supervisore avviato');

  const exitCode = await supervise();
  releaseLock();
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Supervisore terminato con un errore');
  process.exit(1);
});
