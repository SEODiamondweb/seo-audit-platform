import { listProperties } from './gsc/client';
import { authorizeAccount, oauthIsConfigured, revokeToken } from './gsc/oauth';
import { loadStore, removeAccount, storeLocation, upsertAccount } from './gsc/store';
import { loadAccounts } from './gsc/auth';

/**
 * Collega un account Google a Search Console.
 *
 *   npm run gsc:login                 autorizza un account (ripetibile per ognuno)
 *   npm run gsc:login -- --list       elenca gli account collegati
 *   npm run gsc:login -- --remove x@y scollega un account e revoca l'autorizzazione
 */

function fail(message: string): never {
  process.stderr.write('\n  ' + message + '\n\n');
  process.exit(1);
}

async function list(): Promise<void> {
  const stored = await loadStore();
  process.stdout.write('\n  Account Google collegati\n  ' + '─'.repeat(46) + '\n\n');

  if (stored.length === 0) {
    process.stdout.write('  Nessuno. Collega il primo con: npm run gsc:login\n\n');
    return;
  }

  for (const account of stored) {
    process.stdout.write('  • ' + account.email + '   (dal ' + account.addedAt.slice(0, 10) + ')\n');
  }
  process.stdout.write('\n  Archivio: ' + storeLocation() + '\n');
  process.stdout.write('  Verifica quali proprietà coprono: npm run gsc\n\n');
}

async function remove(email: string): Promise<void> {
  const stored = await loadStore();
  const account = stored.find((a) => a.email.toLowerCase() === email.toLowerCase());
  if (!account) fail('Nessun account collegato con l’email ' + email);

  // Prima si revoca lato Google, poi si dimentica: l'ordine inverso lascerebbe
  // un'autorizzazione attiva che nessuno ricorda di avere concesso.
  await revokeToken(account.refreshToken);
  await removeAccount(email);
  process.stdout.write('\n  ' + email + ' scollegato e autorizzazione revocata.\n\n');
}

async function login(): Promise<void> {
  if (!oauthIsConfigured()) {
    fail(
      'Client OAuth non configurato.\n\n' +
        '  Servono GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET nel file .env.\n' +
        '  Si ottengono creando un client OAuth di tipo "Applicazione desktop" su\n' +
        '  Google Cloud Console. La procedura completa è nel README, sezione\n' +
        '  "Collegare i tuoi account Search Console".',
    );
  }

  const authorized = await authorizeAccount();
  const { replaced } = await upsertAccount({
    email: authorized.email,
    refreshToken: authorized.refreshToken,
    addedAt: new Date().toISOString(),
  });

  process.stdout.write(
    '\n  ' +
      (replaced ? 'Autorizzazione aggiornata per ' : 'Account collegato: ') +
      authorized.email +
      '\n',
  );

  // Verifica immediata: dire "collegato" senza sapere cosa vede sarebbe inutile.
  const { accounts } = await loadAccounts();
  const account = accounts.find((a) => a.email.toLowerCase() === authorized.email.toLowerCase());

  if (account) {
    try {
      const properties = await listProperties(account);
      process.stdout.write('  Proprietà visibili con questo account: ' + properties.length + '\n');
      for (const property of properties.slice(0, 12)) {
        process.stdout.write('    ' + property.siteUrl + '\n');
      }
      if (properties.length > 12) {
        process.stdout.write('    … e altre ' + (properties.length - 12) + '\n');
      }
      if (properties.length === 0) {
        process.stdout.write(
          '\n  Questo account non ha proprietà in Search Console. Se ne aspettavi,\n' +
            '  controlla di aver fatto login con l’indirizzo giusto.\n',
        );
      }
    } catch (err) {
      process.stdout.write(
        '\n  Attenzione: non è stato possibile leggere le proprietà ora (' +
          (err instanceof Error ? err.message : String(err)) +
          ').\n  Riprova con: npm run gsc\n',
      );
    }
  }

  process.stdout.write('\n  Per collegare un altro account, rilancia lo stesso comando.\n\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--list')) return list();

  const removeIndex = args.indexOf('--remove');
  if (removeIndex >= 0) {
    const email = args[removeIndex + 1];
    if (!email) fail('Indica l’email da scollegare: npm run gsc:login -- --remove email@esempio.it');
    return remove(email);
  }

  return login();
}

main().catch((err: unknown) => {
  process.stderr.write('\n  Errore: ' + (err instanceof Error ? err.message : String(err)) + '\n\n');
  process.exit(1);
});
