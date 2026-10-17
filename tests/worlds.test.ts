// The lab's worlds folder: a world saved from the builder is a .sce file in
// data/worlds/, named after the world, replaced whole when saved again.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planHash } from '../src/sim/plan/hash';
import { masakhanePlan } from '../src/sim/plan/templates';
import { deleteWorld, getWorld, listWorlds, putWorld } from '../src/server/worlds';

describe('the worlds folder', () => {
  test('save, rename, a namesake, a stray Scelo project, open and delete', () => {
    const data = mkdtempSync(join(tmpdir(), 'community-worlds-'));
    const before = process.env.COMMUNITY_DATA_DIR;
    process.env.COMMUNITY_DATA_DIR = data;
    try {
      const dir = join(data, 'worlds');
      const a = masakhanePlan();
      expect(putWorld(a).file).toBe('masakhane.sce');
      expect(existsSync(join(dir, 'masakhane.sce'))).toBe(true);
      expect(listWorlds()).toHaveLength(1);
      expect(listWorlds()[0]).toMatchObject({ id: a.id, name: 'Masakhane', file: 'masakhane.sce' });
      expect(listWorlds()[0].summary).toMatchObject({ buildings: a.buildings.length, errors: 0 });

      // Renamed and saved again: one file, under the new name.
      const renamed = { ...a, name: 'My Town' };
      expect(putWorld(renamed).file).toBe('my-town.sce');
      expect(readdirSync(dir).sort()).toEqual(['my-town.sce']);

      // Another world of the same name does not take the first one's file.
      const b = { ...masakhanePlan(), name: 'My Town' };
      expect(b.id).not.toBe(a.id);
      expect(putWorld(b).file).toBe('my-town-2.sce');

      // A Scelo project dropped in the folder is left alone and not listed.
      writeFileSync(join(dir, 'claims.sce'), JSON.stringify({ format: 'scelo-project', version: 1, app: 'Scelo', project: null, session: { dataset: null } }));
      expect(listWorlds().map((w) => w.file).sort()).toEqual(['my-town-2.sce', 'my-town.sce']);

      expect(planHash(getWorld(a.id)!)).toBe(planHash(renamed));
      expect(deleteWorld(a.id)).toBe(true);
      expect(readdirSync(dir).sort()).toEqual(['claims.sce', 'my-town-2.sce']);
      expect(getWorld(a.id)).toBeNull();
    } finally {
      if (before === undefined) delete process.env.COMMUNITY_DATA_DIR;
      else process.env.COMMUNITY_DATA_DIR = before;
      rmSync(data, { recursive: true, force: true });
    }
  });
});
