// Fetches MakeHuman's CC0 data into data/makehuman (not tracked), for
// scripts/humans/build.py:
//   repo/    the MakeHuman repository at a fixed commit: the hm08 base mesh,
//            its targets, the default skeleton and its weights
//   assets/  the CC0 system asset pack: clothes, hair, eyebrows, eyelashes,
//            eyes, skins and proxy meshes
//
//   bun scripts/humans/fetch.ts && python3 scripts/humans/build.py
//
// MakeHuman's assets (base mesh, targets, proxies, textures, clothes) are
// released under CC0 1.0 (repo LICENSE.md, section C); the program code is
// AGPL and is not used here, only the data.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const DIR = join(ROOT, 'data', 'makehuman');
const REPO = 'https://github.com/makehumancommunity/makehuman.git';
const COMMIT = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';
const PACK = 'https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip';

async function run(cmd: string[], cwd = DIR): Promise<void> {
  const p = Bun.spawn(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if ((await p.exited) !== 0) throw new Error(`failed: ${cmd.join(' ')}`);
}

mkdirSync(DIR, { recursive: true });
if (!existsSync(join(DIR, 'repo', 'makehuman', 'data', '3dobjs', 'base.obj'))) {
  mkdirSync(join(DIR, 'repo'), { recursive: true });
  await run(['git', 'init', '-q'], join(DIR, 'repo'));
  await run(['git', 'fetch', '-q', '--depth', '1', REPO, COMMIT], join(DIR, 'repo'));
  await run(['git', 'checkout', '-q', 'FETCH_HEAD'], join(DIR, 'repo'));
  console.log('makehuman repository at', COMMIT);
}
if (!existsSync(join(DIR, 'assets', 'clothes'))) {
  const zip = join(DIR, 'makehuman_system_assets_cc0.zip');
  if (!existsSync(zip)) {
    const res = await fetch(PACK);
    if (!res.ok) throw new Error(`asset pack: ${res.status}`);
    await Bun.write(zip, res);
  }
  await run(['unzip', '-q', '-o', zip, '-d', join(DIR, 'assets')]);
  console.log('system assets unpacked');
}
console.log('makehuman data ready in', DIR);
