// Which worker the pool starts. From source, worker.ts beside pool.ts, by its absolute URL; inside the compiled
// engine (desktop/scripts/bundle-server.sh), the embedded worker by its source name, './worker.ts'. The compiled
// case is told by the module's path, not its URL: on Windows the URL spells the embedded drive's ~ as %7E.

import { describe, expect, test } from 'bun:test';
import { workerSpecifier } from '../src/server/pool';

describe('the worker the pool starts', () => {
  test('compiled for Windows: the embedded worker, though the URL spells ~ as %7E', () => {
    expect(workerSpecifier('B:\\~BUN\\root\\community-lab-server.exe', 'file:///B:/%7EBUN/root/community-lab-server.exe')).toBe('./worker.ts');
  });
  test('compiled for Linux and macOS: the embedded worker', () => {
    expect(workerSpecifier('/$bunfs/root/community-lab-server', 'file:///$bunfs/root/community-lab-server')).toBe('./worker.ts');
  });
  test('from source: worker.ts beside pool.ts, as a URL, whatever the working directory', () => {
    expect(workerSpecifier('/home/a/community-lab/src/server/pool.ts', 'file:///home/a/community-lab/src/server/pool.ts')).toBe(
      'file:///home/a/community-lab/src/server/worker.ts',
    );
    expect(workerSpecifier()).toBe(new URL('../src/server/worker.ts', import.meta.url).href);
  });
});
