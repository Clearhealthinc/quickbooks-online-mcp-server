/**
 * Clear Health fork: the ONLY QuickBooks data the SaaS server can return.
 *
 * Everything is scoped to the two SaaS income accounts below, hardcoded on
 * purpose. To read anything else, change this file in a reviewed PR. There is
 * no parameter, env var or prompt that widens it.
 *
 * What is returned: SaaS postings (invoice lines on those accounts), monthly
 * and per-customer totals, and for each SaaS invoice its SaaS lines only, due
 * date and paid/open status. Non-SaaS invoice lines, other accounts, vendors,
 * employees, payroll and bank data are never returned.
 *
 * Reads made to compute it: the general ledger detail filtered to these two
 * accounts, the invoices those postings belong to, the item list (to know which
 * products post to these accounts) and customer payments (to link payment
 * dates to SaaS invoices). Only the SaaS-related parts leave this module.
 */

export const SAAS_ACCOUNTS: Readonly<Record<string, string>> = Object.freeze({
  '84': 'Monthly SaaS Fees',
  '85': 'SaaS Implementation Fees',
});
const MONTHLY = '84';

/** Columns requested from the general ledger, in this order. */
export const GL_COLUMNS = ['tx_date', 'txn_type', 'doc_num', 'name', 'memo', 'account_name', 'subt_nat_amount'] as const;

export interface SaasPosting {
  date: string;
  invoice: string;
  customer: string;
  account: string;
  description: string;
  amount: number;
}

export interface SaasInvoice {
  invoice: string;
  date: string;
  dueDate: string;
  customer: string;
  saasLines: { account: string; description: string; amount: number }[];
  saasAmount: number;
  status: 'paid' | 'partially paid' | 'open';
  openSaasAmount: number;
  overdue: boolean;
  paymentDates: string[];
}

export interface SaasRevenue {
  range: { start: string; end: string };
  basis: string;
  accounts: string[];
  totals: { monthlyFees: number; implementationFees: number; total: number; openSaas: number; overdueSaas: number };
  monthly: { month: string; monthlyFees: number; implementationFees: number; total: number }[];
  byCustomer: { customer: string; monthlyFees: number; implementationFees: number; total: number; byMonth: Record<string, number> }[];
  postings: SaasPosting[];
  invoices: SaasInvoice[];
  notes: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round = (n: number) => Math.round(n * 100) / 100;

export function validateRange(start: string, end: string): void {
  if (!DATE.test(start) || !DATE.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    throw new Error('start_date and end_date must be YYYY-MM-DD');
  }
  if (start > end) throw new Error('start_date must be on or before end_date');
}

/** Default range: the first day of the month 11 months back, through today (12 months including this one). */
export function defaultRange(today: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  return { start: start.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10) };
}

/** Pull posting rows out of the GL detail report, keeping ONLY rows on the SaaS accounts. */
export function parsePostings(glReport: any): { posting: SaasPosting; accountId: string; invoiceId: string | undefined }[] {
  const out: { posting: SaasPosting; accountId: string; invoiceId: string | undefined }[] = [];
  const walk = (rows: any) => {
    for (const row of rows?.Row ?? []) {
      if (Array.isArray(row?.ColData)) {
        const c = row.ColData;
        const accountId = String(c[5]?.id ?? '');
        if (!DATE.test(c[0]?.value ?? '') || !(accountId in SAAS_ACCOUNTS)) continue;
        out.push({
          accountId,
          invoiceId: c[1]?.value === 'Invoice' ? c[1]?.id : undefined,
          posting: {
            date: c[0].value,
            invoice: c[2]?.value ?? '',
            customer: c[3]?.value ?? '',
            account: SAAS_ACCOUNTS[accountId],
            description: c[4]?.value ?? '',
            amount: Number(c[6]?.value ?? 0),
          },
        });
      } else {
        walk(row?.Rows);
      }
    }
  };
  walk(glReport?.Rows);
  return out.sort((a, b) => a.posting.date.localeCompare(b.posting.date) || a.posting.invoice.localeCompare(b.posting.invoice));
}

export function buildSaasRevenue(input: {
  start: string;
  end: string;
  today: string;
  glReport: any;
  invoices: any[];
  items: any[];
  payments: any[];
}): SaasRevenue {
  const rows = parsePostings(input.glReport);
  const saasItems = new Map<string, string>();
  for (const item of input.items) {
    const acct = String(item?.IncomeAccountRef?.value ?? '');
    if (acct in SAAS_ACCOUNTS) saasItems.set(String(item.Id), acct);
  }

  const paymentsByInvoice = new Map<string, string[]>();
  for (const p of input.payments) {
    for (const line of p?.Line ?? []) {
      for (const linked of line?.LinkedTxn ?? []) {
        if (linked?.TxnType !== 'Invoice') continue;
        const list = paymentsByInvoice.get(String(linked.TxnId)) ?? [];
        list.push(p.TxnDate);
        paymentsByInvoice.set(String(linked.TxnId), list);
      }
    }
  }

  const postedInvoiceIds = new Set(rows.map((r) => r.invoiceId).filter(Boolean) as string[]);
  const invoices: SaasInvoice[] = [];
  for (const inv of input.invoices) {
    if (!postedInvoiceIds.has(String(inv?.Id))) continue;
    const saasLines = (inv.Line ?? [])
      .filter((l: any) => saasItems.has(String(l?.SalesItemLineDetail?.ItemRef?.value)))
      .map((l: any) => ({
        account: SAAS_ACCOUNTS[saasItems.get(String(l.SalesItemLineDetail.ItemRef.value))!],
        description: l.Description ?? '',
        amount: Number(l.Amount ?? 0),
      }));
    if (saasLines.length === 0) continue;
    const saasAmount = round(saasLines.reduce((s: number, l: { amount: number }) => s + l.amount, 0));
    const balance = Number(inv.Balance ?? 0);
    const total = Number(inv.TotalAmt ?? 0);
    const status: SaasInvoice['status'] = balance <= 0 ? 'paid' : balance >= total ? 'open' : 'partially paid';
    const openSaasAmount = status === 'paid' ? 0 : round(Math.min(balance, saasAmount));
    invoices.push({
      invoice: inv.DocNumber ?? '',
      date: inv.TxnDate,
      dueDate: inv.DueDate ?? '',
      customer: inv.CustomerRef?.name ?? '',
      saasLines,
      saasAmount,
      status,
      openSaasAmount,
      overdue: openSaasAmount > 0 && !!inv.DueDate && inv.DueDate < input.today,
      paymentDates: [...(paymentsByInvoice.get(String(inv.Id)) ?? [])].sort(),
    });
  }
  invoices.sort((a, b) => a.date.localeCompare(b.date) || a.invoice.localeCompare(b.invoice));

  const monthly = new Map<string, { monthlyFees: number; implementationFees: number }>();
  const customers = new Map<string, { monthlyFees: number; implementationFees: number; byMonth: Record<string, number> }>();
  for (const { posting, accountId } of rows) {
    const month = posting.date.slice(0, 7);
    const key = accountId === MONTHLY ? 'monthlyFees' : 'implementationFees';
    const m = monthly.get(month) ?? { monthlyFees: 0, implementationFees: 0 };
    m[key] = round(m[key] + posting.amount);
    monthly.set(month, m);
    const c = customers.get(posting.customer) ?? { monthlyFees: 0, implementationFees: 0, byMonth: {} };
    c[key] = round(c[key] + posting.amount);
    c.byMonth[month] = round((c.byMonth[month] ?? 0) + posting.amount);
    customers.set(posting.customer, c);
  }

  const sum = (f: (r: { posting: SaasPosting; accountId: string }) => boolean) => round(rows.filter(f).reduce((s, r) => s + r.posting.amount, 0));
  const monthlyFees = sum((r) => r.accountId === MONTHLY);
  const implementationFees = sum((r) => r.accountId !== MONTHLY);

  return {
    range: { start: input.start, end: input.end },
    basis: 'Accrual: revenue is counted on the invoice date.',
    accounts: Object.values(SAAS_ACCOUNTS),
    totals: {
      monthlyFees,
      implementationFees,
      total: round(monthlyFees + implementationFees),
      openSaas: round(invoices.reduce((s, i) => s + i.openSaasAmount, 0)),
      overdueSaas: round(invoices.filter((i) => i.overdue).reduce((s, i) => s + i.openSaasAmount, 0)),
    },
    monthly: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v, total: round(v.monthlyFees + v.implementationFees) })),
    byCustomer: [...customers.entries()]
      .map(([customer, v]) => ({ customer, ...v, total: round(v.monthlyFees + v.implementationFees) }))
      .sort((a, b) => b.total - a.total || a.customer.localeCompare(b.customer)),
    postings: rows.map((r) => r.posting),
    invoices,
    notes: [
      'Invoice dates are not service months: a catch-up invoice puts an earlier month\'s fee in the month it was billed.',
      'Payment dates are as recorded in QuickBooks; some payments are applied to invoices dated after the payment, so "collected by month" can be misleading.',
      'The latest month may not be fully invoiced or closed yet.',
    ],
  };
}

/** Network side: the only QuickBooks calls the SaaS server makes. */
export async function fetchSaasRevenue(qb: any, start: string, end: string, today: Date = new Date()): Promise<SaasRevenue> {
  validateRange(start, end);
  const call = <T>(fn: (cb: (err: any, data: T) => void) => void) =>
    new Promise<T>((resolve, reject) => fn((err, data) => (err ? reject(err) : resolve(data))));

  const glReport = await call<any>((cb) =>
    qb.reportGeneralLedgerDetail(
      { start_date: start, end_date: end, account: Object.keys(SAAS_ACCOUNTS).join(','), accounting_method: 'Accrual', columns: GL_COLUMNS.join(',') },
      cb,
    ),
  );
  const ids = [...new Set(parsePostings(glReport).map((r) => r.invoiceId).filter(Boolean) as string[])];

  const invoices: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await call<any>((cb) => qb.findInvoices([{ field: 'Id', value: chunk, operator: 'IN' }], cb));
    invoices.push(...(res?.QueryResponse?.Invoice ?? []));
  }
  const items = ids.length ? ((await call<any>((cb) => qb.findItems({ fetchAll: true }, cb)))?.QueryResponse?.Item ?? []) : [];
  const payments = ids.length ? ((await call<any>((cb) => qb.findPayments({ fetchAll: true }, cb)))?.QueryResponse?.Payment ?? []) : [];

  return buildSaasRevenue({ start, end, today: today.toISOString().slice(0, 10), glReport, invoices, items, payments });
}
