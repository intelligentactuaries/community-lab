// The finance workspace inside the analytics drawer: one place for the
// community's economics (micro and macro), its books (journal, ledgers and
// statements), the Mutual Bank, the burial society, SARS and the audit trail.
// A section rail keeps the community view untouched: two tiles open it.

import { CardGrid } from '../../charts/helpers';
import { InsuranceTab } from '../AnalyticsDrawer';
import { store, useStore } from '../../lib/simStore';
import { BankSection } from './BankSection';
import { BooksSection } from './BooksSection';
import { MacroSection, MicroSection, OverviewSection } from './EconomicsSections';
import { AuditSection, TaxSection } from './TaxSection';
import { TransportSection } from './TransportSection';

export const FINANCE_SECTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'overview', label: 'Overview', hint: 'GDP, prices, jobs, money and the circular flow' },
  { id: 'micro', label: 'Micro', hint: 'Supply and demand, labour market, Engel curve, consumer choice' },
  { id: 'macro', label: 'Macro', hint: 'AD–AS, Phillips and Okun, fiscal balance, credit, inequality' },
  { id: 'transport', label: 'Transport', hint: 'Fuel prices, the MPC, fares, e-hailing, Unity Transit, the airport' },
  { id: 'books', label: 'Books', hint: 'Journal, ledgers, trial balance, income statement, balance sheet, cash flow' },
  { id: 'bank', label: 'Mutual Bank', hint: 'Deposits, loans, IFRS 9 staging, prudential returns, dividends' },
  { id: 'society', label: 'Burial society', hint: 'Surplus process of the funeral and life scheme' },
  { id: 'tax', label: 'Tax & SARS', hint: 'PAYE, UIF, SDL, VAT, company tax, filings, assessments, compliance' },
  { id: 'audit', label: 'Audit', hint: 'Hash-chained journal, articulation checks, exceptions, provenance' },
];

export function FinanceWorkspace() {
  const st = useStore();
  const section = FINANCE_SECTIONS.some((s) => s.id === st.financeSection) ? st.financeSection : 'overview';
  const F = st.sim.world.finance;
  const ready = F && F.macro.months.length > 0;
  return (
    <div className="fin">
      <div className="fin-rail" role="tablist">
        {FINANCE_SECTIONS.map((s) => (
          <button key={s.id} role="tab" className={`tab ${section === s.id ? 'active' : ''}`} title={s.hint} onClick={() => store.setFinance({ section: s.id })}>
            {s.label}
          </button>
        ))}
      </div>
      <CardGrid className="fin-body scroll" full={st.drawerFull} deps={[section, st.financeEntity, st.sim.world.day]} maxCols={section === 'micro' ? 4 : undefined}>
        {!ready && <div className="viz wide note"><div className="empty">The books open after the first month closes.</div></div>}
        {ready && section === 'overview' && <OverviewSection />}
        {ready && section === 'micro' && <MicroSection />}
        {ready && section === 'macro' && <MacroSection />}
        {ready && section === 'transport' && <TransportSection />}
        {ready && section === 'books' && <BooksSection />}
        {ready && section === 'bank' && <BankSection />}
        {ready && section === 'society' && <InsuranceTab />}
        {ready && section === 'tax' && <TaxSection />}
        {ready && section === 'audit' && <AuditSection />}
      </CardGrid>
    </div>
  );
}

/** A row of headline figures. */
export function Kpis({ items }: { items: Array<{ label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'err' }> }) {
  return (
    <div className="kpis">
      {items.map((k) => (
        <div key={k.label} className="kpi">
          <div className="label">{k.label}</div>
          <div className={`value ${k.tone ?? ''}`}>{k.value}</div>
          {k.sub && <div className="sub">{k.sub}</div>}
        </div>
      ))}
    </div>
  );
}
