import { createSign } from 'node:crypto';
import fs from 'node:fs/promises';
import { env } from '../config/env';

/**
 * Autenticazione a Google con un service account, senza dipendenze esterne.
 *
 * Il flusso è quello standard OAuth2 per server: si firma un JWT con la chiave privata del
 * service account e lo si scambia per un access token. Il service account va aggiunto come
 * utente (con permesso completo o limitato) nella proprietà Search Console: da quel momento
 * l'API risponde come risponderebbe a quell'utente.
 *
 * La chiave JSON si scarica da Google Cloud Console e il suo percorso va in
 * GSC_CREDENTIALS_PATH. Non va mai committata: contiene una chiave privata.
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export async function loadServiceAccount(): Promise<ServiceAccountKey | null> {
  if (!env.GSC_CREDENTIALS_PATH) return null;
  try {
    const raw = await fs.readFile(env.GSC_CREDENTIALS_PATH, 'utf8');
    const key = JSON.parse(raw) as Partial<ServiceAccountKey>;
    if (!key.client_email || !key.private_key) return null;
    return key as ServiceAccountKey;
  } catch {
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.value;
  }

  const account = await loadServiceAccount();
  if (!account) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign('RSA-SHA256');
  signer.update(header + '.' + claims);
  const signature = signer.sign(account.private_key).toString('base64url');
  const assertion = header + '.' + claims + '.' + signature;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('Autenticazione Google fallita: HTTP ' + response.status + ' ' + body.slice(0, 200));
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Google non ha restituito un access token');

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}
