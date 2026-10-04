// A pool of Bun Workers for the engine's heavy runs. A province takes four to
// five seconds a simulated year on one core, so a twenty-seed, thirty-year
// batch is three quarters of an hour of computing; run on the server's own
// thread it froze every other request until it finished (health checks,
// dialogue, the progress polls themselves). Here each seed is a task on a
// worker thread, the server stays responsive, and the seeds run side by side
// on the machine's cores.
//
// Workers start on first use and stay up; a job's queued tasks can be
// dropped (cancel) without touching the ones already running.

import { availableParallelism } from 'node:os';
import type { Task, TaskMessage, TaskReply } from './worker';

/** Where the worker script is. Inside a `bun build --compile` executable the
 *  worker is an extra entry point addressed by its relative name (and the
 *  embedded file system shows in import.meta.url); from source, by its
 *  absolute URL, since a relative name would resolve against the working
 *  directory, which the IDE sets to the data folder. */
function workerSpecifier(): string {
  return /\$bunfs|~BUN/.test(import.meta.url) ? './worker.ts' : new URL('./worker.ts', import.meta.url).href;
}

interface Pending {
  id: number;
  task: Task;
  job: string;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/** A worker, the task it is on, and its stop flag (shared memory the worker reads after every simulated day). */
interface Slot {
  w: Worker;
  busy: Pending | null;
  stop: Int32Array;
}

export class WorkerPool {
  private readonly workers: Slot[] = [];
  private readonly queue: Pending[] = [];
  private nextId = 1;

  constructor(readonly size: number) {}

  /** Run one task; `job` groups tasks so a job can be cancelled. */
  run<T>(task: Task, job: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id: this.nextId++, task, job, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  /** Stop a job: its queued tasks are dropped, and the workers running its tasks are told to stop. Each gives up
   *  at the end of the simulated day it is on (Worker.terminate cannot interrupt a run in progress) and its task
   *  rejects as cancelled; the worker is then free for the next job. */
  cancel(job: string): number {
    let n = 0;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].job !== job) continue;
      this.queue.splice(i, 1)[0].reject(new Error('cancelled'));
      n++;
    }
    for (const slot of this.workers) {
      if (slot.busy?.job !== job) continue;
      Atomics.store(slot.stop, 0, 1);
      n++;
    }
    return n;
  }

  get stats(): { size: number; running: number; queued: number } {
    return { size: this.size, running: this.workers.filter((x) => x.busy).length, queued: this.queue.length };
  }

  private pump(): void {
    while (this.queue.length) {
      let slot = this.workers.find((x) => !x.busy);
      if (!slot && this.workers.length < this.size) slot = this.spawn();
      if (!slot) return;
      const next = this.queue.shift() as Pending;
      slot.busy = next;
      Atomics.store(slot.stop, 0, 0);
      slot.w.postMessage({ type: 'run', id: next.id, task: next.task } satisfies TaskMessage);
    }
  }

  private spawn(): Slot {
    const w = new Worker(workerSpecifier());
    const slot: Slot = { w, busy: null, stop: new Int32Array(new SharedArrayBuffer(4)) };
    w.postMessage({ type: 'init', stop: slot.stop } satisfies TaskMessage);
    w.onmessage = (e: MessageEvent<TaskReply>) => {
      const p = slot.busy;
      slot.busy = null;
      if (p && p.id === e.data.id) {
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      }
      this.pump();
    };
    w.onerror = (e) => {
      // A worker that dies takes its task with it; replace it and carry on.
      const p = slot.busy;
      slot.busy = null;
      p?.reject(new Error(`worker failed: ${(e as ErrorEvent).message ?? 'unknown error'}`));
      const i = this.workers.indexOf(slot);
      if (i >= 0) this.workers.splice(i, 1);
      try {
        w.terminate();
      } catch {
        /* gone */
      }
      this.pump();
    };
    this.workers.push(slot);
    return slot;
  }
}

/**
 * Half the machine's threads, at most eight: the IDE shares the machine with its own window, an editor, a browser and
 * a local model, and a province-year holds a few hundred megabytes while it runs. COMMUNITY_WORKERS overrides it.
 */
export const pool = new WorkerPool(Math.max(1, Number(process.env.COMMUNITY_WORKERS) || Math.min(8, Math.floor(availableParallelism() / 2))));
