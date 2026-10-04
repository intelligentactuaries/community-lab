// One engine run per message, off the server's event loop (pool.ts). A task is
// a province on one seed for some years; the answer is what the job asked of
// it — an experiment arm's indicators, a Monte Carlo batch row, or the run's
// experience cells for a pooled export.

import type { ExperimentArm, ExperimentSpec } from '@scelo/core/exchange';
import { summariseRun } from '../sim/batch';
import { alivePeople } from '../sim/ctx';
import { Simulation } from '../sim/engine';
import { runArm } from '../sim/experiment';
import { type Grouping, experienceCells, trueBasis } from '../sim/experience';
import { assumptionsHash, type ScenarioParams } from '../sim/params';
import { DAYS_PER_YEAR, calendarForDay } from '../sim/time';

export type Task =
  | { kind: 'arm'; spec: Pick<ExperimentSpec, 'base' | 'baseMortality' | 'baseShocks' | 'years'>; arm: ExperimentArm | null; seed: string }
  | { kind: 'batch'; params: Partial<ScenarioParams>; years: number; seed: string }
  | { kind: 'experience'; params: Partial<ScenarioParams>; years: number; seed: string; ageWidth: number; group: Grouping };

export type TaskMessage = { type: 'init'; stop: Int32Array } | { type: 'run'; id: number; task: Task };
export type TaskReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/**
 * The pool's stop flag for this worker (a SharedArrayBuffer): set to 1 when the job is cancelled. A thread cannot be
 * interrupted from outside in the middle of a run, so the run looks at the flag after every simulated day — a few
 * milliseconds — and gives up there.
 */
let stop: Int32Array | null = null;
const checkStop = () => {
  if (stop && Atomics.load(stop, 0) === 1) throw new Error('cancelled');
};

function run(task: Task): unknown {
  if (task.kind === 'arm') return runArm(task.spec, task.arm, task.seed, checkStop);
  const t0 = performance.now();
  const sim = new Simulation({ journalRetentionMonths: 0, ...task.params, seed: task.seed });
  const pop0 = alivePeople(sim.world).length;
  sim.runDays(Math.round(task.years * DAYS_PER_YEAR), checkStop);
  if (task.kind === 'batch') return { row: summariseRun(sim, task.seed, task.years, performance.now() - t0, pop0), basisHash: sim.world.basisHash };
  return {
    cells: experienceCells(sim, { ageWidth: task.ageWidth, group: task.group }),
    truth: trueBasis(sim),
    basisHash: sim.world.basisHash,
    assumptionsHash: assumptionsHash(sim.params),
    span: { from: calendarForDay(sim.ctx.startMs, 0).isoDate, to: calendarForDay(sim.ctx.startMs, sim.world.day).isoDate },
    ms: Math.round(performance.now() - t0),
  };
}

declare const self: Worker;
self.onmessage = (e: MessageEvent<TaskMessage>) => {
  if (e.data.type === 'init') {
    stop = e.data.stop;
    return;
  }
  const { id, task } = e.data;
  try {
    postMessage({ id, ok: true, result: run(task) } satisfies TaskReply);
  } catch (err) {
    postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies TaskReply);
  }
};
