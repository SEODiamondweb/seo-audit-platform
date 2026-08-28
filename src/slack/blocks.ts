import { CATEGORY_LABELS, SEVERITY_LABELS } from '../audit/types';
import type { AuditResult } from '../audit/types';
import { truncate } from '../utils/text';

/** I blocchi Block Kit sono passati a Slack come JSON: struttura libera, nessun tipo forte richiesto. */
export type Block = Record<string, unknown>;

function scoreEmoji(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  if (score >= 40) return '🟠';
  return '🔴';
}

export function progressText(domain: string, phase: string, detail: string): string {
  return '🔎 *SEO Audit — ' + domain + '*\n' + phase + '\n_' + detail + '_';
}

export function queuedText(domain: string, position: number): string {
  if (position <= 0) return '🔎 *SEO Audit — ' + domain + '*\nAvvio della scansione…';
  return (
    '🔎 *SEO Audit — ' +
    domain +
    '*\nIn coda: ci sono ' +
    position +
    ' audit davanti a questo. Parte automaticamente appena si libera uno slot.'
  );
}

export function errorBlocks(domain: string, message: string): Block[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '❌ *SEO Audit fallito — ' + domain + '*\n```' + truncate(message, 900) + '```',
      },
    },
  ];
}

export function resultBlocks(audit: AuditResult): Block[] {
  const { score, summary, issues } = audit;

  const topIssues = issues.slice(0, 5);
  const topText =
    topIssues.length > 0
      ? topIssues
          .map(
            (issue, i) =>
              '*' +
              (i + 1) +
              '.* ' +
              issue.title +
              '  _' +
              SEVERITY_LABELS[issue.severity] +
              ' · ' +
              CATEGORY_LABELS[issue.category] +
              ' · ' +
              issue.affectedCount +
              ' URL_',
          )
          .join('\n')
      : 'Nessun problema rilevato.';

  const worstCategories = score.categories
    .filter((c) => c.penalty > 0)
    .sort((a, b) => b.penalty - a.penalty)
    .slice(0, 3)
    .map((c) => c.label + ' (' + c.score + '/100)')
    .join(' · ');

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: scoreEmoji(score.total) + ' SEO Audit ' + audit.domain + ' — ' + score.total + '/100',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Valutazione*\n' + score.grade + ' (' + score.total + '/100)' },
        { type: 'mrkdwn', text: '*URL analizzate*\n' + summary.totalPages },
        { type: 'mrkdwn', text: '*Problemi rilevati*\n' + issues.length },
        {
          type: 'mrkdwn',
          text:
            '*Severità*\n' +
            summary.issuesBySeverity.critical +
            ' critici · ' +
            summary.issuesBySeverity.high +
            ' alti · ' +
            summary.issuesBySeverity.medium +
            ' medi',
        },
        { type: 'mrkdwn', text: '*Indicizzabili*\n' + summary.indexablePages + ' / ' + summary.totalPages },
        {
          type: 'mrkdwn',
          text: '*Errori*\n' + summary.brokenPages + ' × 4xx · ' + summary.serverErrors + ' × 5xx',
        },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Criticità principali*\n' + topText },
    },
    ...(worstCategories
      ? [
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: '*Aree più deboli:* ' + worstCategories },
            ],
          },
        ]
      : []),
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            'Il report PDF completo è allegato qui sotto.',
        },
      ],
    },
  ];
}
