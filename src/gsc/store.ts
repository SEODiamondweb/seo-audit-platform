import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

/**
 * Archivio delle autorizzazioni OAuth degli account Google.
 *
 * Contiene i refresh token, che sono credenziali a tutti gli effetti: chi li possiede può
 * leggere i dati Search Console degli account autorizzati finché l'autorizzazione non viene
 * revocata. Il file sta in DATA_DIR, che è escluso da git.
 *
 * Per revocare: https://myaccount.google.com/permissions con l'account interessato,
 * oppure `npm run gsc:logout -- email@esempio.it`.
 */

export interface StoredAccount {
  email: string;
  refreshToken: string;
  addedAt: string;
}

interface StoreFile {
  accounts: StoredAccount[];
}

function storePath(): string {
  return path.join(env.DATA_DIR, 'gsc-accounts.json');
}

export async function loadStore(): Promise<StoredAccount[]> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    return [];
  }
}

async function saveStore(accounts: StoredAccount[]): Promise<void> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ accounts }, null, 2), 'utf8');
  // Su sistemi POSIX si restringono i permessi al solo proprietario; su Windows la chmod
  // non ha effetto, ma il file resta comunque nel profilo utente.
  await fs.chmod(file, 0o600).catch(() => undefined);
}

/** Aggiunge o aggiorna un account: rifare il login su un account già presente lo sostituisce. */
export async function upsertAccount(account: StoredAccount): Promise<{ replaced: boolean }> {
  const accounts = await loadStore();
  const index = accounts.findIndex((a) => a.email.toLowerCase() === account.email.toLowerCase());

  if (index >= 0) {
    accounts[index] = account;
    await saveStore(accounts);
    return { replaced: true };
  }

  accounts.push(account);
  await saveStore(accounts);
  return { replaced: false };
}

export async function removeAccount(email: string): Promise<boolean> {
  const accounts = await loadStore();
  const remaining = accounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
  if (remaining.length === accounts.length) return false;
  await saveStore(remaining);
  return true;
}

export function storeLocation(): string {
  return storePath();
}
