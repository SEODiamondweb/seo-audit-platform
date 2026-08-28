import { describe, expect, it } from 'vitest';
import { buildAuthUrl } from '../src/gsc/oauth';

/**
 * La URL di autorizzazione è arrivata a Google troncata al primo parametro, perché veniva
 * aperta con `cmd /c start` e cmd tratta la & come separatore di comandi. Questi test
 * fissano il contratto: tutti i parametri devono esserci, e la URL deve restare valida.
 */
describe('URL di autorizzazione OAuth', () => {
  const url = buildAuthUrl({
    redirectUri: 'http://127.0.0.1:52341',
    state: 'stato-casuale',
    challenge: 'challenge-pkce',
  });
  const params = new URL(url).searchParams;

  it('contiene tutti i parametri richiesti da Google', () => {
    // response_type è quello la cui assenza produce "Required parameter is missing".
    for (const key of ['client_id', 'redirect_uri', 'response_type', 'scope', 'state']) {
      expect(params.get(key), 'manca ' + key).not.toBeNull();
    }
    expect(params.get('response_type')).toBe('code');
  });

  it('chiede un refresh token, non solo un accesso temporaneo', () => {
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
  });

  it('usa PKCE con SHA-256', () => {
    expect(params.get('code_challenge')).toBe('challenge-pkce');
    expect(params.get('code_challenge_method')).toBe('S256');
  });

  it('chiede Search Console in sola lettura', () => {
    expect(params.get('scope')).toContain('webmasters.readonly');
    expect(params.get('scope')).not.toContain('/auth/webmasters ');
  });

  it('punta al server locale che attende il codice', () => {
    expect(params.get('redirect_uri')).toBe('http://127.0.0.1:52341');
  });

  it('è una URL valida verso l’endpoint di Google', () => {
    expect(new URL(url).origin).toBe('https://accounts.google.com');
  });
});
