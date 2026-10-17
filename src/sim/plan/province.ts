// The built-in Unity Province as a plan: every building kept as drawn (raw),
// every institutional choice stated. Opening it in the builder is how the
// province is customised; run unaltered, it is recognised by its hash and runs
// as the built-in province itself.

import type { Atlas } from '../atlas';
import type { Facing } from '../layout/builders';
import { PROVINCE_ID, provinceAtlas } from '../layout/province';
import type { Building } from '../types';
import { planHash } from './hash';
import { PLAN_FORMAT, type PlanBuilding, type WorldPlan } from './types';

/** The asset a hand-drawn building stands for (what the builder shows and can redraw it as). */
export function guessAsset(b: Building, a: Atlas): string {
  const biz = a.businesses.find((x) => x.id === b.id);
  switch (b.kind) {
    case 'house':
      return b.w >= 70 ? 'house-large' : b.w <= 48 ? 'house-small' : 'house';
    case 'market':
      if (a.spazaIds.includes(b.id)) return 'spaza';
      if (a.deliIds.includes(b.id)) return 'deli';
      if (a.marketIds.includes(b.id)) return 'market';
      return biz && (biz.localFood ?? 1) === 0 ? 'pharmacy' : 'market';
    case 'office':
      if (biz?.kind === 'practice') return 'chambers';
      if (b.w <= 40 && b.h <= 40) return 'tower';
      return 'office';
    case 'govt':
      return b.w >= 140 ? 'govt' : 'post';
    case 'workshop':
      if (biz?.kind === 'taxi') return 'taxi';
      if (a.ambulanceBases.some((x) => x.id === b.id)) return b.id.startsWith('ap-') ? 'airport-fire' : 'ambulance';
      return 'workshop';
    case 'park':
      if (b.w >= 240 && b.h >= 140) return 'grandpark';
      if (b.rooms.some((r) => r.name === 'Square')) return 'plaza';
      return 'park';
    case 'terminal':
      return 'airport-terminal';
    default:
      return b.kind;
  }
}

/** Which way a building's door faces: the side its entrance is on. */
export function facingOf(b: Building): Facing {
  const e = b.entrance;
  const dN = Math.abs(e.y - b.y);
  const dS = Math.abs(e.y - (b.y + b.h));
  const dW = Math.abs(e.x - b.x);
  const dE = Math.abs(e.x - (b.x + b.w));
  const m = Math.min(dN, dS, dW, dE);
  return m === dS ? 'S' : m === dN ? 'N' : m === dE ? 'E' : 'W';
}

let cached: WorldPlan | null = null;
let cachedHash = '';

/** Unity Province as an editable plan (a fresh copy each call). */
export function provincePlan(): WorldPlan {
  if (!cached) {
    const a = provinceAtlas();
    const bs = a.buildings();
    const buildings: PlanBuilding[] = Object.values(bs).map((b) => ({
      id: b.id,
      asset: guessAsset(b, a),
      name: b.name,
      settlement: b.community,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      facing: facingOf(b),
      ...(b.plot != null ? { plot: b.plot } : {}),
      raw: b,
    }));
    cached = {
      format: PLAN_FORMAT,
      id: PROVINCE_ID,
      name: 'Unity Province',
      region: 'Unity',
      description: 'Three cities, the centre they share and the airport: the built-in province.',
      size: { w: a.width, h: a.height },
      cities: a.cities.map((c) => ({ id: c.id, name: c.name, short: c.short, kind: c.kind, x: c.x, y: c.y, w: c.w, h: c.h, faith: c.faith, religious: c.religious, blurb: c.blurb, ...(c.tagline ? { tagline: c.tagline } : {}) })),
      settlements: a.communities.map((c) => ({ id: c.id, city: c.city, name: c.name, short: c.short, tier: c.tier, x: c.x, y: c.y, w: c.w, h: c.h, households: c.seedHouseholds, seedOrder: c.seedOrder })),
      roads: a.segments.map((s) => ({ name: s.name, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, ...(s.width ? { width: s.width } : {}) })),
      buildings,
      track: a.track.map((p) => ({ ...p })),
      busLines: a.busLines.map((l) => ({ ...l, stops: [...l.stops] })),
      baseline: a.baseline,
      defaultSettlement: a.defaultCommunity,
      institutions: {
        settlementLandmarks: a.settlementLandmarks,
        cityLandmarks: a.cityLandmarks,
        regionLandmarks: a.regionLandmarks,
        houseLandmarks: a.houseLandmarks,
        fallbackCity: a.fallbackCity,
        churchIds: a.churchIds,
        clinicIds: a.clinicIds,
        courtIds: a.courtIds,
        policeIds: a.policeIds,
        councilIds: a.councilIds,
        taxiRankIds: a.taxiRankIds,
        centralHospital: a.centralHospital,
        ambulanceBases: a.ambulanceBases,
        airportTerminal: a.airportTerminal,
        busHub: a.busHub,
        stations: a.stations,
        runway: a.runway,
        exits: a.exits,
        businesses: a.businesses,
        publicWorkplaces: a.publicWorkplaces,
        spazaIds: a.spazaIds,
        marketIds: a.marketIds,
        deliIds: a.deliIds,
        counterIds: a.counterIds,
        bankHq: a.bankHq,
        chambersByCity: a.chambersByCity,
        combankByCity: a.combankByCity,
        essentialPosts: a.essentialPosts,
        jobSites: a.jobSites,
        produceMarket: a.produceMarket,
        produceFarm: a.produceFarm,
        venues: a.venues,
        publicServicesCost: a.publicServicesCost,
        publicServicesMemo: a.publicServicesMemo,
        marketScale: a.marketScale,
        ownerNames: a.ownerNames,
      },
    };
    cached = JSON.parse(JSON.stringify(cached)) as WorldPlan;
    cachedHash = planHash(cached);
  }
  return JSON.parse(JSON.stringify(cached)) as WorldPlan;
}

/** The fingerprint of the unaltered province plan (a plan with this hash runs as the built-in province). */
export function provincePlanHash(): string {
  if (!cached) provincePlan();
  return cachedHash;
}
