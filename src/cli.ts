import { runFullAudit } from './pipeline';
import { closeBrowser } from './report/pdf';
import { CommandError, parseCommand } from './slack/parseArgs';
import { logger } from './utils/logger';

/**
 * Entry point da riga di comando: stessa pipeline del comando Slack, senza Slack.
 * Serve per test end-to-end, generazione manuale dei report e debug.
 *
 *   npm run audit -- example.com --max 100 --depth 3
 */
async function main(): Promise<void> {
  const input = process.argv.slice(2).join(' ');

  if (!input.trim()) {
    process.stdout.write(
      'Uso: npm run audit -- <dominio> [--max N] [--depth N] [--subdomains] [--no-robots]\n',
    );
    process.exitCode = 1;
    return;
  }

  let parsed;
  try {
    parsed = parseCommand(input);
  } catch (err) {
    process.stderr.write((err instanceof CommandError ? err.message : String(err)) + '\n');
    process.exitCode = 1;
    return;
  }

  if (parsed.kind === 'help') {
    process.stdout.write('Uso: npm run audit -- <dominio> [opzioni]\n');
    return;
  }

  for (const warning of parsed.warnings) {
    process.stdout.write('Attenzione: ' + warning + '\n');
  }

  const artifacts = await runFullAudit(
    { url: parsed.url, overrides: parsed.overrides, requestedBy: 'cli' },
    {
      onProgress: (progress) => {
        if (progress.phase === 'crawl') {
          process.stdout.write(
            '\r  ' + progress.crawled + ' URL analizzate, ' + progress.queued + ' in coda   ',
          );
        } else {
          process.stdout.write('\n' + progress.message + '\n');
        }
      },
    },
  );

  const { audit } = artifacts;

  process.stdout.write('\n');
  process.stdout.write('Dominio       : ' + audit.domain + '\n');
  process.stdout.write('Punteggio     : ' + audit.score.total + '/100 (' + audit.score.grade + ')\n');
  process.stdout.write('URL analizzate: ' + audit.summary.totalPages + '\n');
  process.stdout.write('Problemi      : ' + audit.issues.length + '\n');
  process.stdout.write(
    '  P0 ' +
      audit.summary.issuesByPriority.P0 +
      ' · P1 ' +
      audit.summary.issuesByPriority.P1 +
      ' · P2 ' +
      audit.summary.issuesByPriority.P2 +
      ' · P3 ' +
      audit.summary.issuesByPriority.P3 +
      '\n',
  );
  process.stdout.write('\nFile generati:\n');
  process.stdout.write('  PDF   : ' + artifacts.pdfPath + '\n');
  process.stdout.write('  HTML  : ' + artifacts.htmlPath + '\n');
  process.stdout.write('  JSON  : ' + artifacts.jsonPath + '\n');

  await closeBrowser();
}

main().catch(async (err: unknown) => {
  logger.error({ err }, 'Audit fallito');
  await closeBrowser();
  process.exit(1);
});
