// Builds the engine for pages outside the IDE (the website's live province):
//
//   bun scripts/build-embed.ts
//     dist-embed/community-lab-engine.js         the engine module (createProvince, DEFAULT_PARAMS)
//     dist-embed/community-lab-worker.js         a worker that runs a live province (src/embed/worker.ts)
//     dist-embed/manifest.json                   version, commit, sizes, built_at
//
// Both are single self-contained ES modules for browsers, minified. A page
// copies them as they are and records the version it took.

import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pkg from '../package.json';

const out = join(import.meta.dir, '..', 'dist-embed');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [entry, name] of [
  ['src/embed/engine.ts', 'community-lab-engine.js'],
  ['src/embed/worker.ts', 'community-lab-worker.js'],
] as const) {
  const r = await Bun.build({ entrypoints: [join(import.meta.dir, '..', entry)], target: 'browser', format: 'esm', minify: true, splitting: false });
  if (!r.success) {
    for (const l of r.logs) console.error(l);
    process.exit(1);
  }
  writeFileSync(join(out, name), await r.outputs[0].text());
  console.log(`${name}  ${(statSync(join(out, name)).size / 1024).toFixed(0)} KB`);
}
const commit = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD']).stdout.toString().trim() || 'unknown';
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify({ app: 'community-lab', version: pkg.version, commit, built_at: new Date().toISOString(), files: ['community-lab-engine.js', 'community-lab-worker.js'] }, null, 2)}\n`);
