// Payments between entities. One call posts both sides of a transaction and,
// because every community entity banks with the Mutual Bank, keeps the bank's
// deposit liabilities and its own liquid assets in step: money paid to the
// outside world leaves the bank's settlement account, money from outside
// arrives in it, and a payment between two members merely moves a deposit.

import type { FlowKind, Ledgers, PostInput } from './accounts';
import { ACCOUNT, post } from './accounts';
import type { FinanceState } from './state';

export const BANK = 'bank';
export const GOV = 'gov';
export const ROW = 'row';
export const CHURCH = 'church';
export const SCHEME = 'scheme';

export function hhEntity(householdId: string): string {
  return `hh:${householdId}`;
}

export function isOutside(entity: string): boolean {
  return entity === GOV || entity === ROW;
}

/** The account an entity keeps its money in. */
export function cashAccount(entity: string): string {
  return entity === BANK ? '1030' : '1020';
}

export interface Payment {
  from: string;
  to: string;
  amount: number;
  day: number;
  month: number;
  ref: string;
  memo: string;
  flow: FlowKind;
  /** Payer's counter-account (expense, asset or liability being settled). */
  fromAccount: string;
  /** Payee's counter-account (revenue, liability or asset). */
  toAccount: string;
  /** Extra lines on the payer's entry (e.g. VAT input) — must balance with `amount`. */
  fromExtra?: PostInput['lines'];
  /** Extra lines on the payee's entry (e.g. VAT output). */
  toExtra?: PostInput['lines'];
}

function addFlow(F: FinanceState, month: number, from: string, to: string, kind: FlowKind, amount: number): void {
  let row = F.flows[F.flows.length - 1];
  if (!row || row.month !== month) {
    row = { month, cells: {} };
    F.flows.push(row);
    if (F.flows.length > 600) F.flows.shift();
  }
  const key = `${from}>${to}>${kind}`;
  row.cells[key] = Math.round(((row.cells[key] ?? 0) + amount) * 100) / 100;
}

/**
 * Pay `amount` from one entity to another. The payer debits `fromAccount`
 * (plus any extra lines) and credits its cash; the payee debits its cash and
 * credits `toAccount` (plus extras). The bank's mirror entries follow.
 */
export function pay(F: FinanceState, p: Payment): void {
  const L = F.ledgers;
  const amt = Math.round(p.amount * 100) / 100;
  if (amt <= 0) return;
  const ctr = (self: string, other: string) => (self === BANK ? (isOutside(other) ? '1030' : '2100') : cashAccount(self));
  // The cash that actually moves: the amount plus whatever the payer's extra lines add (e.g. VAT paid on top and claimed as input tax).
  const fromExtraNet = (p.fromExtra ?? []).reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
  const cash = Math.round((amt + fromExtraNet) * 100) / 100;
  // Payer
  if (L.books[p.from]) {
    const lines: PostInput['lines'] = [{ account: p.fromAccount, debit: amt }, ...(p.fromExtra ?? [])];
    lines.push({ account: ctr(p.from, p.to), credit: cash });
    post(L, { entity: p.from, day: p.day, month: p.month, ref: p.ref, memo: p.memo, lines, counterparty: p.to, flow: p.flow });
  }
  // Payee
  if (L.books[p.to]) {
    const lines: PostInput['lines'] = [{ account: ctr(p.to, p.from), debit: cash }, ...(p.toExtra ?? [])];
    const extraNet = (p.toExtra ?? []).reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
    lines.push({ account: p.toAccount, credit: cash + extraNet });
    post(L, { entity: p.to, day: p.day, month: p.month, ref: p.ref, memo: p.memo, lines, counterparty: p.from, flow: p.flow });
  }
  // The bank's mirror: deposits move when a member pays outside or is paid from outside.
  if (p.from !== BANK && p.to !== BANK) {
    const fromIn = !isOutside(p.from);
    const toIn = !isOutside(p.to);
    if (fromIn && !toIn) post(L, { entity: BANK, day: p.day, month: p.month, ref: p.ref, memo: `Outward payment: ${p.memo}`, lines: [{ account: '2100', debit: cash }, { account: '1030', credit: cash }], counterparty: p.to, flow: p.flow });
    else if (!fromIn && toIn) post(L, { entity: BANK, day: p.day, month: p.month, ref: p.ref, memo: `Inward payment: ${p.memo}`, lines: [{ account: '1030', debit: cash }, { account: '2100', credit: cash }], counterparty: p.from, flow: p.flow });
  }
  addFlow(F, p.month, p.from, p.to, p.flow, amt);
}

/** A one-sided posting inside one book (accruals, provisions, capital, closing). */
export function postInternal(F: FinanceState, entity: string, day: number, month: number, ref: string, memo: string, lines: PostInput['lines'], flow: FlowKind = 'other', counterparty: string | null = null): void {
  post(F.ledgers, { entity, day, month, ref, memo, lines, counterparty, flow });
}

/** Deposit balance of an entity at the Mutual Bank (its 1020 account). */
export function deposits(F: FinanceState, entity: string): number {
  const b = F.ledgers.books[entity];
  return b ? (b.balances['1020'] ?? 0) : 0;
}

export function accountName(code: string): string {
  return ACCOUNT[code]?.name ?? code;
}

export interface BatchItem {
  to: string;
  amount: number;
  fromAccount: string;
  toAccount: string;
  flow?: FlowKind;
  /** Extra lines on the payee entry (e.g. output VAT). */
  toExtra?: PostInput['lines'];
  /** Extra lines on the payer entry for this item (e.g. input VAT). */
  fromExtra?: PostInput['lines'];
}

/**
 * Pay several parties from one entity in one journal entry (one payee entry
 * each, one bank mirror for the money that leaves or enters the community).
 */
export function payBatch(F: FinanceState, from: string, day: number, month: number, ref: string, memo: string, items: BatchItem[], defaultFlow: FlowKind = 'consumption'): void {
  const L = F.ledgers;
  const live = items.filter((i) => i.amount > 0.004).map((i) => ({ ...i, amount: Math.round(i.amount * 100) / 100 }));
  if (!live.length) return;
  const fromIn = !isOutside(from) && from !== BANK;
  // Payer entry
  if (L.books[from]) {
    const lines: PostInput['lines'] = [];
    let insideTotal = 0;
    let outsideTotal = 0;
    let bankTotal = 0;
    for (const it of live) {
      lines.push({ account: it.fromAccount, debit: it.amount });
      let extra = 0;
      for (const l of it.fromExtra ?? []) {
        lines.push(l);
        extra += (l.debit ?? 0) - (l.credit ?? 0);
      }
      const total = it.amount + extra;
      if (it.to === BANK) bankTotal += total;
      else if (isOutside(it.to)) outsideTotal += total;
      else insideTotal += total;
    }
    if (from === BANK) {
      if (insideTotal > 0) lines.push({ account: '2100', credit: insideTotal });
      if (outsideTotal > 0) lines.push({ account: '1030', credit: outsideTotal });
    } else lines.push({ account: cashAccount(from), credit: insideTotal + outsideTotal + bankTotal });
    post(L, { entity: from, day, month, ref, memo, lines, counterparty: live.length === 1 ? live[0].to : null, flow: defaultFlow });
  }
  // Payee entries (grouped)
  const byPayee = new Map<string, typeof live>();
  for (const it of live) (byPayee.get(it.to) ?? byPayee.set(it.to, []).get(it.to)!).push(it);
  let outward = 0;
  let inward = 0;
  for (const [to, its] of byPayee) {
    let total = 0;
    const lines: PostInput['lines'] = [];
    for (const it of its) {
      const fromExtraNet = (it.fromExtra ?? []).reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
      const cash = Math.round((it.amount + fromExtraNet) * 100) / 100;
      let extra = 0;
      for (const l of it.toExtra ?? []) {
        lines.push(l);
        extra += (l.debit ?? 0) - (l.credit ?? 0);
      }
      lines.push({ account: it.toAccount, credit: cash + extra });
      total += cash;
    }
    if (L.books[to]) {
      const cash = to === BANK ? (fromIn ? '2100' : '1030') : cashAccount(to);
      post(L, { entity: to, day, month, ref, memo, lines: [{ account: cash, debit: total }, ...lines], counterparty: from, flow: its[0].flow ?? defaultFlow });
    }
    for (const it of its) addFlow(F, month, from, to, it.flow ?? defaultFlow, it.amount);
    if (to !== BANK && from !== BANK) {
      if (fromIn && isOutside(to)) outward += total;
      else if (!fromIn && !isOutside(to)) inward += total;
    }
  }
  if (outward > 0) post(L, { entity: BANK, day, month, ref, memo: `Outward payments: ${memo}`, lines: [{ account: '2100', debit: outward }, { account: '1030', credit: outward }], counterparty: from, flow: defaultFlow });
  if (inward > 0) post(L, { entity: BANK, day, month, ref, memo: `Inward payments: ${memo}`, lines: [{ account: '1030', debit: inward }, { account: '2100', credit: inward }], counterparty: from, flow: defaultFlow });
}
