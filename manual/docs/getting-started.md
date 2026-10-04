# Getting started

A first hour with Community Lab IDE: watch the province live, look inside it, read its experience, ask it a
question, and do the same from files. Each step links to the page that covers it in full.

## 1. Start the clock

The app opens on Unity Province at dawn on its first day, **paused**. Press <kbd>Space</kbd>. At the default speed,
a simulated minute a second, the province wakes: people get up, eat, and leave for work and school, on foot, by
car, by bus, by minibus taxi and on the Hyperline.

Press <kbd>5</kbd> for an hour a second, <kbd>3</kbd> to come back to a minute a second. [Time and the
clock](province/time.md) has every speed.

## 2. Pick someone and follow them

Scroll to zoom in on a settlement, and **double-click a person** to follow them. Press <kbd>]</kbd> to open the
inspector: their age, work and payslip, their family, their health, their mood, their plan for today, the people
they are closest to, their life so far. Click **household** to see the household they belong to, its finances and
this month's accounts. <kbd>Esc</kbd> steps back out. [People, households and places](province/inspector.md).

## 3. Go to church on Sunday

Click the **clock** in the top bar and choose **Sunday service**. The clock moves to the next Sunday at 09:00, and
every day in between is simulated. Fly to Emmaus or Ithemba (the buttons on the right), zoom into a church, and
watch the congregation gather; the pastor preaches, and every twenty minutes or so the room sings a hymn. Click the
pastor while he speaks to read the sermon's transcript. [Conversations](province/conversations.md).

## 4. Look closer

Keep zooming into a house and the map becomes the **3D close-up**: the camera swings down to the street, the
rooms open like a doll's house, and every resident is built from the simulation's own record of them. Hold the
right mouse button and move to look about; hold it and press <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to fly.
Wheel out to come back to the map. [The 3D close-up](province/3d.md).

## 5. Let the years run

Press <kbd>9</kbd>: a year a second. Let ten years go by, then <kbd>Space</kbd> to pause.

Click the **Mortality A/E** tile on the strip along the bottom. The drawer shows the province's deaths against the
deaths its basis expected, by age band and sex, with intervals; ⤢ makes it full screen. Then **Population** for the
pyramid and the year-by-year table. With four hundred people the figures are noisy, and the intervals say how
noisy. [Analytics](analytics/index.md), [Mortality and experience](analytics/mortality.md).

## 6. Open the books

Click **Economy**: GDP, inflation, the repo rate, unemployment. Go down the rail to **Micro** for supply and demand
in the produce market, **Books** for any household's or business's journal and statements, and **Audit**, where
**verify chain** re-checks every entry of the hash-chained journal. [Economy and finance](analytics/economy.md).

Then click **Actuarial**: the burial society priced on the province's own table, its loading, its adjustment
coefficient and a fan of a thousand simulated futures against its capital. [The actuarial
workbench](analytics/actuarial.md).

## 7. Ask a question

Click **Policy lab**. The first template, *SAM life stresses on the burial society*, lives the province with
mortality 15% heavier at every age, and with a catastrophe month, against the default province, on eight seeds of
ten years each. Press **Run on the server**. When it finishes, read the forest of effects: each change's effect on
the society's reserve, its chance of ruin and its loss ratio, with a 95% interval, and in how many of the eight
seeds it went the better way. [The policy and stress lab](analytics/lab.md).

## 8. Do it from files

Press <kbd>Ctrl</kbd>+<kbd>2</kbd> for the workbench, and on its welcome screen, **Create the sample workspace** (**File ›
New Workspace** brings the welcome screen back). Then, in the explorer:

1. Open `scripts/first-look.js` and press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>. A province of the script's own lives two
   years beside the editor, and the Console fills with its indicators, who lives where, and the last births and
   deaths.
2. Open `scenarios/ageing.province.json` and run it. The province on screen is rebuilt on an older population with
   lower fertility, and the app switches to it; <kbd>Ctrl</kbd>+<kbd>2</kbd> to come back.
3. Open `experiments/old-age-grant.experiment.json`, change `"seeds": 8` to `12`, and run it. It goes to the worker
   pool; when it is done its result is in `results/` and in the lab.

[The workbench](workbench/index.md), [Scripts](workbench/scripts.md), [The sample workspace](workbench/sample.md).

## 9. Take the data with you

Click **Exports** in the top bar. **Mortality experience** › **Pool on the worker pool** lives the province's basis on
sixteen seeds and pools their deaths and exposure; **Save to workspace** writes it into the workspace as CSV, with a
README and the true basis it was generated on. Fit a table to it in R or Python, and score the fit against the
answer. [Exports and data](exports/index.md).

## Where next

- [The model](model/index.md): how the province works, and [what it can and cannot tell you](model/calibration.md).
- [Basis parameters](reference/basis.md): every assumption you can change.
- [Keyboard and mouse](reference/shortcuts.md).
