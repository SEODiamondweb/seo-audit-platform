import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AlreadyRunningError, acquireLock } from '../src/lock';
import { env } from '../src/config/env';

const LOCK = path.join(env.DATA_DIR, 'bot.pid');

function removeLock(): void {
  try {
    fs.unlinkSync(LOCK);
  } catch {
    /* già assente */
  }
}

afterEach(removeLock);

describe('lock di istanza singola', () => {
  it('scrive il proprio PID e lo rimuove al rilascio', () => {
    const release = acquireLock();
    expect(fs.readFileSync(LOCK, 'utf8')).toBe(String(process.pid));
    release();
    expect(fs.existsSync(LOCK)).toBe(false);
  });

  it('è idempotente sul rilascio', () => {
    const release = acquireLock();
    release();
    expect(() => release()).not.toThrow();
  });

  it('rifiuta l’avvio se un altro processo vivo detiene il lock', () => {
    // Serve un PID certamente attivo e diverso dal nostro: il processo padre lo è per
    // definizione finché questo test gira. Su Windows il PID 1 non esiste.
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    fs.writeFileSync(LOCK, String(process.ppid), 'utf8');

    expect(() => acquireLock()).toThrow(AlreadyRunningError);
  });

  it('recupera un lock lasciato da un processo terminato', () => {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    // PID irrealistico: nessun processo può averlo.
    fs.writeFileSync(LOCK, '4294967000', 'utf8');

    const release = acquireLock();
    expect(fs.readFileSync(LOCK, 'utf8')).toBe(String(process.pid));
    release();
  });

  it('ignora un lock con contenuto non numerico', () => {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    fs.writeFileSync(LOCK, 'non-un-pid', 'utf8');

    const release = acquireLock();
    expect(fs.readFileSync(LOCK, 'utf8')).toBe(String(process.pid));
    release();
  });
});
