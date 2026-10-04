# The model

Community Lab is a life-course microsimulation: every resident of Unity Province is an agent, and everything the
analytics show is counted from what those agents did. This page is the overview. The
[model description](odd.md) follows the ODD protocol for agent-based models, and
[Assumptions and provenance](assumptions.md) gives every rate with its source. Both are the repository's own
documents, included here as they stand.

## What it is for

The province is built so that the mechanisms behind aggregate outcomes can be watched at the level of the person
and the household. Its intended users are actuaries and social scientists who want to:

- see a published mortality and fertility basis play out in a population they can inspect;
- measure actual against expected experience with the usual exposure bookkeeping;
- stress a small insurance scheme, and a small economy, and watch what gives;
- run replications, and compare policies on the same random numbers.

## The province

**Unity Province** is three cities around a shared centre, with an airport, on a map of 4.4 by 3.4 km:

| | Character | Settlements |
|---|---|---|
| **Emmaus** (north-west) | rich, church-going | Hebron Heights (the estates), Ebenezer (affluent), Kanana (comfortable) |
| **Newhaven** (north-east) | secular: no church, mosque or temple | Bellevue Heights (affluent), Oakdale (middle), Westbrook (working) |
| **Ithemba** (south) | poor, church-going | Bethesda (working), Siyakha and Nazareth (low-income) |
| **Unity Centre** | shared | the central hospital, the CBD (Government House, the Reserve Bank, the provincial police, the mall, the towers, the bus and taxi terminus) and Unity Park (stadium, concert hall, Grand Park, sports centre) |
| **Unity Provincial Airport** (south-east) | the province's | a terminal, a control tower, a hangar and a 1.6 km runway |

Each city keeps its own school, clinic, police station, magistrate's court, council, cemetery, hall and taxi rank,
and each settlement its own shop and bank counter. The default province starts with **100 households and about
four hundred residents**. A settlement's wealth tier shapes its households' schooling, cars, insurance cover,
savings and work.

Roads join every building to every other. The **Hyperline**, an elevated guideway with five stations, links the
three cities, the centre and the airport; four bus lines run into the terminus; minibus taxis wait at every rank;
the Hamba e-hailing app, ambulances, patrol cars and two aeroplanes complete the traffic.

## The people

A resident has a sex, an age, a household, a Big Five personality, schooling, a job and an income, a marital
status and a partner, parents and children, health (illnesses, chronic conditions, vitality), mood, stress, faith,
relationships with other residents, and a plan for the day. They sleep, eat, work, go to school, shop, visit,
worship where their city has a church, court, marry, have children, fall ill, are treated at their city's clinic or
referred to the hospital, grow old and die.

Nothing is scripted to happen. Deaths, births, marriages and departures are drawn day by day from hazards on the
basis; who meets whom follows from where their plans take them.

## The day step

Everything that changes a life happens in one **day step** at midnight, in a fixed order:

1. the day's weather;
2. ageing and life-course transitions (school, matric, tertiary study, retirement);
3. illness: care-seeking, admission, recovery or death, new onsets;
4. table mortality on the basis, with each person's risk factors;
5. pregnancies, births and new conceptions;
6. on the first of the month, marriages and divorces, migration, and the economy: payroll, tax, grants, budgets,
   the markets, the bank, the burial society and the books;
7. social dynamics, disputes, security and the courts, funerals and weddings;
8. exposure bookkeeping (person-years and expected deaths and births by age band and sex);
9. tomorrow's plans for everyone.

Between day steps, at viewing speeds up to an hour a second, the province is **animated** minute by minute: people
walk and drive their plans, conversations form, intruders are met. Faster than that it becomes a **time-lapse** of
day steps alone. Both run the same day step, so **an outcome never depends on the speed you watch it at**.

## Reproducibility

Every process draws its random numbers from a stream of its own, seeded from the scenario's seed. Two
consequences:

- **The same seed and basis give the same province and the same history**, on any machine, in the app, in a
  script or on the worker pool.
- **Changing one assumption changes only the draws it touches.** The weather, the households and every other
  process keep their numbers. This is what lets an experiment compare an arm with the baseline **seed by seed**
  (common random numbers), so a difference between them is the change's doing rather than chance's.

Every basis is fingerprinted: the **basis hash** covers every parameter, the seed included, and the
**assumptions hash** covers the assumptions alone, so the seeds of one basis can be told apart from another basis
and pooled.

## The bases

| Process | Basis |
|---|---|
| Mortality | Heligman–Pollard, with presets from Stats SA 2024, the Agincourt HDSS (rural South Africa before and after ART) and an illustrative developed-country table; or a table you supply. Mortality improvement at a constant rate. |
| Individual risk | Multipliers for HIV, cardiovascular disease, diabetes, hypertension, COPD, disability, vitality, widowhood and poverty, normalised within each age band, so they move risk between people of an age without changing the band's level. Illness episodes add deaths of their own, so only a share of the table, falling with age, is applied directly. |
| Fertility | An age-specific schedule scaled to the total fertility rate (2.41 by default, Stats SA 2024), with partnership, parity, schooling and health effects. |
| Marriage and migration | Courtship and divorce hazards; young adults leaving for study and work; empty houses re-let to newcomers. |
| Health | Annual attack rates for influenza, gastroenteritis, pneumonia, tuberculosis, heart attacks, strokes, cancer, injuries, falls and more, with seasons, care-seeking and the clinics' quality of care. |
| The economy | The 2026/27 SARS tables, SASSA grants, the national minimum wage, a Monetary Policy Committee with a Taylor rule, regulated fuel prices from Brent and the rand, fares, a produce market, a mutual bank under the Mutual Banks Act and IFRS 9. |

[Basis parameters](../reference/basis.md) lists every parameter you can change, with its default and range;
[Assumptions and provenance](assumptions.md) says where each number comes from and which are proxies.

## The books

Every rand is posted to **double-entry books**: a standard chart of accounts, a hash-chained general journal, a
set of ledgers for every household, business, the church, the burial society, the Mutual Bank and the government,
and statements on IFRS for SMEs lines (trial balance, income statement, financial position, changes in equity,
cash flows) closed each February. National accounts, inflation, unemployment and the fiscal position are read from
the same books, so the macroeconomy is the sum of the households and firms you can open.

## What is measured, and how

Person-years of exposure and expected deaths accrue **daily** by age band and sex, at the basis's daily hazard.
Actual over expected (A/E) is reported with Poisson 95% intervals; births are measured against the fertility basis
the same way. See [Mortality and experience](../analytics/mortality.md) for how to read them, and
[Calibration and limits](calibration.md) for what a small province can and cannot tell you.
