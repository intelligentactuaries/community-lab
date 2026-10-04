// The labour market (retirement, vacancies, job search) and the monthly hand-off
// to the finance engine, which posts every rand to the books: payroll and
// PAYE, grants, household budgets, the produce market, the businesses, the
// church and burial society, the Mutual Bank and SARS.

import type { Ctx } from './ctx';
import { alivePeople, clamp, fullName } from './ctx';
import { financeMonthStep, settleDeath } from './finance';
import { natural } from './finance/accounts';
import { rideLabourMarket } from './finance/transport';
import { ESSENTIAL_POSTS } from './institutions';
import { JOBS, cityOfPerson, communityOfPerson, eduAtLeast, eduRank, incomeFor, payScaleFor, refreshRoles, setJob } from './population';
import type { CityId, Household, JobId, Person } from './types';

/** Desks in a city's own offices (the towers and the government hire through their posts). */
const OFFICE_DESKS = 9;

export function economyMonthStep(ctx: Ctx, monthIndex: number): void {
  const world = ctx.world;
  const P = ctx.params;
  // ── Retirement & labour market ──
  for (const p of alivePeople(world)) {
    if (p.age >= P.retirementAge && p.job !== 'retired' && p.job !== 'child' && p.job !== 'student') {
      const old = p.job;
      setJob(ctx, p, 'retired');
      ctx.emit({ kind: 'retirement', severity: 'info', text: `${fullName(p)} has retired after years as ${JOBS[old].label.toLowerCase()}.`, personIds: [p.id] });
      p.history.push({ day: world.day, kind: 'retirement', text: `Retired (was ${JOBS[old].label}).` });
    }
  }
  refreshRoles(world);
  reviewDomesticPosts(ctx);
  fillVacancies(ctx);
  reviewDriverPartners(ctx);
  // ── The books ──
  financeMonthStep(ctx, monthIndex);
}

/**
 * E-hailing driver-partners sign up when last month paid well above what they
 * would take to drive and stop when it paid well below it (finance/transport.ts
 * decides who); the fleet finds them a car in the month's books. A driver who
 * moved house parks at the new gate.
 */
function reviewDriverPartners(ctx: Ctx): void {
  const world = ctx.world;
  rideLabourMarket(
    ctx,
    (p) => {
      setJob(ctx, p, 'unemployed');
      ctx.emit({ kind: 'job', severity: 'alert', text: `${fullName(p)} stopped driving for Hamba: the fares no longer cover the fuel and the weekly rent of the car.`, personIds: [p.id] });
      p.history.push({ day: world.day, kind: 'job', text: 'Stopped driving for Hamba.' });
    },
    (p) => {
      setJob(ctx, p, 'ehailer');
      p.driver = true;
      ctx.emit({ kind: 'job', severity: 'joy', text: `${fullName(p)} signed up as a Hamba driver-partner, renting a car from Unity Fleet Rentals.`, personIds: [p.id] });
      p.history.push({ day: world.day, kind: 'job', text: 'Signed up as a Hamba driver-partner.' });
      p.mood = clamp(p.mood + 0.2, -1, 1);
    },
  );
  for (const p of alivePeople(world)) {
    if (p.job !== 'ehailer') continue;
    const house = world.households[p.householdId]?.houseId;
    if (house && p.workplaceId !== house) p.workplaceId = house;
  }
}

/** Pay scheme benefits on a death and settle the funeral (kept under its old name for the demography module). */
export function payClaims(ctx: Ctx, p: Person): void {
  settleDeath(ctx, p);
}

/** A domestic post lasts only while the employing household can pay: retrench when the home empties or the money runs out. */
function reviewDomesticPosts(ctx: Ctx): void {
  const world = ctx.world;
  const F = world.finance;
  for (const p of alivePeople(world)) {
    if (p.job !== 'domestic' || !p.workplaceId) continue;
    const house = world.buildings[p.workplaceId];
    const hh = house?.householdId ? world.households[house.householdId] : null;
    const broke = (() => {
      if (!hh || hh.dissolvedDay) return true;
      if (!F?.entities['gov']) return false; // books not open yet
      const book = F.ledgers.books[`hh:${hh.id}`];
      if (!book) return true;
      const cash = book ? natural(book, '1020') : 0;
      return cash < p.income * 1.5;
    })();
    if (broke) {
      setJob(ctx, p, 'unemployed');
      ctx.emit({ kind: 'job', severity: 'alert', text: `${fullName(p)} was retrenched: the ${hh?.name ?? 'employing'} household can no longer afford a domestic worker.`, personIds: [p.id] });
      p.history.push({ day: world.day, kind: 'job', text: 'Retrenched from domestic work.' });
    }
  }
}

/** Fill essential vacancies and let the unemployed find work. */
export function fillVacancies(ctx: Ctx): void {
  const world = ctx.world;
  const rng = ctx.rng.stream('economy');
  const P = ctx.params;
  const people = alivePeople(world);
  // Only those present count towards an essential post: someone serving a
  // sentence or otherwise away for months cannot hold the pulpit, the surgery
  // or the bench, so the community appoints a stand-in.
  const counts: Record<string, number> = {};
  const key = (job: JobId, city: CityId) => `${job}@${city}`;
  for (const p of people) if (!p.away) counts[key(p.job, cityOfPerson(world, p))] = (counts[key(p.job, cityOfPerson(world, p))] ?? 0) + 1;
  const seekers = people.filter((p) => (p.job === 'unemployed' || (p.job === 'student' && p.age >= 18)) && !p.away && p.age < P.retirementAge);
  // Vacancies against the district's essential posts: each post is a (job, workplace)
  // pair, so Hebron Chapel losing its pastor is a vacancy even while two other
  // pastors serve elsewhere.
  const keyOf = (job: JobId, wp: string | null | undefined) => `${job}|${wp ?? ''}`;
  const held: Record<string, number> = {};
  for (const p of people) if (!p.away) held[keyOf(p.job, p.workplaceId)] = (held[keyOf(p.job, p.workplaceId)] ?? 0) + 1;
  const needed: Record<string, { job: JobId; workplace: string | null; community?: string; city?: CityId; count: number }> = {};
  for (const post of ESSENTIAL_POSTS()) {
    const wp = post.workplace ?? JOBS[post.job].workplace;
    const k = keyOf(post.job, wp);
    needed[k] ??= { job: post.job, workplace: wp, community: post.community, city: post.city, count: 0 };
    needed[k].count++;
  }
  for (const k in needed) {
    const post = needed[k];
    const spec = JOBS[post.job];
    while ((held[k] ?? 0) < post.count) {
      // Someone already in this post (an office worker at the stadium, a vendor at the mall)
      // is no candidate for it: appointing them again fills nothing and the loop never ends.
      const fits = (p: Person) => (!spec.sex || p.sex === spec.sex) && keyOf(p.job, p.workplaceId) !== k;
      const own = (p: Person) => (!post.community || communityOfPerson(world, p) === post.community) && (!post.city || cityOfPerson(world, p) === post.city);
      const qualified = seekers.filter((p) => fits(p) && p.age >= Math.max(18, spec.minAge - 4) && eduAtLeast(p.education, spec.minEducation));
      let cand = qualified.find(own) ?? qualified[0];
      if (!cand) {
        // Promote from within: an office worker or homemaker with the right education
        const promotable = people.filter((p) => !p.away && fits(p) && (p.job === 'office' || p.job === 'homemaker' || p.job === 'farmhand' || p.job === 'vendor' || p.job === 'domestic') && p.age >= spec.minAge - 2 && p.age < P.retirementAge && eduAtLeast(p.education, spec.minEducation));
        cand = (promotable.find(own) ?? promotable[0]) as Person;
      }
      if (!cand && (post.job === 'pastor' || post.job === 'shopkeeper' || post.job === 'farmer' || post.job === 'builder' || post.job === 'banker' || post.job === 'vendor' || post.job === 'farmhand' || post.job === 'clerk' || post.job === 'taxidriver')) {
        cand = (seekers.find((p) => fits(p) && own(p) && p.age >= 22) ?? seekers.find((p) => fits(p) && p.age >= 22)) as Person;
        if (cand) cand.education = eduAtLeast(cand.education, spec.minEducation) ? cand.education : spec.minEducation;
      }
      // Last resort for a post the community cannot do without: one of its own
      // steps up. For the pulpit that is a lay preacher, the elder the
      // congregation trusts most, which is how a small church actually covers
      // an absence. Nobody is pulled out of another essential post to do it.
      if (!cand) {
        const elders = people
          .filter((p) => !p.away && fits(p) && p.age >= Math.max(25, spec.minAge - 8) && p.age < P.retirementAge && JOBS[p.job].essential === 0)
          .sort((x, y) => (post.job === 'pastor' ? y.faith - x.faith : eduRank(y.education) - eduRank(x.education)));
        cand = (elders.find(own) ?? elders[0]) as Person;
        if (cand) cand.education = eduAtLeast(cand.education, spec.minEducation) ? cand.education : spec.minEducation;
      }
      if (!cand) break;
      const old = cand.job;
      const oldWp = cand.workplaceId;
      setJob(ctx, cand, post.job, post.workplace ?? undefined);
      held[k] = (held[k] ?? 0) + 1;
      held[keyOf(old, oldWp)] = (held[keyOf(old, oldWp)] ?? 1) - 1;
      const i = seekers.indexOf(cand);
      if (i >= 0) seekers.splice(i, 1);
      ctx.emit({ kind: 'job', severity: 'joy', text: `${fullName(cand)} takes up the post of ${spec.label.toLowerCase()}${post.workplace ? ` at ${world.buildings[post.workplace]?.name ?? post.workplace}` : ''}.`, personIds: [cand.id] });
      cand.history.push({ day: world.day, kind: 'job', text: `Appointed ${spec.label}.` });
    }
  }
  // General job search, in the seeker's own city: its offices, its market front, its workshop, its fields.
  for (const p of seekers) {
    const eduF = eduAtLeast(p.education, 'tertiary') ? 2 : eduAtLeast(p.education, 'matric') ? 1.2 : 0.7;
    const pFind = (P.healthProfile === 'developed' ? 0.18 : 0.07) * eduF * (0.6 + 0.8 * p.big5.C);
    if (!rng.bernoulli(clamp(pFind, 0, 0.6))) continue;
    const city = cityOfPerson(world, p);
    let job: JobId | null = null;
    if ((counts[key('office', city)] ?? 0) < OFFICE_DESKS && eduAtLeast(p.education, 'matric')) job = 'office';
    else job = rng.weighted<JobId | null>([['vendor', 0.35], ['farmhand', 0.35], ['builder', 0.15], [null, 0.15]]);
    // The workshop and the market front can only carry so many: the rest go to the fields.
    if (job === 'builder' && (counts[key('builder', city)] ?? 0) >= 2) job = 'farmhand';
    if (job === 'vendor' && (counts[key('vendor', city)] ?? 0) >= 3) job = 'farmhand';
    if (!job) continue;
    setJob(ctx, p, job);
    counts[key(job, city)] = (counts[key(job, city)] ?? 0) + 1;
    ctx.emit({ kind: 'job', severity: 'joy', text: `${fullName(p)} found work as ${JOBS[job].label.toLowerCase()}.`, personIds: [p.id] });
    p.history.push({ day: world.day, kind: 'job', text: `Started work as ${JOBS[job].label}.` });
    p.mood = clamp(p.mood + 0.3, -1, 1);
  }
  // Income refresh with age (experience)
  for (const p of people) if (p.income > 0 && world.day % 365 < 31) p.income = Math.max(p.income, Math.round(incomeFor(rng, p.job, p.education, p.age) * payScaleFor(p.job, p.workplaceId)));
  refreshRoles(world);
}

export function householdOf(ctx: Ctx, p: Person): Household | undefined {
  return ctx.world.households[p.householdId];
}
