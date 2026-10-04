// South Africa's peoples in the district: families of every heritage, first
// names of their own, a heritage that stays with a person when she takes her
// husband's name, and looks that follow it in the 3D view.
import { describe, expect, test } from 'bun:test';
import { alivePeople } from '../src/sim/ctx';
import { Simulation } from '../src/sim/engine';
import { FIRST_NAMES, heritageOf, SURNAME_HERITAGE } from '../src/sim/heritage';
import { dressFor } from '../src/client/render3d/dress';

const idle = { working: false, school: false, church: false, asleep: false };

describe('the district’s peoples', () => {
  const sim = new Simulation({ seed: 'heritage' });
  const world = sim.world;
  const households = Object.values(world.households);

  test('white and Indian families live here alongside African and Coloured ones', () => {
    const share = (hs: string[]) => households.filter((h) => hs.includes(heritageOf(h.name))).length / households.length;
    expect(share(['afrikaner', 'english'])).toBeGreaterThan(0.1);
    expect(share(['indian'])).toBeGreaterThan(0.08);
    expect(share(['coloured'])).toBeGreaterThan(0.03);
    expect(share(['nguni', 'sotho', 'tsonga'])).toBeGreaterThan(0.4);
  });

  test('every surname has a heritage, and the founding families’ first names are of their own people', () => {
    for (const h of households) expect(SURNAME_HERITAGE[h.name.replace(/ household$/, '')]).toBeDefined();
    for (const p of alivePeople(world)) {
      const pool = FIRST_NAMES[heritageOf(p.surname)][p.sex];
      expect(pool.some((n) => p.firstName === n || p.firstName.startsWith(`${n} `))).toBe(true);
      expect(p.heritage).toBe(heritageOf(p.surname));
    }
  });

  test('a woman keeps her heritage when she takes her husband’s name', () => {
    const s2 = new Simulation({ seed: 'marriages' });
    s2.runDays(365 * 5);
    const renamed = alivePeople(s2.world).filter((p) => p.heritage && p.heritage !== heritageOf(p.surname));
    for (const p of renamed) expect(p.sex).toBe('F');
  }, 240_000);

  test('Indian families look Indian: black hair, dark eyes, MakeHuman’s European set with some African; white families European', () => {
    let saris = 0;
    let churchWomen = 0;
    for (const p of alivePeople(world)) {
      const h = p.heritage;
      const { look } = dressFor(world, p, idle);
      if (h === 'indian' && p.parentIds.every((id) => world.people[id]?.heritage === 'indian')) {
        expect(look.ancestry.caucasian).toBeGreaterThan(0.6);
        expect(look.ancestry.african).toBeGreaterThan(0.1);
        if (p.age < 45) expect(parseInt(look.hairColor.slice(1, 3), 16)).toBeLessThan(0x30);
        expect(['#2c1a0e', '#3a2414', '#4a2e18']).toContain(look.eyes.toLowerCase());
        if (p.sex === 'F' && p.age >= 16) {
          churchWomen++;
          if (dressFor(world, p, { ...idle, church: true }).look.wear.some((w) => w.id === 'sari_pallu')) saris++;
        }
      }
      if ((h === 'afrikaner' || h === 'english') && p.parentIds.every((id) => ['afrikaner', 'english'].includes(world.people[id]?.heritage ?? 'afrikaner'))) {
        expect(look.ancestry.caucasian).toBe(1);
        expect(look.hair === null && look.crop === 0 && p.age >= 2).toBe(false);
      }
    }
    // Most Indian women come to church in a sari.
    if (churchWomen >= 4) expect(saris / churchWomen).toBeGreaterThan(0.4);
  });
});
