import { logger } from '../utils/logger';

/** Sottoinsieme del WebClient di Slack effettivamente usato: mantiene i test semplici. */
export interface SlackApiClient {
  apiCall(method: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface UploadRequest {
  channelId: string;
  threadTs?: string;
  filename: string;
  title: string;
  content: Buffer;
  initialComment?: string;
}

export interface UploadResult {
  fileId: string;
  permalink: string | null;
}

/**
 * Carica un file usando il flusso "external upload" di Slack
 * (getUploadURLExternal -> POST dei byte -> completeUploadExternal).
 *
 * È implementato a mano invece di usare l’helper `files.uploadV2` perché il flusso
 * a tre passi è stabile e indipendente dalla versione di @slack/web-api installata.
 */
export async function uploadFile(
  client: SlackApiClient,
  request: UploadRequest,
): Promise<UploadResult> {
  if (request.content.length === 0) {
    throw new Error('Il file da caricare è vuoto.');
  }

  const reservation = await client.apiCall('files.getUploadURLExternal', {
    filename: request.filename,
    length: request.content.length,
  });

  const uploadUrl = reservation['upload_url'];
  const fileId = reservation['file_id'];

  if (typeof uploadUrl !== 'string' || typeof fileId !== 'string') {
    throw new Error(
      'Slack non ha restituito un upload_url valido: ' + JSON.stringify(reservation).slice(0, 300),
    );
  }

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: new Uint8Array(request.content),
    headers: { 'content-type': 'application/octet-stream' },
  });

  if (!response.ok) {
    throw new Error('Upload del file fallito: HTTP ' + response.status + ' ' + response.statusText);
  }

  const completion = await client.apiCall('files.completeUploadExternal', {
    files: JSON.stringify([{ id: fileId, title: request.title }]),
    channel_id: request.channelId,
    ...(request.threadTs ? { thread_ts: request.threadTs } : {}),
    ...(request.initialComment ? { initial_comment: request.initialComment } : {}),
  });

  const files = completion['files'];
  let permalink: string | null = null;
  if (Array.isArray(files) && files.length > 0) {
    const first = files[0] as Record<string, unknown>;
    if (typeof first['permalink'] === 'string') permalink = first['permalink'];
  }

  if (!permalink) {
    try {
      const info = await client.apiCall('files.info', { file: fileId });
      const file = info['file'] as Record<string, unknown> | undefined;
      if (file && typeof file['permalink'] === 'string') permalink = file['permalink'];
    } catch (err) {
      logger.warn({ err, fileId }, 'Permalink del file non recuperato');
    }
  }

  return { fileId, permalink };
}
