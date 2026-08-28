import { withTimeout } from '../utils/concurrency';
import { logger } from '../utils/logger';

export interface QueuedJob {
  id: string;
  label: string;
  enqueuedAt: number;
}

export interface EnqueueResult {
  id: string;
  /** 0 = parte subito, 1 = un job davanti, ecc. */
  position: number;
}

type JobRunner = (signal: { cancelled: boolean }) => Promise<void>;

interface InternalJob extends QueuedJob {
  run: JobRunner;
  onError: (error: Error) => void | Promise<void>;
}

/**
 * Coda di job in-process con limite di parallelismo e timeout per job.
 *
 * Volutamente senza Redis: un bot Slack processa pochi audit alla volta e la perdita
 * dei job in caso di riavvio e accettabile (l’utente rilancia il comando).
 * L’interfaccia e pero isolata: sostituirla con BullMQ non tocca il resto del codice.
 */
export class JobQueue {
  private readonly pending: InternalJob[] = [];
  private readonly running = new Map<string, { cancelled: boolean }>();
  private counter = 0;

  constructor(
    private readonly concurrency: number,
    private readonly timeoutMs: number,
  ) {}

  get size(): number {
    return this.pending.length + this.running.size;
  }

  get activeCount(): number {
    return this.running.size;
  }

  enqueue(
    label: string,
    run: JobRunner,
    onError: (error: Error) => void | Promise<void>,
  ): EnqueueResult {
    this.counter += 1;
    const id = 'job-' + this.counter;

    this.pending.push({ id, label, run, onError, enqueuedAt: Date.now() });
    const position = Math.max(0, this.pending.length - 1 + this.running.size - this.concurrency + 1);

    queueMicrotask(() => this.drain());

    return { id, position: Math.max(0, position) };
  }

  cancel(id: string): boolean {
    const index = this.pending.findIndex((job) => job.id === id);
    if (index >= 0) {
      this.pending.splice(index, 1);
      return true;
    }
    const signal = this.running.get(id);
    if (signal) {
      signal.cancelled = true;
      return true;
    }
    return false;
  }

  private drain(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift() as InternalJob;
      const signal = { cancelled: false };
      this.running.set(job.id, signal);

      void withTimeout(
        job.run(signal),
        this.timeoutMs,
        'Timeout: il job ha superato ' +
          (this.timeoutMs >= 1000 ? Math.round(this.timeoutMs / 1000) + ' secondi' : this.timeoutMs + ' ms'),
      )
        .catch(async (err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          logger.error({ jobId: job.id, label: job.label, err: error }, 'Job fallito');
          try {
            await job.onError(error);
          } catch (handlerErr) {
            logger.error({ err: handlerErr }, 'Anche il gestore di errore del job e fallito');
          }
        })
        .finally(() => {
          this.running.delete(job.id);
          this.drain();
        });
    }
  }
}
