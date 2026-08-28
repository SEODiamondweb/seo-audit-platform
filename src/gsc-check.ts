import { collectProperties, loadAccounts, matchProperty } from './gsc';

/**
 * Diagnostica del collegamento a Search Console.
 *
 *   npm run gsc                    elenca account e proprietà raggiungibili
 *   npm run gsc -- a.it b.it       dice anche, per ogni dominio, se è coperto
 *
 * Risponde all'unica domanda che conta prima di lanciare gli audit: il bot vede davvero le
 * proprietà dei miei siti? Un dominio scoperto qui è un dominio il cui report non avrà dati
 * Google — meglio saperlo adesso che leggendolo nel PDF.
 */

function rule(char = '─', width = 74): string {
  return char.repeat(width);
}

async function main(): Promise<void> {
  const domains = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const { accounts, errors: loadErrors } = await loadAccounts();

  process.stdout.write('\n' + rule('═') + '\n');
  process.stdout.write('  ACCOUNT COLLEGATI\n');
  process.stdout.write(rule('═') + '\n\n');

  if (accounts.length === 0) {
    process.stdout.write(
      '  Nessuno.\n\n' +
        '  Collega i tuoi account Google con:  npm run gsc:login\n' +
        '  (una volta per ciascun account; la procedura è nel README)\n\n',
    );
  }

  for (const account of accounts) {
    const kind = account.kind === 'oauth' ? 'account Google' : 'service account';
    process.stdout.write('  • ' + account.email + '\n    ' + kind + ' — ' + account.source + '\n');
  }
  if (accounts.length > 0) process.stdout.write('\n');

  for (const err of loadErrors) {
    process.stdout.write('  ⚠ ' + err.source + '\n    ' + err.reason + '\n\n');
  }

  if (accounts.length === 0) {
    process.exitCode = 1;
    return;
  }

  process.stdout.write(rule('═') + '\n');
  process.stdout.write('  PROPRIETÀ RAGGIUNGIBILI\n');
  process.stdout.write(rule('═') + '\n\n');

  const { properties, errors } = await collectProperties();

  if (properties.length === 0) {
    process.stdout.write(
      '  Nessuna. Se hai appena collegato l’account, verifica di aver fatto login\n' +
        '  con l’indirizzo giusto: il bot vede solo le proprietà che vede quell’account.\n\n',
    );
  } else {
    const byAccount = new Map<string, typeof properties>();
    for (const property of properties) {
      const list = byAccount.get(property.account.email) ?? [];
      list.push(property);
      byAccount.set(property.account.email, list);
    }

    for (const [email, list] of byAccount) {
      process.stdout.write('  ' + email + '\n');
      for (const property of list.sort((a, b) => a.siteUrl.localeCompare(b.siteUrl))) {
        const kind = property.siteUrl.startsWith('sc-domain:') ? 'Dominio' : 'URL    ';
        process.stdout.write(
          '    ' + kind + '  ' + property.siteUrl.padEnd(44) + property.permissionLevel + '\n',
        );
      }
      process.stdout.write('\n');
    }
    process.stdout.write(
      '  Totale: ' + properties.length + ' proprietà su ' + byAccount.size + ' account\n\n',
    );
  }

  for (const err of errors) {
    process.stdout.write('  ⚠ ' + err + '\n');
  }
  if (errors.length > 0) process.stdout.write('\n');

  // ── Copertura dei domini richiesti ──
  if (domains.length > 0) {
    process.stdout.write(rule('═') + '\n');
    process.stdout.write('  COPERTURA DEI DOMINI RICHIESTI\n');
    process.stdout.write(rule('═') + '\n\n');

    let missing = 0;
    for (const domain of domains) {
      const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const match = matchProperty(host, properties);
      if (match) {
        process.stdout.write(
          '  ✓ ' + host.padEnd(30) + match.siteUrl + '\n' + ' '.repeat(34) + 'via ' + match.account.email + '\n',
        );
      } else {
        missing += 1;
        process.stdout.write('  ✗ ' + host.padEnd(30) + 'nessuna proprietà corrispondente\n');
      }
    }

    process.stdout.write('\n');
    if (missing > 0) {
      process.stdout.write(
        '  ' +
          missing +
          ' dominio/i senza copertura: i loro audit non avranno dati Search Console.\n' +
          '  Il report lo dirà esplicitamente, senza inventare numeri. Se il dominio\n' +
          '  appartiene a un altro dei tuoi account, collegalo: npm run gsc:login\n\n',
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
