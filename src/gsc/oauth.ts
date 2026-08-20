import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { env } from '../config/env';

/**
 * Autorizzazione dei tuoi account Google con OAuth.
 *
 * A differenza del service account, qui non si crea nessuna identità nuova: si autorizza il
 * bot ad agire per conto di un account che già esiste. Il bot vede esattamente le proprietà
 * che vede quell'account, senza doverle aggiungere una per una.
 *
 * Il flusso è quello per applicazioni installate: si apre il browser, l'utente acconsente, e
 * Google rimanda un codice su un server locale temporaneo. Il codice si scambia per un
 * refresh token, che viene conservato e riusato.
 *
 * Si usa PKCE (RFC 7636) perché nelle app installate il client secret non è un segreto: chi
 * ha il binario ce l'ha. PKCE lega il codice a questa specifica sessione, rendendo inutile
 * intercettarlo.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** L'accesso a Search Console è in sola lettura; l'email serve solo a etichettare l'account. */
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export function oauthIsConfigured(): boolean {
  return env.GOOGLE_OAUTH_CLIENT_ID !== '' && env.GOOGLE_OAUTH_CLIENT_SECRET !== '';
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/** Apre il browser predefinito; se fallisce non è grave, la URL viene comunque stampata. */
function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* la URL è stampata a video: l'utente può aprirla a mano */
  }
}

const DONE_PAGE = (title: string, message: string): string =>
  `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}
div{text-align:center;max-width:30rem;padding:2rem}h1{font-size:1.4rem;margin:0 0 .6rem}
p{color:#94a3b8;line-height:1.6}</style></head>
<body><div><h1>${title}</h1><p>${message}</p></div></body></html>`;

interface AuthCodeResult {
  code: string;
  redirectUri: string;
  verifier: string;
}

/**
 * Avvia un server locale, apre il browser e attende il codice di autorizzazione.
 * Il server accetta una sola richiesta utile e poi si chiude.
 */
function awaitAuthorizationCode(timeoutMs: number): Promise<AuthCodeResult> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  return new Promise<AuthCodeResult>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      const finish = (status: number, page: string, err?: Error, value?: AuthCodeResult): void => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(page);
        server.close();
        clearTimeout(timer);
        if (err) reject(err);
        else if (value) resolve(value);
      };

      if (error) {
        finish(
          400,
          DONE_PAGE('Autorizzazione negata', 'Puoi chiudere questa scheda e riprovare.'),
          new Error('Autorizzazione negata: ' + error),
        );
        return;
      }
      // Lo state lega la risposta alla richiesta che abbiamo avviato noi.
      if (!code || returnedState !== state) {
        finish(
          400,
          DONE_PAGE('Risposta non valida', 'Riprova lanciando di nuovo il comando.'),
          new Error('Risposta OAuth non valida (state non corrispondente)'),
        );
        return;
      }

      const address = server.address() as AddressInfo;
      finish(
        200,
        DONE_PAGE('Account collegato', 'Puoi chiudere questa scheda e tornare al terminale.'),
        undefined,
        { code, verifier, redirectUri: 'http://127.0.0.1:' + address.port },
      );
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Tempo scaduto: nessuna risposta dal browser entro ' + Math.round(timeoutMs / 1000) + 's'));
    }, timeoutMs);

    server.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // Porta effimera: Google accetta qualunque porta su 127.0.0.1 per i client "Desktop".
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const redirectUri = 'http://127.0.0.1:' + port;

      const params = new URLSearchParams({
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        // offline + consent: garantiscono che Google restituisca un refresh token anche
        // quando l'account ha già autorizzato l'app in passato.
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });

      const authUrl = AUTH_ENDPOINT + '?' + params.toString();
      process.stdout.write(
        '\n  Si apre il browser per l’autorizzazione. Se non si apre, incolla questa URL:\n\n  ' +
          authUrl +
          '\n\n  In attesa…\n',
      );
      openBrowser(authUrl);
    });
  });
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function exchange(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = (await response.json()) as TokenResponse;
  if (!response.ok) {
    throw new Error(
      'Google ha rifiutato la richiesta: ' +
        (json.error_description ?? json.error ?? 'HTTP ' + response.status),
    );
  }
  return json;
}

export interface AuthorizedAccount {
  email: string;
  refreshToken: string;
}

/** Esegue l'intero flusso interattivo e restituisce il refresh token dell'account. */
export async function authorizeAccount(timeoutMs = 300000): Promise<AuthorizedAccount> {
  const { code, verifier, redirectUri } = await awaitAuthorizationCode(timeoutMs);

  const tokens = await exchange({
    code,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });

  if (!tokens.refresh_token) {
    throw new Error(
      'Google non ha restituito un refresh token. Revoca l’accesso dell’app su ' +
        'https://myaccount.google.com/permissions e rifai il login.',
    );
  }
  if (!tokens.access_token) throw new Error('Google non ha restituito un access token');

  const userinfo = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: 'Bearer ' + tokens.access_token },
  });
  const profile = (await userinfo.json()) as { email?: string };

  return {
    email: profile.email ?? 'account-senza-email',
    refreshToken: tokens.refresh_token,
  };
}

export class RevokedAccountError extends Error {
  constructor(readonly email: string) {
    super(
      'L’autorizzazione di ' +
        email +
        ' non è più valida (revocata, scaduta, o password cambiata). ' +
        'Rifai il login con: npm run gsc:login',
    );
    this.name = 'RevokedAccountError';
  }
}

/** Scambia il refresh token per un access token. */
export async function refreshAccessToken(
  email: string,
  refreshToken: string,
): Promise<{ value: string; ttl: number }> {
  try {
    const tokens = await exchange({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    if (!tokens.access_token) throw new Error('Google non ha restituito un access token');
    return { value: tokens.access_token, ttl: tokens.expires_in ?? 3600 };
  } catch (err) {
    // invalid_grant è la risposta di Google a un refresh token non più valido: va tradotta
    // in un messaggio che dice cosa fare, non lasciata passare come errore generico.
    if (err instanceof Error && /invalid_grant/i.test(err.message)) {
      throw new RevokedAccountError(email);
    }
    throw err;
  }
}

export async function revokeToken(refreshToken: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => undefined);
}
