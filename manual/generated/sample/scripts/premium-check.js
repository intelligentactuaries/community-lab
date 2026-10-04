// Is the funeral premium adequate? The lab's template, run on the worker pool:
// the baseline and two arms (the premium cut and raised by a fifth) on the same
// 6 seeds for 8 years. About two minutes with eight workers.

const spec = template('premium-adequacy', 8);
spec.seeds = 6;
const r = await experiment(spec);

const m = (id) => METRICS.find((x) => x.id === id);
table(
  r.arms.slice(1).flatMap((arm) =>
    ['scheme_reserve', 'scheme_ruin', 'loss_ratio'].map((id) => ({
      arm: arm.label,
      indicator: m(id).label,
      baseline: r.arms[0].metrics[id].mean,
      effect: arm.effects[id].mean,
      lo95: arm.effects[id].lo,
      hi95: arm.effects[id].hi,
    })),
  ),
);
print('An interval that does not cross zero is an effect these seeds can tell from the province\'s own randomness.');
