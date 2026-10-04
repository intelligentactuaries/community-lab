# Assumption basis and provenance

Every rate in Community Lab is an explicit input (`src/sim/params.ts`) or a
documented constant in the submodel that uses it. This file records where each
default comes from, how it was calibrated, and what is a proxy. The whole
parameter set is hashed (`basisHash`) and printed on every export so a result
can always be tied back to its basis.

Dates are "last checked" dates for the source.

## Mortality (`src/sim/mortality.ts`)

**Law.** Heligman–Pollard (1980) eight-parameter law

    q_x = A^((x+B)^C) + D·exp(−E·(ln x − ln F)²) + G·H^x / (1 + G·H^x)

(the form used in the Bayesian HP literature and the R package `HPbayes`).
Terms: infant/child decline (A,B,C), young-adult hump — accidents, violence and,
in South Africa, HIV (D,E,F) — and senescent Gompertz mortality (G,H).

| Preset | Male A,B,C,D,E,F,G,H | Female | Implied e0 M/F · IMR · U5MR |
|---|---|---|---|
| `sa-2024` (default) | 0.0122, 0.7754, 0.6774, 0.005906, 3.4, 38, 0.0001256, 1.0885 | 0.01561, 0.8563, 0.5009, 0.005869, 2.6, 40, 0.00001868, 1.1092 | 63.6 / 69.2 · 24.6 / 21.3‰ · 26.9 / 26.0‰ |
| `agincourt-2005-07` | 0.0262, 0.7754, 0.2083, 0.1199, 3.7761, 42.261, 0.0009, 1.0827 | 0.0356, 0.8563, 0.2373, 0.0867, 2.5266, 40.6617, 0.0001, 1.1092 | 50.8 / 55.8 (paper: 52.2 / 59.4) |
| `agincourt-1994-97` | 0.0106, 0.7829, 0.0855, 0.0243, 5.2779, 45.2412, 0.001, 1.0798 | 0.0148, 0.7852, 0.1048, 0.0126, 14.5269, 31.1959, 0.0003, 1.0958 | 65.5 / 70.7 (paper: 67.3 / 73.5) |
| `developed-2020` | 0.0003348, 0.03, 0.1108, 0.001029, 9, 22, 0.00001774, 1.107 | 0.0003268, 0.03, 0.1013, 0.000001, 9, 22, 0.000008405, 1.112 | 79.0 / 83.9 · 4.4 / 3.6‰ |

* **Agincourt presets** are the posterior medians in Sharrow, Clark, Collinson,
  Kahn & Tollman (2013), *The age pattern of increases in mortality affected by
  HIV: Bayesian fit of the Heligman-Pollard model to data from the Agincourt
  HDSS field site in rural northeast South Africa*, Demographic Research 29(39),
  PMC3896243 — a real rural South African community before and after ART. The
  paper fits **n-year interval probabilities** (1q0, 4q1, then 5qx); the engine
  converts them to single-year q_x with q = 1 − (1 − nqx)^(1/n). The implied
  life expectancies land within 1.5–3.5 years of the paper's own life-table
  values, which validates the transcription.
* **`sa-2024`** keeps the Agincourt 2005-07 *shape* and re-solves A (infant
  mortality), C (under-five decline), G (senescence) and D (hump level) by
  bisection (`scripts/calibrate.ts`) to Statistics South Africa, *Mid-year
  population estimates 2024* (P0302, checked 2026-08): e0 63.6 (M) / 69.2 (F),
  IMR 22.9‰, U5MR 28.6‰. Targets by sex used IMR 24.5 / 21.3‰, U5MR 30.5 / 26.6‰,
  e65 13.0 / 16.2 (UN WPP-style values for SA, proxy).
* **`developed-2020`** is illustrative: HP parameters in the range reported for
  low-mortality populations, calibrated to e0 79 / 84, IMR 4.4 / 3.6‰, e65 18.5 / 21.5.
* **Mortality improvement** (`mortalityImprovement`, default 1 %/yr) scales the
  whole table geometrically with elapsed years — a Lee–Carter-style drift.
* **Daily hazard.** p_day = 1 − (1 − q_x)^(1/365.25); age 0 is front-loaded so
  ≈ 55 % of infant deaths are neonatal (first 28 days).
* **Individual multipliers** (`health.ts`): untreated HIV ×4.5, HIV on ART ×1.4,
  cardiovascular disease ×1.4, diabetes ×1.3, hypertension ×1.15, COPD ×1.3,
  disability ×1.2; vitality term (1.6 − 0.8·v); bereavement ×1.6 in the first
  year of widowhood (Elwert & Christakis 2008 report ≈ 1.2–1.9 depending on
  cause, proxy); household poverty ×1.15 (proxy).
* **How the multipliers are applied** (`demography.ts`). The table already
  embeds the population-average prevalence of these risk factors, so applying
  the multipliers raw would double-count them and — because the elderly
  accumulate conditions — bend A/E upward with age. Each day every person's
  multiplier is therefore divided by the **realised mean multiplier of their
  age band**: the factors redistribute risk *within* a band and leave the
  band's expected deaths on the table (a lone person in a band gets exactly
  the table hazard).
* **Table share by age.** Illness episodes (heart attacks, strokes,
  pneumonia, cancer, falls, infections; case-fatality scaled by
  `ILLNESS_FATALITY_SCALE` = 0.78) produce their own deaths on top. Their
  contribution rises with age exactly as real cause-of-death mixes do (measured
  with `scripts/diag-bands.ts`: ≈ 7 % of the table hazard at 25–34, ≈ 30 % at
  65–74, ≈ 55 % at 75+), so only a share of the table hazard is applied
  directly — `tableShare(age)`: 0.85 under 15, 0.90 at 15–44, 0.88 at 45–54,
  0.78 at 55–64, 0.70 at 65–74, 0.50 at 75–84, 0.45 at 85+ — times a global
  factor `MULTIPLIER_NORMALISER` = 0.9.
* **Calibration result** under the default basis: 24 fresh seeds × 20 years
  gave 237 deaths against 236.5 expected on 23,326 person-years (**A/E 1.00**;
  31 % of deaths from illness episodes), and 16 seeds × 30 years gave a flat
  profile by band — 35–44: 0.93, 45–54: 1.03, 55–64: 0.92, 65–74: 1.00,
  75–84: 1.00, 85+: 0.97 (overall 0.96). A single run's A/E is experience and
  is reported with a Poisson 95 % interval. Re-check after touching any of
  these constants: `bun scripts/diag.ts 24 20 x` and
  `bun scripts/diag-bands.ts 16 30 x` (both accept `COMMUNITY_MORT_NORM` and
  `COMMUNITY_ILLNESS_SCALE` environment overrides for experiments).
* **Cause of death** for table deaths is sampled from an age/sex cause mix
  modelled on Stats SA *Mortality and causes of death* (proxy weights).

## Fertility (`src/sim/fertility.ts`)

* **Level.** TFR 2.41 — Stats SA P0302 2024, Table 2.
* **Shape.** A South African ASFR profile per 1,000 women: 15-19: 60, 20-24:
  120, 25-29: 118, 30-34: 88, 35-39: 50, 40-44: 15, 45-49: 3 (proxy shape,
  scaled to the published TFR; the Census 2022 ASFR had not been released for
  use when Stats SA published P0302 2024).
* **Partnership multipliers.** married ×1.4, courting/engaged ×1.0, single ×0.6,
  normalised over a 50/15/35 mix; ≈ 60 % of South African births are to unmarried
  mothers (Stats SA *Recorded live births*), so single women's fertility cannot
  be a small residual even in a church community. The level is further divided
  by 1.35 to offset pregnancy and post-partum non-susceptibility and partner
  absence (which the per-woman-year ASFR averages over). Post-partum ×0.2 for 9 months; parity ≥ 4
  ×0.5, ≥ 6 ×0.3; tertiary education ×0.85; vitality (0.6 + 0.4·v).
* Gestation N(266, 9) days; twins 1.6 %; stillbirth 2 %; maternal mortality
  0.11 % per birth (SA MMR ≈ 100–120 per 100,000, NDoH); developed profile ×0.15.
* Calibration: with the 1.35 correction, 32 seeds × 20 years gave 570 births
  against 564 expected on the ASFR basis (births A/E 1.01; other 24-seed sets
  gave 0.92, 0.94 and 1.01). Realised births are always reported against the basis
  as a births A/E.

## Nuptiality

* Courtship hazard peaks at `marriageAgeM` − 1 / `marriageAgeF` − 1 (defaults
  30 / 27) with a bell of σ = 6 years; level `courtshipHazard` = 0.28 / yr at
  the peak. Stats SA *Marriages and divorces 2023* (P0307): median age at first
  civil marriage 38 (grooms) / 34 (brides), crude marriage rate 2.1 per 1,000;
  the community defaults are earlier because customary and religious unions
  are under-recorded in civil statistics (proxy).
* Courtship → engagement monthly 12 % × compatibility; break-ups 5 %/month
  courting, 2 %/month engaged; weddings 45–135 days after engagement, on a
  Saturday, at the church, reception at the hall.
* Divorce hazard 0.6 %/yr × strain, ×0.6 for devout couples, ×1.6 for
  lukewarm ones (22,230 divorces in 2023, Stats SA P0307; proxy conversion to a
  couple-year hazard).
* Widow(er)s and the divorced wait a year before courting again.

## Health (`src/sim/health.ts`)

Annual attack rates before age/season/condition modifiers:

| Illness | Rate | Source / note |
|---|---|---|
| influenza | `fluAttackRate` 12 %/yr, winter ×2.2, children ×1.6 | WHO / NICD ILI surveillance: 5–15 % adults, higher in children |
| common cold | 1.6/yr | proxy |
| gastroenteritis | 35 %/yr (developed 15 %), summer ×1.6, under-5 ×2.2 | proxy |
| pneumonia | 1.2 %/yr adults, 4 % under-5, 5 % 65+; ×4 untreated HIV; ×3 after flu | GBD 2021 SA, proxy |
| tuberculosis | 0.6 %/yr adults, ×8 untreated HIV, ×3 on ART, ×1.6 poor | WHO Global TB Report 2024: SA ≈ 615 per 100,000 |
| heart attack | 0.45 %/yr at 40, doubling per decade; ×1.8 hypertension, ×2.2 CVD, ×1.6 diabetes | GBD-style age doubling, proxy |
| stroke | 0.3 %/yr at 40, doubling per decade; ×2.5 hypertension | proxy |
| cancer | 0.2 %/yr at 45, doubling per decade | proxy |
| childhood infection | 35 %/yr under 5 (developed 15 %) | proxy |
| injury | occupational hazard by job (0.5–9 %/yr) + 5 %/yr children | proxy |
| fracture (fall) | 6 %/yr 75+, 2.5 % 65+ | proxy |
| respiratory virus | 6 %/yr | endemic post-pandemic, proxy |

Treatment: care-seeking (55 % + 40 % × severity, ×1.15 medical aid, ×0.75
poor) shortens the episode by 35 % × `careQuality` and cuts case fatality by
80 % × `careQuality`; the clinic ward has 6 beds. Chronic condition prevalence
at start uses SADHS 2016 / Stats SA NCD 2022 / HSRC SABSSM 2024 values (see
`conditionPrevalence`); hypertension incidence 2 %/yr after 30, diabetes
0.7 %/yr; HIV incidence 0.25–0.6 %/yr for ages 15–49 (married vs single), ART
uptake 40 %/yr when the doctor is present.

## Society

* Personality: Big Five ~ N(0.5, 0.16) clipped; children inherit half the
  mid-parent value (heritability ≈ 0.5). Shapes follow the dominant trait
  (circle = agreeableness, square = conscientiousness, triangle = extraversion,
  hexagon = openness, diamond = neuroticism, pentagon = none dominant) — the
  shape vocabulary of Dellinger's Psycho-Geometrics, on a Big Five engine.
* Disputes: `disputeRate` 25 per 100 residents per year, scaled by conflict
  proneness (0.45·(1−A) + 0.35·N + 0.2·E·(1−C)), stress, poverty and mood;
  resolved by talking (agreeableness), pastoral mediation (faith), or a fight
  (police, court).
* **The pastorate.** This congregation holds the **complementarian** position,
  so the pastor is a man (`JOBS.pastor.sex = 'M'` in `population.ts`; the
  restriction is enforced at initialisation and at every later vacancy). It is
  the only role in the community restricted by sex. While he is leading a
  service he preaches continuously: the sermon is one conversation that gains a
  line every two simulated minutes, so a speech bubble stands over the pulpit
  for the whole service.
* **Hymns.** Every twenty minutes or so of a service the pastor calls a hymn
  from an eight-hymn book (all long out of copyright, `Nkosi Sikelel' iAfrika`
  among them) and the room sings a verse, a line every two minutes on the same
  beat as the sermon. A hymn waits for a congregation — under eight in the pews
  he preaches on rather than sing to an empty church. Who joins in is rolled per
  person per hymn at 0.7 + 0.22·faith + 0.1·E + 0.08·mood − 0.12·stress, less
  0.12 if unwell, 0.1 if grieving and 0.25 under seven; under-threes and the
  critically ill do not sing, and latecomers join the verse in progress.
  Whatever the rolls, **at least 70 % of the pews sing every hymn**: if they
  fall short, the likeliest of the silent are carried along (deterministically,
  by propensity), the way a hesitant voice is once the room is going. Measured
  over three seeds' Sunday mornings: **mean ≈ 91 % of those in the pews sing**,
  per-hymn range 70-100 %, five hymns per church per morning. A verse sung through lifts each singer's
  mood by 0.03 and eases stress by the
  same — singing together is one of the few things a whole community does at
  once. On the map every voice carries a ♪ and a rotating handful carry the
  words, so a hymn reads as the room rather than as the pastor.
* **Fellowship.** After the service the congregation breaks up across the
  fellowship hall (45 %), the churchyard (30 %) and the nave (25 %) and mingles:
  everyone who is free is drawn into the nearest group or paired with the
  nearest free neighbour, groups run to three, and pairs re-form as
  conversations end. Measured at ~11:25 across three seeds: **34/38, 41/47 and
  40/46 in conversation** (≈ 89 %) in 15-18 groups. Fellowship talk is warm
  (0.6), prayerful (0.25) or news-trading (0.15) - never quarrelsome; quarrels
  arise at home, at work and between neighbours, and are brought to the pastor.
* **Church attendance.** `churchAttendance` 0.95 — this is a professing
  Christian community, so the Sunday service is close to universal. The
  decision is made by the **household** (families go together or not at all)
  and individuals then follow at 0.985, with the very small (0.9) and the
  mildly unwell (0.7) as the usual exceptions; someone whose household stayed
  home still attends alone with probability 0.3 x their own faith, and the
  bed-bound, hospitalised and away cannot attend. Realised attendance over
  156 simulated Sundays: **mean 91.8 %**, weekly range 80-100 % (the dips are
  a whole household down with flu). Midweek Bible study, Friday youth and
  choir practice stay optional and are drawn on personal faith.
* Intruders: `intrudersPerYear` 6 — burglar 28 %, pickpocket 12 %,
  troublemaker 16 %, stray dog 12 %, snake 8 %, stranger 10 %, con artist 6 %,
  stock theft 5 %, veld fire 3 % (proxy mix). SAPS 2023/24 residential
  burglary ≈ 300 per 100,000 households per year is the anchor for the
  burglar rate at 12 households.
* Road accidents: 0.0035 per 1,000 km (SA ≈ 12,000 road deaths per year on
  ≈ 300 bn vehicle-km, i.e. ≈ 4 deaths per 100 m km; with ≈ 8 % of injury
  accidents fatal this gives ≈ 3.5 injury accidents per million km, proxy).

## The province (`src/sim/world.ts`, `layout/`, `institutions.ts`, `population.ts`)

Three cities, each of three settlements around a civic centre, the centre
they share and the airport, on a 4.4 × 3.4 km map (province exits north,
east, west and south):

| City | Character | Settlements (tier · plots · seeded) |
|---|---|---|
| **Emmaus** (NW; the original district) | rich, church-going | Hebron Heights (the estates · 10 · 8), Ebenezer (affluent · 16 · `households`, 12), Kanana (comfortable · 14 · 12); Emmaus Crossing |
| **Newhaven** (NE) | secular — no church, mosque or temple | Bellevue Heights (affluent · 10 · 8), Oakdale (middle · 16 · 12), Westbrook (working · 14 · 12); Newhaven Central |
| **Ithemba** (S) | poor, church-going | Bethesda (working · 16 · 12), Siyakha (low-income · 14 · 12), Nazareth (low-income · 14 · 12); Ithemba Crossroads |
| **Unity Centre** (between them) | shared | hospital campus; the CBD (Government House, the Reserve Bank, SAPS provincial headquarters, Unity Square, the mall, Unity Towers, Unity Chambers, the bus & taxi terminus, Unity Central Station); Unity Park (stadium, concert hall, Grand Park, sports centre, botanical gardens) |
| **Unity Provincial Airport** (SE, off the Eastern Ring Road) | the province's | terminal (departures and arrivals halls, crew room, kiosk) with a two-stand apron; Airport Station on the Hyperline; the shuttle's bus stop; control tower; hangar; fire & rescue (one ambulance); Runway 18/36, 1.6 km |

**Wealth tiers** (`params.tiers`; a settlement's tier sets its households'
education mix, car ownership, cover, opening savings and fallback job mix —
Ebenezer's own households still read the baseline parameters, which now carry
the affluent values):

| Tier | Education (none/prim/sec/matric/tert/postgrad) | Cars | Own car per further driver | Medical aid | Opening savings | Unemployment | Fallback jobs |
|---|---|---|---|---|---|---|---|
| the estates (ultra) | 0.2/0.8/5/20/45/29% | 98% | 85% | 97% | 12–48 months | 3% | executives, engineers, attorneys, accountants |
| affluent | 0.5/2/10/29.5/40/18% | 95% | 55% | 85% | 4–18 | 8% | office, engineers, professionals |
| comfortable | 1/6/22/36/28/7% | 85% | 30% | 60% | 2–10 | 12% | office |
| middle | 3/15/32/30/16/4% | 60% | 12% | 30% | 0.5–6 | 30% | office, vendors, farm, building |
| working | 5/20/40/26/8/1% | 32% | 4% | 10% | 0.3–4 | 35% | vendors, farm, building, taxis, buses |
| low-income | 9/28/40/19/3.5/0.5% | 15% | 1% | 4% | 0.2–2.5 | 42% | vendors, farm, taxis, buses |

Profiles are loose renderings of GHS 2023 income-decile attainment and asset
ownership and QLFS expanded unemployment. The low-income townships seed with
the `young` household-type mix. New jobs carry the top of the ladder: executive
R150,000/month (Unity Towers), surgeon R98,000, Reserve Bank officer R62,000,
engineer R58,000, civil servant R28,000, librarian R22,000 (proxy scales).

**Faith by city.** Residents of Emmaus and Ithemba draw their faith around
`churchAttendance` (0.95); Newhaven's around 0.06, and with no congregation to
go to they neither attend nor tithe: their Sunday mornings go to Grand Park,
the sports centre or the mall, their midweek evenings to the library, their
funerals to the memorial hall and their weddings to a civil ceremony at the
magistrate's court. The Sunday-attendance share in the analytics is measured
over the church-going cities' residents only.

**What each settlement keeps, what each city keeps.** Every settlement has its
own congregation (where the city has any), shop, bank counter (a branch of the
Mutual Bank; Ebenezer's is the head office), park and bus stop; every city its
own school, clinic (six ward beds), police station and patrol car, magistrate's
court, council, medical centre under a District Medical Officer, cemetery,
hall, taxi association with four minibuses, workshop, co-operative offices and
farm. Emmaus and Newhaven also have chambers (attorneys and accountants) and a
commercial bank; Ithemba's firms brief the regional chambers at the centre and
bank with the Emmaus Commercial Bank, and its civic centre has a post office
and SASSA pay point instead. The estates and the affluent suburbs above
R45k/month hire domestic workers from the working-class and low-income
settlements (75% take-up, their own city's first, paid through the books, NMW
floor).

**The centre.** The **central hospital** (24 beds, two surgeons, a doctor and
four nurses) takes referrals from every city clinic: heart attacks, strokes,
cancer and fractures always, injuries of severity ≥ 0.6, anything of severity
≥ 0.8, and any admission the city ward has no bed for. Care there is 1.25× the
clinic's quality and the case-fatality of a referred episode falls by a
further 50% of that; referrals are counted as `surgeries`. **The CBD** employs
four civil servants at Government House, two Reserve Bank officers, three
officers at the provincial police headquarters (which answers calls nearest
to it, like every station), two shopkeepers and two vendors at the mall,
office staff at the stadium and the concert hall, taxi drivers at the
terminus, the regional chambers and two executives in the towers. **Unity
Park** draws from every city: a Saturday-afternoon match at the stadium
(probability ≈ 0.1 × (0.5 + E), more with a car, for teenagers and men under
55), a concert on the first and third Friday evenings (0.04 + 0.1 × affluence
× (0.5 + O)), Sunday afternoons in Grand Park (0.12 + 0.1 × affluence), and
Saturday shopping at the mall (0.08 + 0.32 × affluence, halved without a
car).

**Getting there** (`movement.ts`, `transit.ts`). A licensed driver with any of
the household's cars standing free at the door drives a road journey of 140 m
or more (the family car takes household members bound for the same place; in
the wealthier tiers a further driver has a car of their own — the column
above). Anyone else, for a journey of 700 m or more, looks first for the
**Hyperline**: where a station is within 800 m of both ends they take it four
times in five. Failing that, a **bus**: where one of the four lines has a stop
within 350 m of both ends they take it with probability 0.75 − 0.45 × the home
settlement's affluence (0.71 in the townships, 0.30 on the estates). Failing
that, for 900 m or more, a **minibus taxi**: the nearest idle minibus at a
rank in the traveller's city or at the central terminus drives out, collects
everyone waiting at that gate for the same destination (up to 14), drops them
and drives back. Someone who has stood at a stop 22 minutes (14 on a platform)
gives up and hails a taxi from there. Before any of that, a household that
uses the **Hamba** e-hailing app (its share of trips from the monthly mode
choice below; 35% of the rides to the airport and 15% to a concert or a match
whatever the household) orders a car for any road journey of 900 m or more:
the nearest online, idle car drives to the gate, takes up to three riders door
to door and waits where it dropped them for the next request. What is paid,
by whom and to whom is settled monthly in the books from the mode-choice model
(see "Transport economics" below); the animated rides draw on the same shares
and quote fares from the same rate card, but no animated ride is posted, so a
time-lapse month and an animated month keep identical books.

**The Hyperline.** Two trains shuttle end to end on a 7.7 km elevated guideway
— Emmaus 0.06 km, Unity Central 1.75, Ithemba 3.33, Airport 5.79, Newhaven
7.68 — from 05:00 to 23:30, standing two minutes at a station and three at the
ends; 120 seats. They are hypersonic in earnest: launched and caught
electromagnetically within a platform's length (60 m) and cruising at
`trainMach` × 340 m/s — Mach 5 by default, a slider in the basis from 1 to
12 — so a hop of 1.6–2.5 km is over in about a second of simulated time and
the timetable is entirely the dwells. (The province's one indulgence: no
comfort limit is modelled.) At most viewing speeds a hop is a single frame,
so the renderer glides the drawn train from platform to platform over about
half a real second with a streak along the guideway, and it catches the
simulation up on arrival. Riders walk to the platform and board the first
train going their way.

**Buses.** Two buses a line, 25 km/h between stops, a minute at each stop and
four at the ends, 05:30–21:30, 40 seats; the Emmaus, Newhaven and Ithemba lines
run from their city's settlement stops through the hospital or Unity Park to
the terminus, the airport shuttle from the terminus to the terminal. Unity
Transit's drivers (four essential posts plus the tiers' mix) board at the
terminus when on shift; a bus without one still runs.

**Ambulances.** One at each city clinic, two at the hospital's EMS station,
one at the airport's fire & rescue. In the animated day the nearest free one
fetches a patient admitted that morning from home (they sleep until it comes,
between 06:15 and 07:45), takes an injury of severity 0.5 or worse to the city
clinic, and attends a road accident with a serious or fatal outcome; it stands
three minutes and drives back to its station, as the patrol cars now do.

**Childcare** (`schedule.ts`, `childcarePass`). No child under ten is left
without someone of fourteen or more. Plans are made person by person, so once
every plan is built (and the court has summoned whom it will) a pass walks
each household with young children and closes every gap, in rounds until
nothing changes: a child does not go out unless one of the household is at
the same place, and an outing they share is cut to the minutes a member is
actually there; every minute the child spends at home has someone of
supervising age in the house, counted from when they would actually arrive
(a walk after their plan says so). A gap is closed, in order of preference,
by whoever is leaving staying until the next is in the door; by the parent
who is due home setting out that much earlier; by a guardian who is out but
not at work taking the child along for the whole outing (school is never
skipped for it); by the nearest person of sixteen or more with nothing they
are committed to for the span — a neighbour, a grandparent, someone looking
for piece work — coming to mind them (those without small children of their
own first; one who has some brings them along; police officers are never
asked, they may be called away), setting out in time to be there first and
staying twenty-five minutes after the household is due back; and, as a last
resort, by the child going along to a parent's work. The domestic workers
already cover the estates during the working day. In the animated day a
child under twelve leaving with a grown-up of the household keeps their
pace, climbs into the same car, waits for the same taxi or bus, and a bus
waits for a child a few steps behind.

**The airport.** Two aeroplanes (24 seats) fly five return trips a day —
wheels-up 06:40, 09:10, 12:30, 15:40, 18:20, back on the ground 100 minutes
later — taxiing from the apron along the Airside Road to the northern
threshold, rolling south and vanishing off the map until the timetable brings
them back from the south. Two pilots (a tertiary post, R74,000) fly whichever
aircraft leaves while they are on shift. A day trip by air, out on the 06:40
or 09:10 and home on the 17:20 or 19:50 landing, is drawn per working day for
executives (0.20), Reserve Bank officers (0.10), attorneys, accountants and
engineers (0.06), surgeons and the medical officers (0.03), magistrates
(0.015), civil servants (0.01) and office workers from the estates and the
affluent suburbs (0.025); on a Saturday an adult from those two tiers flies
for the day with probability 0.04 × affluence. The flyer leaves home 105
minutes before departure, waits in the departures hall, and comes home on the
flight their plan names — whichever aircraft that is. The time-lapse counts
the flights and the trips but animates none of it.

**Policing and the courts** are by city: an incident calls the nearest
station's officers and patrol car; a case goes to the accused's city's
magistrate; the provincial headquarters covers the centre. Intruders come from
the nearest province exit three times in four.

**The councils** (one per city; six elected portfolio seats + health ex officio,
after the Scelo council): finance & investment, accounts & audit, risk &
actuarial, legal & governance, community wellbeing, and an independent red
team, plus the city's DMO for health. Seats are filled by aptitude (job,
education, Big Five) from the city's own residents, under a representation
rule — every settlement of the city holds at least one elected seat and none
more than three — with the magistrates excluded (separation of powers). Elected
members draw a stipend (`councilStipend`, R4,800/month, wage-indexed) paid by
the government with PAYE withheld at the marginal rate (the annual-equivalent
difference), posted to accounts 5345/4025 and included in the holder's IRP5
remuneration. Each council sits on the first Tuesday evening of the month in
its own chamber. Vacancies refill monthly by the same rule.

**Retail pay scales**: the spazas are survivalist owner-operations (32% of the
notional shopkeeper scale, NMW floor), the general dealers pay 70% and the
delis 90%, the mall the full scale — QLFS retail medians rather than the
public-service-style scale the notional figure represents. The spazas are
below the VAT threshold: they charge no output VAT and cannot recover input VAT
on their cash-and-carry restocking (posted to the VAT-in-costs account, as for
the workshops). A township buys 90% of food and 70% of goods at its spaza; the
estates 85% of food at the deli; the mall captures half; fresh produce clears
through the Ebenezer market, the region's produce hub — every other shop
restocks town-side, and the other two farms sell under contract at export
parity.

National accounts cover every producer registered in `institutions.ts`: the
shops, delis and spazas, the mall, three farms, three workshops, four offices
(the towers included), three chambers, four taxi associations, two commercial
banks (fees as production, treasury income as primary income from outside,
like the Mutual Bank's T-bills), the Mutual Bank's FISIM, six churches at cost
(NPISH) and government at cost including council stipends and the centre's
services. Compensation of employees sums every employer that issued a payslip,
households employing domestic workers included. GDP by production and income
are identities; the expenditure discrepancy is reported honestly.

## Economy and finance (`src/sim/finance/`)

Every rand in the community is posted to double-entry books (`accounts.ts`):
a standard chart of accounts (1xxx assets, 2xxx liabilities, 3xxx equity,
4xxx revenue, 5xxx expenses), a hash-chained general journal (FNV-1a 64-bit,
each entry chained to its predecessor; month-end digests are kept when older
months are pruned), per-entity ledgers, and statements presented on IFRS for
SMEs lines: trial balance, income statement, statement of financial position,
statement of changes in equity and statement of cash flows (direct method,
IAS 7 classes). The financial year is the South African year of assessment
(1 March – end of February); the close transfers profit and distributions to
retained earnings. Entities with books: every household, the shop, the farm,
the workshop, the co-operative's offices, the church (public benefit
organisation), the burial and life society, the Mutual Bank, the government
(SARS, SASSA, the municipality and provincial services) and the rest of the
economy. The bank's books mirror its members' (a member's deposit is the
bank's liability; money paid outside the community leaves the bank's
settlement account), and the audit checks that they agree.

### Incomes, needs and grants

* Incomes by occupation (ZAR/month, base 2026): pastor 18,000; doctor 62,000;
  nurse 26,000; teacher 27,000; police 23,000; magistrate 58,000; clerk 15,000;
  shopkeeper 21,000; vendor 5,500; farmer 24,000; farm worker 5,200; builder
  16,000; office 21,000; bank officer 19,500 (public-service pay scales and
  QLFS medians, proxy), with education and experience loadings. Formal wages
  are indexed each March by the community's CPI plus 0.5% real growth.
* National minimum wage R30.23 per hour from 1 March 2026 (Department of
  Employment and Labour), applied as a floor on 40 hours a week; uplifted each
  March by CPI + 1%.
* Basic needs: R2,450 per adult, R1,500 per child per month (2026 prices,
  Stats SA upper-bound poverty line plus housing and transport); poverty line
  R1,634 per person (Stats SA UBPL 2025). Both are indexed by CPI.
* SASSA grants from 1 April 2026: child support R580; older persons R2,400
  (R2,420 at 75+). Child support to children under 18 in households with income
  per person below 2.5 poverty lines; older persons' grant to those 60+ without
  income. Indexed by CPI each year.
* Households spend 78% of what they earn above basic needs (a marginal
  propensity that falls by 0.5 for each percentage point the real prime rate
  sits above neutral: the monetary transmission channel). Spending is split by
  category with Engel's law for food (share = 0.12 + 0.40·e^(−income per
  person / R5,000), from the pattern of the IES 2022/23 by decile), housing 20%,
  transport 10% (17% with a car), clothing and household goods 9%, education
  2% (5% homeschooling), health 3% (plus medical scheme contributions of
  R900 per member), communication and other 8%. Zero-rated basic foods are
  35% of food spending for poor households and 25% otherwise. 80% of food and
  half of goods and other purchases are made at the community shop; the rest
  in town (imports). Fuel levies (general fuel levy R1.10, RAF R0.25, carbon
  R0.19 per litre from April 2026) are 7.3% of fuel spending; municipal rates
  are 12% of housing spending.
* Tithes: 10% of net earnings and 2% of grants scaled by the household's
  faith (0–1). The church remits 10% of tithes to the denomination, spends 12%
  on ministry and 3% on building maintenance (at the workshop), and gives from
  its diaconal fund to households below the poverty line when its cash exceeds
  three months' costs.
* Big-ticket decisions: a household without a car and with a driver, income
  above R12,000 a month and a third of the price saved buys one (2% a month;
  R120,000, bakkie R180,000, 30% in cash, the rest on vehicle finance over 48
  months); a home improvement of R25,000–60,000 built by the workshop (0.6% a
  month, half on a 36-month loan).

### Businesses

* Shop: gross margins 30% on food, 32% on goods, 18% on airtime and other;
  fresh produce is 35% of food sales, bought from the farm at the price the
  local produce market clears (below import parity) or brought in at parity;
  small business corporation for tax; VAT vendor (category A). Fittings
  R150,000 depreciated over 10 years.
* Farm: output R60,000 a month for the farmer alone plus R22,000 per farm
  worker at base prices; the share sold locally is calibrated at the first
  month so the produce market opens at the base price, the rest is sold under
  contract to a regional buyer at 85% of import parity; inputs 35% of output
  (VAT reclaimed; sales zero-rated, so the farm receives VAT refunds), 3% of
  output reinvested, tractor and implements R600,000 depreciated over 15
  years. Yield = 0.6 + 0.4·√(rain over the last three months / normal), capped
  at 0.5–1.25, with an 8% heat penalty above 33 °C.
* Workshop: building repairs (15% of households' housing spending), the
  co-operative's maintenance contract (R5,000 a month), home improvements and
  outside jobs (R8,000–24,000 a month per builder); materials 40% of revenue;
  a micro business on turnover tax, not a VAT vendor. At most two builders.
* Co-operative offices: services invoiced to clients in the region at 1.18×
  payroll plus R8,000 a month (standard-rated), admin R6,000 and utilities
  R4,000 a month, 2% of revenue invested; company tax at 27%; 60% of its
  surplus distributed to member households each year (every household is a
  member), less dividends tax.
* Informal traders (vendors) sell for their own account at a 35% margin, taking
  what households would otherwise buy in town; below the tax threshold.
* Public services cost R30,000 a month (medicines, school materials, police and
  court running costs) on top of public-service pay; the community's public
  sector is funded from the national fiscus each month (the transfer is
  reported).

### The Mutual Bank (`bank.ts`)

* Mutual Banks Act 124 of 1993: founding share capital R10 million (the Act's
  minimum), held as non-voting preference shares by the church's development
  fund and a development finance institution, paid a preference dividend at
  half the repo rate; every household subscribes R5,000 of member shares.
  Capital adequacy on Basel I risk weights (unsecured retail 100%, government
  paper and Reserve Bank balances 0%): minimum 10% plus a 2.5% board buffer;
  liquid assets at least 5% of deposits (the bank targets 12% at the Reserve
  Bank and places the rest in treasury bills at repo − 0.25%); a single
  exposure above 10% of capital needs board approval, 25% is the ceiling; 10%
  of net profit to the statutory general reserve each year; dividends of 40% of
  distributable profit on member shares only when capital adequacy exceeds
  target by 5 points, less 20% dividends tax.
* Rates: deposits at repo − 3.5% on credit balances (a savings-account spread wide enough to carry the bank's wage bill) (an overdrawn account is charged the personal lending rate, capitalised); personal loans prime + 5%, emergencies
  (funeral, medical, legal) prime + 4%, business prime + 2%, vehicle finance
  prime + 1%, equipment finance prime + 1.5%; NCA initiation fee R165 + 10% of
  the amount over R1,000, capped at R1,050, plus VAT.
* Business rescue: a business whose overdraft passes about six months of its
  revenue is restructured — the bank writes the overdraft off as its loss and
  the business starts afresh, barred from new loans for 24 months.
* Assessed losses carry forward against future taxable income (s20) for every
  company; fines and penalties are not deductible.
* Credit policy (National Credit Act affordability): instalment at most 30%
  of net income, total debt service at most 40%; no new loan while another is
  two months in arrears; a written-off borrower is barred for 36 months.
* IFRS 9: stage 1 (12-month PD 4.5% × LGD 60%), stage 2 at 30 days past due
  (lifetime PD 28%), stage 3 at 90 days (LGD), write-off at 180 days; unpaid
  interest is capitalised. Administration R5,500 a month (systems, audit,
  insurance, Prudential Authority levy), indexed.

### SARS (`tax.ts`)

* 2026/27 year of assessment (Budget 2026, brackets and rebates up 3.4%):
  18% to R245,100; R44,118 + 26% to R383,100; R79,998 + 31% to R530,200;
  R125,599 + 36% to R695,800; R185,215 + 39% to R887,000; R259,783 + 41% to
  R1,878,600; R666,339 + 45% above. Rebates R17,820 / R9,765 / R3,249;
  thresholds R99,000 / R153,250 / R171,300; medical scheme fees credit R376
  for the first two beneficiaries and R254 for each further one per month;
  interest exemption R23,800 (R34,500 at 65+). Later years index the tables by
  the community's CPI (`bracketIndexation`, 1 = full indexation).
* PAYE by the annual-equivalent method (Fourth Schedule); UIF 1% + 1% to the
  R17,712 monthly ceiling; SDL 1% of payroll above R500,000 a year (public
  benefit organisations and the public service exempt); EMP201 monthly.
* VAT 15% with zero-rated basic foods; registration compulsory above R2.3m
  and voluntary from R120,000 (from 1 April 2026); VAT201 every two months,
  refunds of input tax paid to the farm.
* Companies 27%; small business corporations 0% to R99,000, 7% to R365,000,
  R18,620 + 21% to R550,000, R57,470 + 27% above; turnover tax for micro
  businesses to R2.3m turnover: 0% to R600,000, 1% to R950,000, R3,500 + 2% to
  R1.4m, R12,500 + 3% above (from 1 April 2026); provisional payments in
  August (half the estimate) and February; ITR14 / TT03 assessments in tax
  season with top-ups or refunds; dividends tax 20% withheld.
* Individuals: ITR12 assessments each July for the year ended in February
  (refunds of PAYE over-withheld on part years; interest above the exemption
  taxed; tithes deductible under s18A only if `churchS18A` is on, capped at
  10% of taxable income).
* Tax Administration Act: 10% late-payment penalty on the amount paid late,
  interest at the prescribed rate (repo + 3.5%); a taxpayer is non-compliant
  while anything is outstanding. Fines from the court are revenue of the
  state.

### Macroeconomics (`macro.ts`)

* CPI: national core inflation starts at 4.3% and drifts to the 3% target as
  an AR(1) (persistence 0.94), pushed by the rand (8% of a sustained yearly
  depreciation passes through); national headline inflation adds fuel's
  first-round effect (the 3.9% fuel weight times the pump price's change over
  core). The province's CPI weights (Stats SA, 2025 reweighting): locally
  priced produce carries its share of the food weight (17.2%), fuel 3.9% at the
  regulated pump price, passenger transport services 2.9% at the province's
  fares (a Laspeyres index of a 3 km trip by minibus taxi 55%, Hyperline 25%,
  bus 12% and Hamba 8%, surge included), and the rest follows national core
  plus 0.25 × the output gap.
* Monetary policy: the Monetary Policy Committee (six members) meets in
  January, March, May, July, September and November. Each member's rate is a
  Taylor rule i = 2.5% + πᵉ + 1.5(πᵉ − 3%) + 0.5·gap plus a leaning of their
  own (−50, −25, 0, 0, +25, +50 bp), smoothed 80/20 toward the current rate
  and rounded to 25 bp; a member moves at most 25 bp, or 50 bp when the rule is
  more than two points away. The step most members favour carries; the
  Governor breaks a tie; the statement records the vote, inflation against the
  3% target (±1 point since 2025), fuel's contribution, the gap, Brent and the
  rand. Expectations over the committee's horizon: a third anchored on the
  target, the rest 70% national headline with half of fuel's first-round effect
  looked through and 30% the province's own inflation. Prime = repo + 3.5%.
  Calibration: repo 6.75% in January 2026 (the March 2026 MPC held it; the May
  2026 MPC raised it to 7.00% on a 4–2 vote as oil passed US$85, and July held
  it, again 4–2).
* GDP by the production approach (value added of the businesses, the bank's
  domestic intermediation excluding its treasury-bill income, public and
  church services at cost, plus VAT, fuel levies and rates) and independently
  by the expenditure approach (C + I + G + X − M); the income approach
  reconciles by construction; the statistical discrepancy is reported.
  Potential output grows with the working-age population and 1.2% a year
  trend productivity, pulled 10% a month toward realised output; the output
  gap is capped at ±20%.
* AD–AS per quarter: AD through the quarter's (Y, P) with unit price
  elasticity; SRAS from the expected price level with slope 0.5 around
  potential; LRAS at potential. Phillips and Okun fits by OLS on quarters.
  Gini and Lorenz on income per person and household net worth. Laffer curve
  with an elasticity of taxable income of 0.25 (Saez, Slemrod and Giertz 2012).

### Transport economics (`transport.ts`, `markets.ts`)

**Oil, the rand and the pump price.** Brent (US$/bbl) is a mean-reverting
random walk in logs (5% a month toward an anchor of US$68 that rises with 2.5%
US inflation; σ 7.5% a month), with a supply shock (+32%, one month in 96) and
a demand collapse (−28%, one in 160). The rand per dollar reverts 3% a month to
its purchasing-power path (the gap between the province's inflation and 2.5%),
strengthens with the real repo rate above 3% (carry) and weakens 0.12 × oil's
log change; σ 2.8% a month. The DMPR's regulated build-up sets the price on the
first Wednesday from last month's import parity: basic fuel price (Brent plus
the refining margin, US$14/bbl for petrol, +4 for diesel and +6 for Jet A1,
widening when crude is dear, at the rand, plus R0.58/l freight and insurance)
+ general fuel levy (≈R4.17/l petrol, ≈R4.00 diesel in January 2026) + RAF levy
(R2.18) + carbon fuel levy (11c / 14c) + slate levy (62c) + margins, storage,
distribution and the inland zone differential (R5.15/l petrol; R1.85/l diesel
logistics plus R1.30 dealer margin at the pump). This gives R20.75/l for 95
unleaded inland in January 2026, the DMPR's published price. The Budget raises
the general fuel levy by CPI each April unless petrol is 15% up on the year
(it rose to R4.29/l in April 2026); the RAF levy is frozen, as it has been since
2021. Treasury grants relief when the pump price has risen 20% in three months
(or R2.50 in one): R3/l off petrol and R3.93/l off diesel (the whole levy) for
two months, half for a third, then not again for a year. Its cost to the
fiscus is the levy the province's litres did not pay. This is the April–June
2026 episode: R3/l from 1 April, diesel's levy to zero in May, R1.50/R1.96 in
June, R17.2 billion nationally. Margins follow CPI each December. Electricity:
NERSA's corrected MYPD6 path, +8.76% on 1 April 2026 and +8.83% on 1 April 2027,
then CPI + 1.5%; R2.05/kWh commercial in January 2026. A new small car:
R205,000 incl. VAT, moving with the CPI and a third with the rand.

**Fares.** Minibus taxi: R12 + R1.10/km, rounded to R0.50 (R15.50 for 3 km in
January 2026). The associations raise fares by 90% of the rise in their cost
index (42% diesel at the pump, 58% CPI) once it has climbed 7% since the last
rise (or 3% after a year), and cut only after a 15% fall (Stats SA: passenger
transport +8.1% in June 2026 and 12.5% on the year; local fares up R2–R6 in
May 2026 after diesel's R5.27/l rise). Their diesel is 42% of the fare box at
the start, moving with the pump price against their fares; a carless
household's trips beyond the province are 60% long-distance minibus taxi. Unity
Transit: bus R14 flat; Hyperline R16 + R2.20/km; reviewed each July by CPI + 1%
(CPI only when unemployment is 3 points above its trend). Airline (a national
regional carrier): R1,150 a sector ex VAT with inflation, a fuel surcharge of
32 l a passenger on Jet A1 above its January 2026 price, the airport's
passenger service charge (R190) and VAT; landing fee R1,100; both indexed each
April.

**Mode choice.** A carless household's transport budget is its 10% base share
times the relative price of its fares to the power 0.65 (price elasticity of
the budget 0.35), normalised with the other categories. 15% goes beyond the
province, and the rest is split by a multinomial logit on generalised minutes
to the centre (walking at 80 m/min, a taxi wait of 8 minutes, bus waits of 12,
Hyperline 3, Hamba's pickup time from the market): U = ASC − 0.05 × (minutes +
fare ÷ value of time). The value of time is half the earners' average wage per
minute (floor R0.06). Constants: taxi 0 − 1.2 × affluence, bus −0.35,
Hyperline +0.25, Hamba −0.8 + affluence. A household with a car spends 17% ×
(0.65 × relative petrol price^0.75 + 0.35) of its budget on transport:
petrol at the pump (short-run elasticity 0.25), running costs, and 4% on
e-hailing. Air tickets for a Saturday flown come out of the month's spending.
Business trips are billed to the employer.

**E-hailing.** Hamba is an agent for its driver-partners (IFRS 15): it
collects the fare, keeps a 25% service fee and a R4.50 booking fee (Uber South
Africa 25%; Bolt 20–25%), both standard-rated, and pays out the rest. The fare
itself is exempt passenger transport (VAT Act s12(g)). The rate card at a
tariff index of 1 is R12 + R7.20/km + R0.70/min, minimum R32 (Uber's Gauteng
card: R8/km, R0.80/min). Pricing, monthly: a cost floor, the index at which a
driver online 250 hours a month (58 h a week) at 60% utilisation clears 1.3 ×
the minimum wage an hour after the fee, petrol (6.8 l/100 km, 35% empty
running) and the weekly rent and phone (R350); times a demand shade
exp(0.5 × output gap + 0.35 × real income growth − 2.5 × the change in
unemployment), within ±15%; the target is kept within 0.7–2.6 × CPI (a real
band, since the card itself is nominal). The card moves a third of the way to
that target each month, by at most 6%. Demand in driver-hours: residents (the logit),
visitors off the planes (12% of arriving and departing passengers, elasticity
0.5) and regional trips (80 a month at 28 km, elasticity 0.8, riding home
empty). Supply: each driver's online hours respond to last month's hourly
take-home (elasticity 0.4, 100–300 h), 72% of them usable. When demand at the
card exceeds supply the app surges (to ×3, then rations; unserved trips fall
back to the taxi). Driver-partners stop (three in ten a month) when the hour
paid less than 75% of the reservation wage (115% of the minimum wage) and sign
up (one a month at most, from people out of work aged 21–59 with some
schooling) when it paid 5% more and the cars were busy.

**Unity Fleet Rentals** buys a small car for each driver-partner (R205,000
incl. VAT; a rental business claims the input VAT, s17(2)(c)) on vehicle
finance from the Mutual Bank at prime + 1% over 48 months, 90% loan to value.
The loan is underwritten on the fleet's rental EBITDA. It rents the car at a
weekly rate that carries the instalment, a 15% return on the owners' 10%,
insurance and tracking (R1,450 a month), services (R0.42/km at 4,500 km a
month, half at the driver's city workshop) and an 8% margin (R2,200 a week in
January 2026; the market runs R1,800–R3,500 with R2,200–R2,800 typical, and
Uber's own cars from R2,300). It reprices quarterly, so a repo move reaches
the rent, the driver's costs and Hamba's cost floor. It sells a car idle for
two months at 85% of book value, and the proceeds settle its finance.

**Unity Transit** runs the timetable: its kilometres come from the bus lines'
road lengths (2 buses a line, 420 m/min, a minute at each stop, 4 at each end,
05:30–21:30) and the Hyperline's (2 trains, 2-minute dwells, 3-minute
layovers, 05:00–23:30). Costs: diesel 0.32 l/km at the wholesale price, the
levy to SARS; maintenance R2.80/km for buses and R2.50/km for trains; traction
and guideway systems 4.5 kWh a train-km at NERSA's tariff; ticketing R35,000
and insurance R18,000 a month; the bus drivers' payroll. It is not a VAT
vendor, so the VAT on its purchases is a cost. The buses, the guideway and the
trains are provincial assets. Fares come from households and from 7,500 bus
and 13,000 Hyperline boardings a month by riders beyond them, plus 45% of the
airport's passengers (elasticities 0.35 and 0.4; ±0.8 × the output gap). The
public transport operations grant tops its cash up to 1.25 months of costs.
Its fares cover about 40% of its costs. On the SNA 2008 test (a producer whose
sales cover at least half its costs over a sustained period is a market
producer), a year below half counts it as a non-market public producer: its
value added is its payroll, and the rest of its output is government
consumption. A year above half counts it as a market producer, and the grant
is a subsidy on products.

**The airport company** (state-owned, company tax, VAT vendor) bills the
airline landing fees (five landings a day) and the passenger service charge,
takes R12 a visitor from the kiosk concession, and pays for power (60,000 kWh
a month), rescue and fire fighting and security (R140,000), maintenance
(R60,000), administration and insurance. It pays the province 80% of its profit
each year (exempt from dividends tax, s64F). The airline flies its timetable
whatever the load: visitors fill 62% of the seats at January 2026 fares (fare
elasticity 0.8, ±1.0 × the output gap). The pilots are the airline's
employees: their pay is primary income from outside the province. Hamba's
foreign parent takes 60% of its profit and the fleet's outside investors half
of the fleet's, dividends tax withheld at 20%. Business travel by air is
recharged to the firm's clients beyond the province at cost (disbursements),
so it does not eat a firm's margin; the state's official travel is its own.

**National accounts.** Hamba's output is its fees; the driver-partners' own-
account value added (payouts less fuel, rent and phone) counts with the
households'. VAT on exported services (the airport's charges, visitors'
booking fees) and on the drivers' rent is a tax on products, and the fleet's
cars are investment. With these the statistical discrepancy stays where it was
before transport was costed (about 4% of GDP, from the informal trades).

Sources: DMPR fuel price announcements (7 January and 2 September 2026:
95 inland R20.75 and R26.92); National Treasury media statement of 28 April
2026 (fuel-levy relief extended; R17.2 billion); Stats SA, *Update of the CPI
weights and basket*, 28 January 2025 (transport 13.9%, fuel 3.9%, passenger
transport 2.9%) and CPI releases (June 2026); SARB MPC statements, March, May
and July 2026; NERSA's MYPD6 redetermination (Engineering News, 10 March
2026); Uber South Africa fare notices; FleetCalc and MyBroadband on e-hailing
commissions and rentals (2025–26); VAT Act 89 of 1991 ss12(g), 17(2)(c);
Income Tax Act ss10(1)(cA), 64F; *System of National Accounts 2008*, chapter
22 (market and non-market producers: economically significant prices, the
50% criterion). The general fuel levy's January 2026 level (R4.17/l petrol,
R4.00/l diesel) is back-calculated from the ≈R4.29/l reported after the April
2026 Budget's inflation adjustment and is approximate; so are Brent (≈US$62)
and the rand (≈R16.60/$) at the start, the refining margins, the regulated
margins (fitted so the build-up reproduces the published R20.75), the
province's unit costs for Unity Transit and the airport, and the ridership
from beyond the province (*proxies*, chosen so the fare box covers about 40% of
Unity Transit's running costs, typical of South African public transport, and
so the airport's margin is about 30%).

### Microeconomics (`micro.ts`)

* Produce market: demand Q = A·P^−0.55 (own-price elasticity of food demand
  from South African household-survey estimates, −0.5 to −0.6), the farm's
  supply Q = S₀·yield·P^0.3, imports perfectly elastic at parity 1.18 × the
  price level; cleared monthly; consumer and producer surplus with demand
  truncated at three times the price.
* Labour market: positions worth at least the wage against people whose
  reservation wage (the higher of 55% of the minimum wage and R1,400 + R1,900
  per education step, +10% over 50, +15% with another income in the household)
  is at or below it; the minimum wage is the floor.
* Consumer choice: Cobb–Douglas with the food share implied by the Engel
  curve at the household's income per person.

## Insurance

* Scheme: funeral premium R120 / month for R25,000; life cover R120 / month
  per adult 18–64 for R100,000 (both indexed by CPI); opening reserve
  R200,000; 75 % / 35 % / 30 % of households hold funeral / life / medical
  cover at start. The scheme is a small burial society (a friendly society,
  exempt from income tax): with ≈ 20 insured lives its surplus process is
  lumpy. Its books are kept like any other entity's; funerals cost R15,000
  (indexed), borrowed from the bank when uninsured households cannot pay.

## Actuarial workbench (`src/sim/actuarial/`)

Nothing here feeds the simulation; the workbench values what the simulation
has produced, on the same basis, at a valuation rate the user picks.

* **Valuation rate.** Treasury bills (the default: the Mutual Bank's surplus
  earns it and it is the nearest thing the province has to risk-free), the
  repo rate, prime, the deposit rate, a real rate (treasury bills less CPI
  inflation, Fisher) or a typed rate. Before the first month closes the
  scenario's opening repo rate stands in.
* **Table.** The scenario's Heligman–Pollard qₓ by single age with the
  improvement drift applied to today (`improvedQx`); commutation functions on
  a radix of 100,000 with benefits at the end of the year of death, premiums
  in advance; ä⁽¹²⁾ by Woolhouse (äₓ − 11/24); A⁽¹²⁾ and Ā by i/i⁽¹²⁾ and i/δ
  under a uniform distribution of deaths.
* **The society.** Monthly rate of mortality q⁽¹²⁾ = 1 − (1 − qₓ)^(1/12); the
  pure premium for a life is q⁽¹²⁾ × its cover (funeral benefit, plus the life
  sum for adults 18–64, both CPI-indexed); administration 2 % of premiums (as
  the books charge). Claims a month are Poisson at λ = Σ q⁽¹²⁾ with sizes from
  the mixture of covers weighted by q⁽¹²⁾; the adjustment coefficient solves
  λ(Mₓ(R) − 1) = cR by bisection; the surplus fan is 1,000 paths of 120 months
  (seed 7, ruin checked at month ends, everything in today's rand and today's
  book); the SCR is the 99.5th percentile of the worst fall in surplus within
  twelve months; the MCR corridor is 25–45 % of the SCR (SAM). The
  standard-formula view stresses a year's expected claims by +15 % (mortality)
  and the sums at risk by 1.5 ‰ (catastrophe), combined at ρ = 0.25; the
  premium "fix" solves Lundberg's bound for ψ ≤ 1 % at today's reserve.
* **Projections.** Cohort-component by single age and sex: the improved table
  year by year, the ASFR schedule at the basis TFR, births split at the
  sex ratio at birth and surviving the infant year, the youth emigration hazard
  at 18–30, no immigration (re-lets are a layout matter, not a basis one).
* **Retirement.** Contributions default to 15 % of pay (employee and employer
  together), salary growth is CPI inflation plus the real wage growth
  parameter, returns are cash (deposit rate), bonds (treasury bills + 1 pp),
  balanced (CPI + 5 pp) or the valuation rate; the two-pot split is one third
  savings, two thirds retirement (from 1 September 2024); the pension is the
  retirement component over 12·ä⁽¹²⁾ at the retirement age, level at the
  valuation rate or inflation-linked at the real rate.
* **The old-age grant.** R2,400 a month from 60 (the R20 more at 75 ignored),
  indexed to prices, so valued at the real rate: an immediate annuity for those
  past 60 and a deferred one for the rest, on the improved table; closed-group
  (the people alive today).

## From outside: Scelo's bases, stresses and experiments (`src/sim/shocks.ts`, `experience.ts`, `experiment.ts`)

Inside Scelo IDE the province exchanges data with the pipeline and the swarm
(the Scelo exchange, `@scelo/core/exchange`). None of it changes a default
province: with no supplied basis and no shocks every factor below is exactly 1
and no random number is drawn differently (checked bit for bit against the
engine before the exchange existed).

* **A supplied mortality basis** (`params.mortalityOverride`, hashed into the
  basis like any parameter). It becomes the basis: the table channel reads it
  and A/E is measured against it. Illness and maternal deaths, calibrated
  against the preset, are scaled by the ratio of forces of mortality,
  μ_supplied(x) / μ_preset(x) = ln(1 − q_supplied) / ln(1 − q_preset), by age
  and sex, so total deaths follow the supplied table in expectation. Road
  deaths are a traffic process and are not scaled. A pooled table keeps the
  preset's sex differential around it: q_M = q·2q_M°/(q_M° + q_F°). Between the
  ages it gives it is log-linear; beyond them the preset's shape is scaled to
  meet it. A table stated for another year is carried to the start with
  `mortalityImprovement`. Checked on twelve seeds over four years: tables at
  1.3 and 0.75 times the preset moved deaths by 1.25 and 0.78 times, and A/E
  against each arm's own table matched the baseline's against the preset
  within its standard error.
* **Shocks** (`params.shocks`): months count from the start. A *mortality*
  shock multiplies every death hazard in its window (optionally for an age
  range; factors multiply). A *repo* shock adds basis points to the rate the
  MPC sets: it is taken off before the committee meets and put back after, so
  the committee's own decision is unchanged. An *oil* shock multiplies Brent on
  top of the path it would have taken (`brentBase`), so the oil process and its
  draws are the unstressed ones. Each shock appears under Events as it
  starts and lifts.
* **Experience exports.** Exposure is rebuilt person by person from
  `arrivedDay` (day 0 for the founding population, the birth day, the arrival
  day) to the day of death or departure (`leftDay`), counting day d when
  arrivedDay ≤ d < exit, at age ⌊(d − birthDay)/365.25⌋, with expected deaths
  from the basis daily hazard exactly as `statsDayStep` books them. Exposure,
  deaths and expected deaths match the engine's own totals to within a
  millionth. Calendar years observed for less than half their days are left
  out of the export.
* **Experiments.** Every arm runs on the same seeds as the baseline (the
  named random-number streams: common random numbers). An effect is the mean
  paired difference over seeds, with a Student-t 95% interval; "better in k of
  n" counts the seeds in which the arm improved the indicator in its stated
  direction. The indicators and their definitions are `METRICS` in
  `experiment.ts`. A job is limited to 800 province-years.
* **Observed.** Over its first four years the province has run below its
  basis: pooled A/E ≈ 0.78 across twelve seeds, and the default seed
  `agincourt-12` had one death against 8.2 expected in three years. The basis is
  calibrated over long runs (see Mortality). Scelo's truth check measures the
  province's A/E and separates it from a fitted model's error.

## Calendar and climate

* Wind direction is a sixteen-point compass state that backs or veers one
  point on about half of days; storms and cold snaps come round to the
  south-west (proxy: the highveld's cold fronts). The daily weather as it
  happened (including the operator's forced days) is kept for the last 400
  days for the weather chart.

* South African public holidays incl. Easter-based ones; school terms
  approximated (Jan 15–Mar 24, Apr 8–Jun 24, Jul 16–Sep 24, Oct 6–Dec 4).
* Climate normals for Johannesburg (highveld, default), Stellenbosch,
  Durban and a generic north-temperate site (SAWS / WMO 1991–2020, rounded);
  AR(1) temperature anomalies, seasonal rain-day probabilities, storms, heat
  waves and cold snaps that feed illness and mortality.

## What is proxy and what is published

Anything marked *proxy* above is a reasoned placeholder pending a better
source; the engine treats it exactly like a published number so it can be
replaced without code changes. Published numbers are cited with the release
name; the two Agincourt presets are lifted verbatim from the paper.
