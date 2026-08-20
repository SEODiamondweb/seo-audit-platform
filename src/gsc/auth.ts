import { createSign } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

/**
 * Autenticazione a Google con service account, senza dipendenze esterne.
 *
 * Il flusso è quello standard OAuth2 per server: si firma un JWT con la chiave privata del
 * service account e lo si scambia per un access token.
 *
 * Sul perché una chiave basta anche con più account Search Console: in Search Console non si
 * collega un account, si autorizza un'identità su una proprietà. Il service account è
 * un'identità come un'altra — la si aggiunge come utente alle proprietà che stanno sotto
 * account diversi, ed è la stessa chiave a vederle tutte.
 *
 * Restano utili più chiavi in un caso: quando un cliente preferisce fornire il proprio
 * service account invece di aggiungere il nostro. Per questo GSC_CREDENTIALS_PATH accetta
 * più percorsi separati da punto e virgola.
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface GscAccount {
  /** Percorso del file chiave: identifica l'origine nei messaggi diagnostici. */
  keyPath: string;
  /** Email del service account. È questa che va aggiunta come utente alle proprietà. */
  email: string;
  getAccessToken(): Promise<string>;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** Un access token per service account, riusato finché non sta per scadere. */
const tokenCache = new Map<string, { value: string; expiresAt: number }>();

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** I percorsi configurati, separati da punto e virgola (Windows) o virgola. */
export function credentialPaths(): string[] {
  return env.GSC_CREDENTIALS_PATH.split(/[;,]/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

async function requestAccessToken(key: ServiceAccountKey): Promise<{ value: string; ttl: number }> {
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
      'Autenticazione Google fallita per ' +
        key.client_email +
        ': HTTP ' +
        response.status +
        ' ' +
        body.slice(0, 200),
    );
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Google non ha restituito un access token');
  return { value: json.access_token, ttl: json.expires_in ?? 3600 };
}

export interface KeyLoadError {
  keyPath: string;
  reason: string;
}

export interface LoadedAccounts {
  accounts: GscAccount[];
  errors: KeyLoadError[];
}

/**
 * Carica tutte le chiavi configurate. Una chiave illeggibile non impedisce alle altre di
 * funzionare: viene riportata fra gli errori, così il report può dirlo invece di tacere.
 */
export async function loadAccounts(): Promise<LoadedAccounts> {
  const accounts: GscAccount[] = [];
  const errors: KeyLoadError[] = [];

  for (const keyPath of credentialPaths()) {
    let key: ServiceAccountKey;
    try {
      const raw = await fs.readFile(path.resolve(keyPath), 'utf8');
      const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
      if (!parsed.client_email || !parsed.private_key) {
        errors.push({
          keyPath,
          reason: 'il file non contiene client_email e private_key: non è una chiave di service account',
        });
        continue;
      }
      key = parsed as ServiceAccountKey;
    } catch (err) {
      errors.push({
        keyPath,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    accounts.push({
      keyPath,
      email: key.client_email,
      async getAccessToken(): Promise<string> {
        const cached = tokenCache.get(key.client_email);
        if (cached && cached.expiresAt > Date.now() + 60000) return cached.value;

        const { value, ttl } = await requestAccessToken(key);
        tokenCache.set(key.client_email, { value, expiresAt: Date.now() + ttl * 1000 });
        return value;
      },
    });
  }

  return { accounts, errors };
}
