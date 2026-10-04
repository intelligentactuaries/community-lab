// Cross-platform `bun run dev`: spawn the Bun API server (http://127.0.0.1:3040)
// and the Vite client (http://localhost:5195) as siblings; when either exits,
// tear the other down. COMMUNITY_API_PORT and COMMUNITY_UI_PORT move them.
import { dirname, join } from 'node:path';

const viteBin = join(dirname(Bun.resolveSync('vite/package.json', import.meta.dir)), 'bin/vite.js');
const apiPort = process.env.COMMUNITY_API_PORT ?? '3040';
const specs: string[][] = [
  ['bun', '--watch', 'src/server/index.ts'],
  ['node', viteBin],
];
const procs = specs.map((cmd) => Bun.spawn(cmd, { stdio: ['inherit', 'inherit', 'inherit'], env: { ...process.env, PORT: apiPort, COMMUNITY_API_PORT: apiPort } }));
const firstExit = await Promise.race(procs.map((p) => p.exited));
for (const p of procs) {
  try { p.kill(); } catch { /* already gone */ }
}
process.exit(firstExit ?? 1);
