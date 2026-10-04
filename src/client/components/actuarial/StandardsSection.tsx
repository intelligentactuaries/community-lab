import { Tbl, Viz } from '../../charts/helpers';
import { Go } from './ActuarialWorkspace';

const ROWS: Array<{ framework: string; governs: string; here: React.ReactNode }> = [
  { framework: 'The actuarial control cycle', governs: 'Specify the problem, develop the solution, monitor the experience — and go round again as the experience says. The frame every standard below sits in.', here: <><Go to="overview">Overview</Go>: the cycle with the live figures</> },
  { framework: 'ISAP 1 · SAP 901 (ASSA), General actuarial practice', governs: 'Data, assumptions and methodology fit for purpose; documentation; the basis disclosed with every result.', here: <>The hashed basis on every export; docs/ASSUMPTIONS.md and docs/ODD.md</> },
  { framework: 'Insurance Act 18 of 2017 · Prudential Standards FSI 1–7 (SAM)', governs: 'Solvency Assessment and Management: technical provisions as best estimate plus risk margin; the SCR as a 99.5% one-year value at risk (standard formula or internal model); the MCR between 25% and 45% of the SCR; eligible own funds; the own-risk and solvency assessment.', here: <><Go to="risk">Risk & solvency</Go>: the simulated SCR, the MCR corridor, the standard-formula life stresses</> },
  { framework: 'Prudential Standards FSM (microinsurance) · Friendly Societies Act 25 of 1956', governs: 'A burial society offering funeral and life benefits of this size sits in the microinsurance framework: capped benefits, simplified capital and reporting; a friendly society is exempt only below the benefit limit.', here: <><Go to="scheme">Pricing</Go>: the society’s products and loadings</> },
  { framework: 'IFRS 17 Insurance Contracts · ISAP 4 · ISAP 7', governs: 'Fulfilment cash flows on current estimates, a risk adjustment for non-financial risk and a contractual service margin under the general model; the premium allocation approach for short contracts; current estimates set as ISAP 7 has them.', here: <><Go to="scheme">Pricing</Go>: LRC and LIC for monthly renewable cover</> },
  { framework: 'IAS 19 Employee Benefits · ISAP 3 · APN 207 (ASSA)', governs: 'A defined-benefit obligation by the projected unit credit method, on a high-quality corporate bond rate; the assumptions actuaries set for it.', here: <><Go to="retirement">Retirement & grants</Go>: the projected unit credit is the same present value applied to a promised benefit</> },
  { framework: 'Pension Funds Act 24 of 1956 · SAP 201 (ASSA), Retirement fund valuation reports · the two-pot system (Revenue Laws Amendment Act 2024)', governs: 'What a fund’s statutory valuation must show: funding level, contribution rate, the basis; from 1 September 2024 contributions split into a savings component (one third) and a retirement component (two thirds).', here: <><Go to="retirement">Retirement & grants</Go>: the two pots, the annuity, the replacement ratio</> },
  { framework: 'ISAP 2, Financial analysis of social security programs', governs: 'Projection of a social-security scheme’s income and outgo on demographic and economic assumptions; open-group and closed-group valuations.', here: <><Go to="retirement">Retirement & grants</Go>: the old-age grant’s closed-group liability; <Go to="projection">Projections</Go></> },
  { framework: 'APN 105 v4 (ASSA), Minimum requirements for deriving AIDS extra mortality rates', governs: 'How a South African actuary allows for HIV in a mortality basis: the extra mortality by age, sex, risk group and calendar year.', here: <>The Heligman–Pollard hump term fitted to the Agincourt HDSS data and re-calibrated to Stats SA 2024 (docs/ASSUMPTIONS.md)</> },
  { framework: 'SAP 104 (ASSA), superseded', governs: 'The former statutory valuation basis for long-term insurers (assets, liabilities and the capital adequacy requirement), replaced by SAM’s financial soundness standards in 2018.', here: <>Kept for the record: the SCR here follows SAM</> },
  { framework: 'ISAP 5 and ISAP 6, Enterprise risk models and ERM programs', governs: 'Models used to assess risk and capital: governance, validation, sensitivity; risk appetite and the ORSA.', here: <><Go to="risk">Risk & solvency</Go>: the fan and the ruin-against-capital curve are the model’s outputs; the Monte Carlo tab its validation across replications</> },
  { framework: 'Experience analysis (the CMI / SOA practice ASSA follows)', governs: 'Exposure by age band and sex, actual against expected with confidence limits, credibility before a basis is revised.', here: <>The Mortality A/E and Fertility tabs; Poisson intervals; the pooled A/E under Monte Carlo</> },
];

export function StandardsSection() {
  return (
    <>
      <Viz title="The standards behind each figure" note="South African and international, with where each is at work on this workbench" wide>
        <Tbl>
          <table className="std">
            <thead><tr><th>Framework</th><th>What it governs</th><th>Here</th></tr></thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.framework}><td><b>{r.framework}</b></td><td>{r.governs}</td><td className="where">{r.here}</td></tr>
              ))}
            </tbody>
          </table>
        </Tbl>
      </Viz>
      <Viz title="The standard formula’s life module" note="the stresses as calibrated for SAM (aligned with Solvency II), each a 1-in-200 one-year event" wide>
        <Tbl>
          <table className="std">
            <thead><tr><th>Sub-module</th><th>Stress</th><th>Bites on</th></tr></thead>
            <tbody>
              <tr><td>Mortality</td><td>a permanent 15% increase in every qₓ</td><td>cover paying on death: term, whole life, the society’s benefits</td></tr>
              <tr><td>Longevity</td><td>a permanent 20% decrease in every qₓ</td><td>annuities in payment and deferred: pensions, the grant</td></tr>
              <tr><td>Lapse</td><td>±50% on lapse rates, and a mass lapse of 40%</td><td>contracts whose value depends on their staying in force</td></tr>
              <tr><td>Expense</td><td>+10% on expenses and +1 percentage point on expense inflation</td><td>every contract with a run-off of expenses</td></tr>
              <tr><td>Catastrophe</td><td>an absolute 1.5‰ increase in the rate of mortality in the coming year</td><td>sums at risk on death</td></tr>
              <tr><td>Aggregation</td><td>sub-modules combined by a correlation matrix (mortality–catastrophe 0.25, mortality–longevity −0.25, …), then with market, credit and operational risk</td><td>the SCR</td></tr>
            </tbody>
          </table>
        </Tbl>
        <div className="muted small">Under SAM the technical provisions are a best estimate plus a risk margin (a cost of capital on the SCR through the run-off); own funds are the excess of assets over them; the solvency ratio is own funds over the SCR. Proportionality lets a small insurer use simplifications; a microinsurer follows the FSM standards instead. On this workbench the society’s SCR is read from its simulated surplus (an internal-model view) and shown beside the two stresses of the standard formula that bite on monthly renewable cover.</div>
      </Viz>
      <div className="viz wide">
        <div className="viz-title"><h4>How the workbench uses them</h4></div>
        <div className="muted small">
          <b>Specify.</b> The basis is explicit and hashed (SAP 901): a Heligman–Pollard table from a real rural South African cohort recalibrated to Stats SA, an ASFR schedule at the published TFR, the province’s own rates. <b>Develop.</b> Premiums by the equivalence principle with loadings; reserves prospectively; capital as a one-year 99.5% value at risk (SAM) with the standard formula’s life stresses beside it; a retirement fund projected and annuitised (SAP 201, IAS 19); the state’s grant valued closed-group (ISAP 2); contracts measured as IFRS 17 would. <b>Monitor.</b> A/E with Poisson limits by band and sex, births against the schedule, loss and combined ratios year by year, the surplus against its fan, replications under Monte Carlo — and the cycle turns.
        </div>
      </div>
    </>
  );
}
