# Scenario and basis

Every assumption the province lives on is a parameter of its **basis**. The *Scenario & basis* section of the left
panel (<kbd>[</kbd>) changes the most used of them; a [province file](../workbench/province-files.md) in the workbench
can change any of them, and add a mortality table and timed shocks.

<figure class="cl-shot" markdown>
![The Scenario and basis panel](../assets/img/scenario.webp)
<figcaption>Scenario &amp; basis: the seed, the presets and the sliders. Changes are a draft until you press Rebuild province.</figcaption>
</figure>

## Changing the scenario

1. Open the left panel and the **Scenario & basis** section. Its header shows the current basis hash.
2. Change what you like. The changes are a **draft**: nothing happens to the province yet.
3. Press **Rebuild province**. The province is rebuilt **from day 0, on the same seed**, so the run before and the
   run after are comparable: everything the change does not touch happens exactly as before. The rebuilt province
   waits, paused.

On a world from the [Community Builder](../builder/index.md) the button reads **Rebuild the world**, and the same
holds for that world.

**defaults** puts the draft back to the default basis (press **Rebuild province** to apply it). The default basis
is the built-in province's, so on a built world **defaults** and a rebuild take you back to the province; the world
stays in the builder's saved worlds if you saved it. **Monte Carlo…** opens the
[Monte Carlo](../analytics/monte-carlo.md) tab, to run many seeds of the basis you have built.

The app remembers the basis you built, and the world it runs on, and starts on them next time. A world too large
for the app's storage is not kept across launches: save it in the builder.

## What the panel sets

**The run and its presets**

| Field | Default | Choices |
|---|---|---|
| Seed | `agincourt-12` | Any text. The same seed and basis give the same province. |
| Start date | 4 January 2026 | |
| Place name | Ebenezer | The original village's name, carried into the first city's institutions. |
| Age profile | balanced | young (many children), balanced, ageing |
| Health profile | South Africa, rural | South Africa, rural; South Africa, urban; developed country |
| Mortality basis | South Africa 2024 (Stats SA calibrated) | the four [presets](../reference/basis.md#mortality-presets) |
| HIV dynamics | on | on, off |
| Fertility shape | South African (early plateau) | South African, late (developed) |
| Climate | Highveld (Johannesburg) | Highveld, Western Cape (Stellenbosch), KZN coast (Durban), Temperate north (generic) |
| Adult education mix at start | 3 / 15 / 32 / 30 / 16 / 4% | none, primary, secondary, matric, tertiary, postgraduate; used as relative weights |

**The sliders**

| Group | Sliders (default) |
|---|---|
| Population | Households at start (12; 1 to 16), Mean household size (4.2), Male share at birth (0.503), Homeschool share (15%), Matric → tertiary (35%) |
| Mortality & health | Mortality improvement a year (1.0%), Widowhood mortality × (1.6), Poverty mortality × (1.15), Clinic care quality (55%), Seasonal flu attack rate (12%) |
| Fertility & family | Total fertility rate (2.41), Extra contraception share (0%), Peak marriage age, men (30) and women (27), Courtship hazard a year (28%), Divorce hazard a year (0.6%), Church attendance (95%) |
| Migration & safety | Youth emigration a year (5%), Vacant house re-let a year (25%), Intruder visits a year (6), Disputes per 100 people a year (25), Police effectiveness × (1), Road accidents per 1,000 km (0.0035), Car ownership (60%), Hyperline cruise in Mach (5) |
| Economy & insurance | Funeral premium (R120 a month), Funeral benefit (R25,000), Life cover sum (R100,000), Life premium (R120 a month per adult), Households with funeral cover (75%), life cover (35%) and medical aid (30%), Scheme opening reserve (R200,000), Child grant (R580 a month), Old-age grant (R2,400 a month), Poverty line (R1,634 a person a month), Retirement age (65) |

!!! note "Ebenezer's numbers"
    *Households at start*, the education mix, car ownership and the three cover shares are Ebenezer's, the original
    village's. Every other settlement takes its wealth tier's profile, so the default province still starts with
    100 households. A province file can set the tiers' shares too (`basis.tiers`).

    On a built world these numbers go to its **baseline settlement**, if one is set in the builder; without one,
    every settlement takes its tier's profile.

[Basis parameters](../reference/basis.md) gives every parameter's meaning, range and default, including those the
panel does not show: the repo rate and inflation at the start, the minimum wage, the bank's capital, tithes and tax
indexation, the settlement tiers, the region's name.

## Beyond the panel

| To | Use |
|---|---|
| Change a parameter the panel does not show | A [province file](../workbench/province-files.md) with it in `basis` |
| Live on a mortality table of your own | **Exports › Import a mortality table (CSV)**, or a province file's `mortality` |
| Put the province through a pandemic, a rate stress or an oil shock | A province file's `shocks` |
| Save the scenario you built as a file | **File › New › The Province on Screen, as a File** |
| Keep or share a world you built | **Save** or **Download .sce** in the [Community Builder](../builder/index.md) |

A province file always rebuilds the built-in province, whatever world is on screen: a world's buildings travel in its
`.sce` file, not in a province file.
| Compare a change against the province as it is, with intervals | The [policy and stress lab](../analytics/lab.md), or an [experiment file](../workbench/experiment-files.md) |

## The basis hash

The whole basis (every parameter, the seed, a supplied table and any shocks) is fingerprinted as the **basis
hash**, shown in the panel's header, on the *Basis* tile of the analytics strip, and on every export. On a built
world the world's own fingerprint goes into it too. The same hash means the same province. The **assumptions hash**
leaves out the seed and the fields that name or tune a run without changing what it assumes (the place and region
names, the Hyperline's speed, how many months of journal the books keep), so every seed of one basis shares it. It
keeps the world's fingerprint, so runs pool only within one world.
