import fs from 'node:fs';
import path from 'node:path';
import { env } from './config/env';
import { logger } from './utils/logger';

const LOCK_FILE = () => path.join(env.DATA_DIR, 'bot.pid');

function isRunning(pid: number): boolean {
  try {
    // Il segnale 0 non fa nulla al processo: serve solo a sapere se esiste.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM significa che il processo esiste ma appartiene a un altro utente.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class AlreadyRunningError extends Error {
  constructor(readonly pid: number) {
    super(
      'Un altro bot è già in esecuzione (PID ' +
        pid +
        '). Slack consente un numero limitato di connessioni Socket Mode per app: ' +
        'avviarne due porta a un disconnect "too_many_websockets" e alla caduta di entrambi. ' +
        'Chiudi l’istanza attiva, oppure terminala con: taskkill /PID ' +
        pid +
        ' /T /F',
    );
    this.name = 'AlreadyRunningError';
  }
}

/**
 * Impedisce che due istanze del bot girino insieme.
 *
 * Non è pignoleria: ogni client Socket Mode apre due connessioni verso Slack, e superato il
 * limite dell'app Slack risponde con "too_many_websockets" durante l'handshake. La libreria
 * non gestisce quel messaggio nello stato di connessione e solleva un'eccezione che uccide il
 * processo — quindi la seconda istanza non si limita a fallire: fa cadere anche la prima.
 *
 * Il caso tipico non è l'utente che lancia due volte il comando, ma un `npm run dev` rimasto
 * vivo in un terminale dimenticato.
 */
export function acquireLock(): () => void {
  const file = LOCK_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);

    if (Number.isFinite(pid) && pid !== process.pid && isRunning(pid)) {
      throw new AlreadyRunningError(pid);
    }
    // Lock orfano: il processo che lo aveva scritto non esiste più.
    logger.warn({ stalePid: raw }, 'Rimosso un lock lasciato da un processo terminato');
  }

  fs.writeFileSync(file, String(process.pid), 'utf8');

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      // Si rimuove solo se il lock è ancora nostro.
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      logger.warn({ err }, 'Rimozione del lock fallita');
    }
  };
}
