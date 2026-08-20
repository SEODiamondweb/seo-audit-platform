import { App, LogLevel } from '@slack/bolt';
import { env } from '../config/env';
import { JobQueue } from '../queue/queue';
import { runFullAudit, resolveStartUrl } from '../pipeline';
import { logger } from '../utils/logger';
import { errorBlocks, progressText, queuedText, resultBlocks } from './blocks';
import { CommandError, HELP_TEXT, parseCommand } from './parseArgs';
import { uploadFile } from './upload';
import type { SlackApiClient } from './upload';

/** Intervallo minimo fra due chat.update di avanzamento: evita il rate limit di Slack. */
const PROGRESS_THROTTLE_MS = 4000;

export function createSlackApp(): App {
  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
  });

  const queue = new JobQueue(env.JOB_CONCURRENCY, env.JOB_TIMEOUT_MS);

  app.command('/' + env.SLACK_COMMAND, async ({ command, ack, respond, client }) => {
    await ack();

    let parsed;
    try {
      parsed = parseCommand(command.text ?? '');
    } catch (err) {
      const message = err instanceof CommandError ? err.message : String(err);
      await respond({ response_type: 'ephemeral', text: '❌ ' + message });
      return;
    }

    if (parsed.kind === 'help') {
      await respond({
        response_type: 'ephemeral',
        text: HELP_TEXT.replace(/COMMAND/g, env.SLACK_COMMAND),
      });
      return;
    }

    let startUrl: string;
    let domain: string;
    try {
      startUrl = resolveStartUrl(parsed.url);
      domain = new URL(startUrl).hostname;
    } catch (err) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ ' + (err instanceof Error ? err.message : String(err)),
      });
      return;
    }

    // Il messaggio pubblico e il "contenitore" che verrà aggiornato durante l’audit.
    let messageTs: string;
    try {
      const posted = await client.chat.postMessage({
        channel: command.channel_id,
        text: queuedText(domain, queue.activeCount >= env.JOB_CONCURRENCY ? queue.size : 0),
      });
      if (typeof posted.ts !== 'string') throw new Error('Slack non ha restituito il ts del messaggio');
      messageTs = posted.ts;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'Impossibile pubblicare il messaggio iniziale');
      await respond({
        response_type: 'ephemeral',
        text:
          '❌ Non riesco a scrivere in questo canale (' +
          message +
          ').\nInvita il bot con `/invite @' +
          env.SLACK_COMMAND +
          '` e riprova.',
      });
      return;
    }

    if (parsed.warnings.length > 0) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ ' + parsed.warnings.join('\n⚠️ '),
      });
    }

    const updateMessage = async (text: string): Promise<void> => {
      try {
        await client.chat.update({ channel: command.channel_id, ts: messageTs, text });
      } catch (err) {
        logger.warn({ err }, 'Aggiornamento del messaggio di avanzamento fallito');
      }
    };

    queue.enqueue(
      'audit:' + domain,
      async (signal) => {
        let lastUpdate = 0;

        const artifacts = await runFullAudit(
          {
            url: startUrl,
            overrides: parsed.overrides,
            requestedBy: command.user_name || command.user_id,
          },
          {
            shouldStop: () => signal.cancelled,
            onProgress: (progress) => {
              const now = Date.now();
              if (progress.phase !== 'crawl' || now - lastUpdate >= PROGRESS_THROTTLE_MS) {
                lastUpdate = now;
                const detail =
                  progress.phase === 'crawl'
                    ? progress.crawled + ' URL analizzate · ' + progress.queued + ' in coda'
                    : 'Attendi qualche secondo';
                void updateMessage(progressText(domain, progress.message, detail));
              }
            },
          },
        );

        await client.chat.update({
          channel: command.channel_id,
          ts: messageTs,
          text:
            'SEO Audit ' +
            artifacts.audit.domain +
            ' — punteggio ' +
            artifacts.audit.score.total +
            '/100',
          blocks: resultBlocks(artifacts.audit) as never,
        });

        const apiClient = client as unknown as SlackApiClient;

        const upload = await uploadFile(apiClient, {
          channelId: command.channel_id,
          threadTs: messageTs,
          filename: artifacts.fileBaseName + '.pdf',
          title: 'SEO Audit ' + artifacts.audit.domain,
          content: artifacts.pdfBuffer,
          initialComment:
            '📄 Report completo di *' +
            artifacts.audit.domain +
            '* — ' +
            artifacts.audit.issues.length +
            ' problemi su ' +
            artifacts.audit.summary.totalPages +
            ' URL.',
        });

        logger.info({ permalink: upload.permalink }, 'PDF caricato su Slack');

      },
      async (error) => {
        await client.chat
          .update({
            channel: command.channel_id,
            ts: messageTs,
            text: 'SEO Audit fallito — ' + domain,
            blocks: errorBlocks(domain, error.message) as never,
          })
          .catch((err: unknown) => {
            logger.error({ err }, 'Impossibile aggiornare il messaggio con l’errore');
          });
      },
    );
  });

  app.error(async (error) => {
    logger.error({ err: error }, 'Errore non gestito nell’app Slack');
  });

  return app;
}
