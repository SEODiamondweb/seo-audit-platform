import { createSign } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { refreshAccessToken } from './oauth';
import { loadStore } from './store';

/**
 * Le identità con cui il bot parla a Search Console.
 *
 * Due modi, dietro la stessa interfaccia:
 *
 *  - **OAuth** (`npm run gsc:login`): si autorizza un account Google che già esiste — il tuo.
 *    Il bot vede esattamente le proprietà che vedi tu, senza aggiungere utenti da nessuna
 *    parte. È il modo naturale quando gli account sono propri.
 *
 *  - **Service account**: un'identità robot creata su Google Cloud, che va aggiunta come
 *    utente a ogni proprietà. Utile quando il proprietario è un cliente che preferisce
 *    autorizzare un'identità dedicata anziché legare l'accesso a una persona.
 *
 * I due modi convivono: le proprietà raggiungibili si sommano.
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export type AccountKind = 'oauth' | 'service-account';

export interface GscAccount {
  kind: AccountKind;
  /** Email dell'account Google (OAuth) o del service account. */
  email: string;
  /** Origine leggibile, per i messaggi diagnostici. */
  source: string;
  getAccessToken(): Promise<string>;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** Un access token per identità, riusato finché non sta per scadere. */
const tokenCache = new Map<string, { value: string; expiresAt: number }>();

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Riusa il token in cache o ne richiede uno nuovo. */
async function cachedToken(
  key: string,
  request: () => Promise<{ value: string; ttl: number }>,
): Promise<string> {
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.value;

  const { value, ttl } = await request();
  tokenCache.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  return value;
}

// ── Service account ──────────────────────────────────────────────────────────

/** I percorsi delle chiavi, separati da punto e virgola (Windows) o virgola. */
export function credentialPaths(): string[] {
  return env.GSC_CREDENTIALS_PATH.split(/[;,]/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

async function requestServiceAccountToken(
  key: ServiceAccountKey,
): Promise<{ value: string; ttl: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign('RSA-SHA256');
  signer.update(header + '.' + claims);
  const signature = signer.sign(key.private_key).toString('base64url');

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: header + '.' + claims + '.' + signature,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      'Autenticazione fallita per ' + key.client_email + ': HTTP ' + response.status + ' ' + body.slice(0, 200),
    );
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Google non ha restituito un access token');
  return { value: json.access_token, ttl: json.expires_in ?? 3600 };
}

// ── Caricamento ──────────────────────────────────────────────────────────────

export interface AccountLoadError {
  source: string;
  reason: string;
}

export interface LoadedAccounts {
  accounts: GscAccount[];
  errors: AccountLoadError[];
}

/**
 * Carica tutte le identità disponibili: prima gli account autorizzati via OAuth, poi le
 * eventuali chiavi di service account. Un'origine difettosa non impedisce alle altre di
 * funzionare: viene riportata con il motivo, così il report può dirlo invece di tacere.
 */
export async function loadAccounts(): Promise<LoadedAccounts> {
  const accounts: GscAccount[] = [];
  const errors: AccountLoadError[] = [];

  for (const stored of await loadStore()) {
    accounts.push({
      kind: 'oauth',
      email: stored.email,
      source: 'account Google autorizzato il ' + stored.addedAt.slice(0, 10),
      getAccessToken: () =>
        cachedToken('oauth:' + stored.email, () =>
          refreshAccessToken(stored.email, stored.refreshToken),
        ),
    });
  }

  for (const keyPath of credentialPaths()) {
    let key: ServiceAccountKey;
    try {
      const raw = await fs.readFile(path.resolve(keyPath), 'utf8');
      const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
      if (!parsed.client_email || !parsed.private_key) {
        errors.push({
          source: keyPath,
          reason: 'il file non contiene client_email e private_key: non è una chiave di service account',
        });
        continue;
      }
      key = parsed as ServiceAccountKey;
    } catch (err) {
      errors.push({ source: keyPath, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }

    accounts.push({
      kind: 'service-account',
      email: key.client_email,
      source: keyPath,
      getAccessToken: () =>
        cachedToken('sa:' + key.client_email, () => requestServiceAccountToken(key)),
    });
  }

  return { accounts, errors };
}

/** True se esiste almeno un modo di parlare con Search Console. */
export async function hasAnyAccount(): Promise<boolean> {
  if (credentialPaths().length > 0) return true;
  return (await loadStore()).length > 0;
}
