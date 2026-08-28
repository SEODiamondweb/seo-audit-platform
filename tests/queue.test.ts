import { describe, expect, it } from 'vitest';
import { JobQueue } from '../src/queue/queue';
import { sleep } from '../src/utils/concurrency';

/** Attende che una condizione diventi vera, entro un limite di sicurezza. */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Condizione non soddisfatta entro ' + timeoutMs + 'ms');
    await sleep(10);
  }
}

describe('JobQueue', () => {
  it('esegue i job accodati', async () => {
    const queue = new JobQueue(2, 5000);
    const done: string[] = [];

    queue.enqueue(
      'a',
      async () => {
        done.push('a');
      },
      () => undefined,
    );

    await sleep(50);
    expect(done).toEqual(['a']);
  });

  it('rispetta il limite di parallelismo', async () => {
    const queue = new JobQueue(2, 5000);
    let running = 0;
    let peak = 0;

    for (let i = 0; i < 6; i++) {
      queue.enqueue(
        'job' + i,
        async () => {
          running++;
          peak = Math.max(peak, running);
          await sleep(30);
          running--;
        },
        () => undefined,
      );
    }

    // Si attende la condizione, non un tempo fisso: sotto carico sei job da 30ms possono
    // richiedere piu' di quanto una sleep arbitraria conceda, e il test fallirebbe senza
    // che nulla sia rotto.
    await waitFor(() => queue.size === 0);
    expect(peak).toBeLessThanOrEqual(2);
    expect(queue.size).toBe(0);
  });

  it('inoltra gli errori al gestore senza fermare la coda', async () => {
    const queue = new JobQueue(1, 5000);
    const errors: string[] = [];
    let secondRan = false;

    queue.enqueue(
      'fallisce',
      async () => {
        throw new Error('boom');
      },
      (error) => {
        errors.push(error.message);
      },
    );

    queue.enqueue(
      'ok',
      async () => {
        secondRan = true;
      },
      () => undefined,
    );

    await sleep(150);
    expect(errors).toEqual(['boom']);
    expect(secondRan).toBe(true);
  });

  it('applica il timeout ai job troppo lunghi', async () => {
    const queue = new JobQueue(1, 60);
    const errors: string[] = [];

    queue.enqueue(
      'lento',
      async () => {
        await sleep(500);
      },
      (error) => {
        errors.push(error.message);
      },
    );

    await sleep(250);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Timeout');
  });

  it('permette di annullare un job in coda', async () => {
    const queue = new JobQueue(1, 5000);
    let secondRan = false;

    queue.enqueue('primo', async () => sleep(80), () => undefined);
    const second = queue.enqueue(
      'secondo',
      async () => {
        secondRan = true;
      },
      () => undefined,
    );

    expect(queue.cancel(second.id)).toBe(true);
    await sleep(200);
    expect(secondRan).toBe(false);
  });
});
