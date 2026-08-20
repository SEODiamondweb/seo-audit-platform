import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlreadyRunningError, acquireLock, lockFile } from '../src/lock';

// Directory isolata: usare quella reale significherebbe litigare con il bot in esecuzione,
// e nel peggiore dei casi cancellargli il lock.
let dir: string;
let LOCK: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-audit-lock-'));
  LOCK = lockFile(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('lock di istanza singola', () => {
  it('scrive il proprio PID e lo rimuove al rilascio', () => {
    const release = acquireLock(dir);
    expect(fs.readFileSync(LOCK, 'utf8')).toBe(String(process.pid));
    release();
    expect(fs.existsSync(LOCK)).toBe(false);
  });

  it('è idempotente sul rilascio', () => {
    const release = acquireLock(dir);
    release();
    expect(() => release()).not.toThrow();
  });

  it('rifiuta l’avvio se un altro processo vivo detiene il lock', () => {
    // Serve un PID certamente attivo e diverso dal nostro: il processo padre lo è per
    // definizione finché questo test gira. Su Windows il PID 1 non esiste.
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    fs.writeFileSync(LOCK, String(process.ppid), 'utf8');

    expect(() => acquireLock(dir)).toThrow(AlreadyRunningError);
  });

  it('recupera un lock lasciato da un processo terminato', () => {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    // PID irrealistico: nessun processo può averlo.
    fs.writeFileSync(LOCK, '4294967000', 'utf8');

    const release = acquireLock(dir);
    expect(fs.readFileSync(LOCK, 'utf8')).toBe(String(process.pid));
    release();
  });

  it('ignora un lock con contenuto non numerico', () => {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    fs.writeFileSync(LOCK, 'non-un-pid', 'utf8');

    const release = acquireLock(dir);
    expect(fs.readFileSync(LOCK, 'utf8')).toBe(String(process.pid));
    release();
  });
});
