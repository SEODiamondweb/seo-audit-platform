import { collectProperties, credentialPaths, loadAccounts } from './gsc';
import { matchProperty } from './gsc';

/**
 * Diagnostica del collegamento a Search Console.
 *
 *   npm run gsc            elenca le proprietà raggiungibili
 *   npm run gsc -- a.it b.it   dice anche, per ogni dominio, se è coperto
 *
 * Serve a rispondere all'unica domanda che conta prima di lanciare gli audit: il bot vede
 * davvero le proprietà dei miei clienti? Un dominio scoperto qui è un dominio su cui il
 * report non avrà dati Google — meglio saperlo adesso che leggendolo nel PDF.
 */

function line(char = '─', width = 74): string {
  return char.repeat(width);
}

async function main(): Promise<void> {
  const paths = credentialPaths();
  const domains = process.argv.slice(2).filter((a) => !a.startsWith('-'));

  if (paths.length === 0) {
    process.stdout.write(
      '\nSearch Console non è configurata.\n\n' +
        'Imposta GSC_CREDENTIALS_PATH nel file .env con il percorso della chiave JSON del\n' +
        'service account. Per più chiavi, separale con punto e virgola:\n\n' +
        '  GSC_CREDENTIALS_PATH=C:\\Users\\tuo\\chiave-1.json;C:\\Users\\tuo\\chiave-2.json\n\n' +
        'La procedura completa è nel README, sezione "Search Console".\n\n',
    );
    process.exitCode = 1;
    return;
  }

  const { accounts, errors: loadErrors } = await loadAccounts();

  process.stdout.write('\n' + line('═') + '\n');
  process.stdout.write('  EMAIL DA AUTORIZZARE IN SEARCH CONSOLE\n');
  process.stdout.write(line('═') + '\n\n');

  if (accounts.length === 0) {
    process.stdout.write('  Nessuna chiave valida.\n\n');
  }
  for (const account of accounts) {
    process.stdout.write('  ' + account.email + '\n');
  }

  process.stdout.write(
    '\n  Entra in Search Console con ciascuno dei tuoi account Google e, per ogni\n' +
      '  proprietà, vai in Impostazioni → Utenti e autorizzazioni → Aggiungi utente\n' +
      '  e incolla l’email qui sopra. Serve essere Proprietario della proprietà.\n\n',
  );

  for (const err of loadErrors) {
    process.stdout.write('  ⚠ chiave non caricata: ' + err.keyPath + '\n    ' + err.reason + '\n\n');
  }

  if (accounts.length === 0) {
    process.exitCode = 1;
    return;
  }

  process.stdout.write(line('═') + '\n');
  process.stdout.write('  PROPRIETÀ ATTUALMENTE RAGGIUNGIBILI\n');
  process.stdout.write(line('═') + '\n\n');

  const { properties, errors } = await collectProperties();

  if (properties.length === 0) {
    process.stdout.write(
      '  Nessuna. Se hai appena aggiunto l’email, attendi qualche minuto e riprova:\n' +
        '  Google impiega un momento a propagare i permessi.\n\n',
    );
  } else {
    // Raggruppate per service account: con più chiavi si vede quale copre cosa.
    const byAccount = new Map<string, typeof properties>();
    for (const property of properties) {
      const list = byAccount.get(property.account.email) ?? [];
      list.push(property);
      byAccount.set(property.account.email, list);
    }

    for (const [email, list] of byAccount) {
      if (byAccount.size > 1) process.stdout.write('  via ' + email + '\n');
      for (const property of list.sort((a, b) => a.siteUrl.localeCompare(b.siteUrl))) {
        const kind = property.siteUrl.startsWith('sc-domain:') ? 'Dominio' : 'URL    ';
        process.stdout.write(
          '  ' + kind + '  ' + property.siteUrl.padEnd(46) + property.permissionLevel + '\n',
        );
      }
      process.stdout.write('\n');
    }
    process.stdout.write('  Totale: ' + properties.length + ' proprietà\n\n');
  }

  for (const err of errors) {
    process.stdout.write('  ⚠ ' + err + '\n');
  }
  if (errors.length > 0) process.stdout.write('\n');

  // ── Copertura dei domini richiesti ──
  if (domains.length > 0) {
    process.stdout.write(line('═') + '\n');
    process.stdout.write('  COPERTURA DEI DOMINI RICHIESTI\n');
    process.stdout.write(line('═') + '\n\n');

    let missing = 0;
    for (const domain of domains) {
      const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const match = matchProperty(host, properties);
      if (match) {
        process.stdout.write('  ✓ ' + host.padEnd(34) + match.siteUrl + '\n');
      } else {
        missing += 1;
        process.stdout.write('  ✗ ' + host.padEnd(34) + 'nessuna proprietà corrispondente\n');
      }
    }

    process.stdout.write('\n');
    if (missing > 0) {
      process.stdout.write(
        '  ' +
          missing +
          ' dominio/i senza copertura: i loro audit non avranno dati Search Console\n' +
          '  (il report lo dirà esplicitamente, senza inventare numeri).\n\n',
      );
      process.exitCode = 1;
    } else {
      process.stdout.write('  Tutti i domini richiesti sono coperti.\n\n');
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write('Errore: ' + (err instanceof Error ? err.message : String(err)) + '\n');
  process.exit(1);
});
