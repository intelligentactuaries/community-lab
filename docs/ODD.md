# Community Lab — model description (ODD protocol)

This follows the ODD protocol for describing agent-based models (Grimm et al.
2006; 2010; second update Grimm et al. 2020, *JASSS* 23(2):7): **Overview**
(purpose and patterns; entities, state variables and scales; process overview
and scheduling), **Design concepts**, **Details** (initialisation; input data;
submodels).

## 1. Purpose and patterns

**Purpose.** A life-course microsimulation of a small province — three cities of
three settlements each around a shared centre, with an airport — animated so
that the mechanisms behind aggregate demographic, health and financial
outcomes can be watched at the level of the individual and the household. The
intended users are actuaries and social scientists who want to (i) see a
published mortality/fertility basis play out in a population they can inspect,
(ii) measure actual-vs-expected experience with the usual exposure bookkeeping,
(iii) stress a small insurance scheme, and (iv) run replications.

**Patterns used for evaluation.** The model is judged realistic enough for its
purpose when, over many replications under the default South African basis:
(a) the pooled mortality A/E is ≈ 1 with Poisson-consistent dispersion;
(b) realised births are ≈ the ASFR basis (births A/E ≈ 1) and the realised
ASFR keeps the 20–29 plateau; (c) illness incidence shows the winter
respiratory / summer gastro seasonality; (d) the population pyramid keeps a
young base with attrition of 18–30-year-olds to out-migration; (e) the daily
rhythm reproduces work/school hours, Sunday worship with after-service
fellowship, and night quiet. (a)–(c) are reported directly in the analytics
drawer; the Monte Carlo tab reports (a) and (b) across seeds.

## 2. Entities, state variables and scales

* **Persons** — id, names, sex, birth day, age, life stage, household, Big Five
  vector, archetype/shape, education, schooling, job and workplace, income,
  marital status and partner, parents/children, health (state, vitality,
  illnesses, chronic conditions, ward/rest days), mood, stress, faith,
  reputation, criminal record, pregnancy, grief, relationships (kind and
  strength to other persons), location, today's plan, path, vehicle, alive /
  emigrated / away flags, life history.
* **Households** — members, head, house, savings (a mirror of the deposit
  account in the household's books), debt, monthly income/expenses, vehicle,
  insurance holdings, homeschooling, faith, poverty flag, arrears, monthly
  ledger.
* **Books** — one set of double-entry books per economic entity (households,
  shop, farm, workshop, co-operative, church, burial society, Mutual Bank,
  the taxi associations, Unity Transit, the Hamba e-hailing app, Unity Fleet
  Rentals, the airport company, government, rest of the economy): balances by
  account, monthly movements, cash-flow classes, annual closes; one
  hash-chained general journal.
* **Markets and transport** — Brent, the rand, the regulated pump prices and
  their build-up, the fuel levies and any relief, the electricity tariff; the
  fare cards (taxi, bus, Hyperline, Hamba's rate card and tariff index, the
  airline's fare and surcharge, the airport's charges), the rental fleet's cars
  and weekly rent, the driver-partners waiting for a car, each household's
  e-hailing share, the monthly transport record (spend and trips by mode, the
  e-hailing market's clearing, Unity Transit's fare box and grant, the
  airport's traffic); the Monetary Policy Committee's decisions and votes.
* **Mutual Bank** — loans (purpose, rate, term, instalment, arrears, IFRS 9
  stage, provision), member shares, rates, prudential rules and quarterly
  returns.
* **SARS** — tax tables in force, returns filed, individual and business
  years of assessment, compliance status by taxpayer.
* **Macro and micro series** — CPI, repo, wage index, national accounts by
  month, AD–AS by quarter; produce-market clearings, labour snapshot, Engel
  rows.
* **Cities and settlements** — the province is three cities (Emmaus, rich and
  church-going; Newhaven, secular; Ithemba, poor and church-going) of three
  residential settlements and a civic centre each, plus Unity Centre between
  them (the hospital campus, the CBD with Government House, the Reserve Bank,
  the provincial police, the mall and the terminus, and Unity Park with the
  stadium, concert hall, Grand Park and sports centre) and, south-east of the
  centre, Unity Provincial Airport (terminal, control tower, hangar, fire &
  rescue, a 1.6 km runway, its own Hyperline station and bus stop). Every settlement has a
  wealth tier (the estates, affluent, comfortable, middle, working, low-income)
  that drives its households' education, cars, cover, savings and job mix, and
  every city its own council, school, clinic, police station, court, medical
  centre, cemetery, hall, taxi rank and shops. Newhaven has no church, mosque or
  temple.
* **Buildings** — kind (house, church, school, clinic, police, court, market,
  hall, farm, office, workshop, bank, cemetery, park, bus stop, library,
  hospital, government, reserve bank, mall, stadium, concert hall, sports
  centre, terminus, towers, station, terminal, hangar, runway), footprint,
  entrance, rooms with furniture spots, road node. 124 plots (100 occupied at
  start).
* **Road network** — nodes and edges: each city's streets and arterials, the
  N1 between the northern cities, Central Avenue from the north exit through
  the campus, the CBD and the park to Ithemba, Unity Boulevard through the CBD,
  and the western and eastern ring roads down to Ithemba's gates (four province
  exits), Airport Road off the eastern ring road. Every building reaches every
  other and every exit.
* **The Hyperline** — a 7.7 km elevated guideway (its own polyline, not part
  of the road graph; it crosses roads on viaducts and no building) with five
  stations in line order: Emmaus, Unity Central, Ithemba, Airport, Newhaven.
* **Vehicles** — household cars/bakkies (a further car per driver in the
  wealthier tiers), a patrol car at every police station, ambulances at the
  clinics, two at the hospital's EMS station and one at the airport, four
  minibus taxis at every rank (one per city and the central terminus), two
  buses on each of four lines (each city's stops → the hospital or the park →
  the terminus; the airport shuttle), two Hyperline trains and two aeroplanes.
  Buses and taxis run on the road graph; trains on the guideway; planes taxi
  from the apron to the runway and are off the map while airborne. Road
  vehicles keep to the left-hand lane and a car's length behind whatever is
  ahead of them; they park in bays on the verge beside a building (a lay-by
  at a bus stop, never across a gate), in their own yard at home, and in a
  row across the depot at the terminus, one vehicle to a bay.
* **Conversations, intruders, incidents, court cases, gatherings** — transient
  collectives and events with their own state.
* **Environment** — calendar (real Gregorian, public holidays, school terms),
  daily weather, insurance ledger, statistics accumulators.

**Scales.** Space: a 4.4 × 3.4 km province in metres; the cities are 2–5 km
apart by road. Time: minutes; micro
(animated) mode steps movement at up to one minute; all demographic, health,
social and economic processes run in a **day step** at 00:00; economics,
nuptiality and migration on the first of each month; summaries on each
anniversary. Horizon: typically 30 years; nothing in the engine limits it.

## 3. Process overview and scheduling

Every simulated day at 00:00, in this order:

1. weather for the day;
2. ageing and life-course transitions (school entry, matric, tertiary
   departure, retirement);
3. illness: care-seeking, admission, progression, recovery, death; new onsets;
   chronic onsets; vitality drift;
4. table mortality on the basis × individual multipliers;
5. pregnancy progression and births; conception rolls (one per woman per
   month);
6. on the 1st of the month: nuptiality (divorce, courtship progress, new
   courtships), migration (youth out, in-migrants into vacant houses, prisoner
   returns), economy (retirement, vacancies, job search, incomes, grants,
   expenses, savings, premiums, scheme ledger);
7. on the anniversary: yearly summary;
8. social dynamics (mood, stress, grief, relationship decay; in time-lapse mode
   the co-presence upkeep that animation would otherwise provide), daily
   dispute rolls and their resolution;
9. security: schedule the day's intruders (resolved statistically in
   time-lapse mode, or animated in micro mode), the court roll, road accidents;
10. gatherings due today (funerals place the grave; weddings marry the couple
    and form the household);
11. exposure-to-risk bookkeeping (person-years and expected deaths/births by
    age band and sex);
12. daily plans for everyone; court attendance overrides; Sunday attendance
    count.

In micro mode, between day steps, each simulated minute: activity transitions
and path following, vehicle motion, conversation formation and lines, intruder
motion, detection and response.

## 4. Design concepts

* **Basic principles.** Competing-risk hazards on published bases (Heligman–
  Pollard mortality, ASFR fertility); needs-and-schedule agent behaviour;
  exposure-based experience analysis; common random numbers.
* **Emergence.** Population structure, household formation and dissolution,
  the friendship network, the scheme's surplus path, crime response outcomes.
* **Adaptation / objectives.** Agents follow role- and age-specific daily
  routines with stochastic variation; they seek care when ill, seek work when
  unemployed, court when single, and respond to intruders according to
  personality and role. There is no explicit utility maximisation.
* **Learning / prediction.** None beyond relationship strength updating.
* **Sensing.** Residents detect intruders within a kind-specific radius,
  modulated by sleep, darkness and the sentinel archetype.
* **Interaction.** Conversations (procedural, or scripted by a language model
  on demand), disputes and mediation, infection within households and school,
  policing, court, gatherings.
* **Stochasticity.** Every process draws from a named xoshiro128** stream
  seeded from the scenario seed, so scenarios differ only where their
  assumptions differ.
* **Collectives.** Households, the congregations (six, in two of the three
  cities), the city councils, the scheme, fellowship groups, a match crowd.
* **Observation.** Event ledger; monthly snapshots; exposure tables; A/E with
  Poisson intervals; realised ASFR/TFR; experience-adjusted e0; illness
  seasonality; incident and court rolls; scheme surplus process; Monte Carlo
  percentiles. All exportable as CSV with the basis hash. An actuarial
  workbench (`src/sim/actuarial/`) reads the same state: the theory of
  interest on the province's rates, life contingencies and commutation
  functions on the table, the society's pricing and classical risk theory
  (adjustment coefficient, Lundberg, a simulated surplus and a one-year
  99.5 % capital requirement), a cohort-component projection, a
  defined-contribution retirement projection and the old-age grant's
  closed-group liability.

## 5. Initialisation

Households are composed by type (family, couple, single parent,
multigenerational, elderly, single) with weights from the chosen age profile;
adults receive Big Five draws, education from their settlement tier's mix,
and jobs — essential posts first, city by city (a pastor per congregation, a
district medical officer, doctor, two nurses, three teachers, three police
officers, magistrate and clerk, a shopkeeper and a bank clerk per settlement,
two taxi drivers, farmer, builder, vendor, farm worker, and the chambers and
commercial bank where a city has them) and then the centre's (two surgeons, a
doctor and four nurses at the hospital, Reserve Bank officers, civil servants,
the provincial police, the mall's staff, the stadium's and the hall's, the
terminus's taxi and bus drivers, two pilots at the airport, the regional
chambers and the executives in the towers),
each filled from the post's own settlement or city where anyone qualifies —
then the tier's employment mix. Chronic conditions are drawn from prevalence by age and sex;
relationships are seeded (kin, neighbours, colleagues, friends by homophily);
cars, savings and cover are assigned; everyone starts asleep at home, a
husband and wife in one bed (the head of the house and their spouse in the
main bedroom's double bed), everyone else in a bed of their own for as long as
the house has beds to go round.

## 6. Input data

Only parameters (`src/sim/params.ts`) and the tables in `docs/ASSUMPTIONS.md`;
no time-series input is read during a run. A custom q_x table can be supplied
in place of a preset.

One **operator intervention** is available from the interface: the weather of a
day (or of every day until released) can be forced from the scene controls, so
a storm, a heat wave or a cold snap can be put to the community on demand
rather than waited for. It is applied after generation, never touches the
season (which stays derived from the calendar month), and is written into the
event ledger with `data.forced = true` so a run's history says plainly where
its weather came from. Jumping the clock is not an intervention: every day in
between is simulated exactly as it would have been.

## 7. Submodels

Documented in the source with their provenance: `mortality.ts`,
`fertility.ts`, `demography.ts` (ageing, deaths, births, nuptiality,
migration, gatherings), `health.ts`, `social.ts` (mood, relationships,
conversations, disputes), `security.ts` (intruders, police, court, road
accidents), `economy.ts` (labour market, grants, scheme), `schedule.ts`
(daily routines, and the childcare pass that leaves no child under ten
without someone of fourteen or more), `movement.ts` (routing, cars, taxis, ambulances),
`transit.ts` (the bus lines, the Hyperline and the planes), `weather.ts`,
`stats.ts` (exposure and A/E), `batch.ts` (replications); `world.ts` and
`layout/` (the province's geography, the guideway and the airport),
`institutions.ts` (what each building is for, who staffs it and how its books
run).

### 7.x Economy and finance (`src/sim/finance/`)

On the first of each month, after retirement and the labour market: (1) the
year-end close if the tax year ended (second provisional tax payments, closing
entries, the bank's reserve transfer and dividends, the co-operative's surplus
distribution, owner dividends, indexation of tables, wages, grants and the
minimum wage); (2) the previous month's book snapshots and journal digest;
(3) the first Wednesday: the Budget's fuel-levy change and NERSA's tariff in
April, relief granted or ended, this month's pump prices from last month's
import parity, and the month's oil and rand; (4) national core and headline
inflation and, every second month, the Monetary Policy Committee's vote on the
repo rate; the rental fleet finds a car for every driver-partner (vehicle
finance from the Mutual Bank); (5) payroll with PAYE, UIF and SDL by employer
(Unity Transit pays the bus drivers, the airline the pilots); SASSA grants;
council stipends; public-service purchases; (6) household budgets (needs,
consumption, tithes, premiums, loan service; a living-costs loan or a cut in
spending when short; the driver-partners' expected take-home); (7) the
transport plan: fare reviews, Hamba's rate card from its costs and the state
of demand, each household's transport budget and mode shares (a logit on
generalised minutes), and the e-hailing market cleared by the surge; (8) the
produce market clears between the farm and the shop; (9) consumption posted
by category with VAT, fuel levies and rates, transport by mode; (10) cars,
home improvements; (11) the businesses' purchases, sales, depreciation,
investment; the taxi associations' diesel at the pump; the transport
operators (the app's payouts, the drivers' fuel and rent, the fleet's running
costs and disposals, Unity Transit's running costs and operations grant, the
airport company's charges and costs, business air travel); working-capital
and equipment loans; the church's costs and benevolence; the society's
administration; (12) the bank's month-end
(deposit interest, instalments, staging, write-offs, provisions, treasury
placement, preference dividend, quarterly prudential return); (13) SARS
filings (EMP201, VAT201, provisional tax, penalties and interest) and, in
July, the tax season assessments; (14) fiscal balancing with the national
fiscus, the national accounts, labour and Engel snapshots, and the mirrors the
rest of the engine reads (household savings and debt, the society's reserve).
Deaths, fines, thefts, funerals and household formation post to the books as
they happen through hooks (`settleDeath`, `hhPayOut`, `householdOpened`,
`householdClosed`, `farmLoss`). All parameters and their provenance are in
`docs/ASSUMPTIONS.md` ("Economy and finance").
