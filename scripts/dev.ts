// Cross-platform `bun run dev`: spawn the Bun API server and the Vite client
// as siblings; when either exits, tear the other down (same recipe as
// scelo/apps/swarm/scripts/dev.ts so the two projects behave alike).
import { dirname, join } from 'node:path';

const viteBin = join(dirname(Bun.resolveSync('vite/package.json', import.meta.dir)), 'bin/vite.js');
const specs: string[][] = [
  ['bun', '--watch', 'src/server/index.ts'],
  ['node', viteBin],
];
const procs = specs.map((cmd) => Bun.spawn(cmd, { stdio: ['inherit', 'inherit', 'inherit'], env: process.env }));
const firstExit = await Promise.race(procs.map((p) => p.exited));
for (const p of procs) {
  try { p.kill(); } catch { /* already gone */ }
}
process.exit(firstExit ?? 1);
