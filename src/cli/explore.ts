#!/usr/bin/env node
/**
 * Clear Health fork: read-only survey of how revenue is booked in QuickBooks.
 *
 *   npm run build && npm run explore            # last 12 full months
 *   npm run explore -- 2026-01-01 2026-09-30    # explicit range
 *
 * Prints the revenue accounts, the products/services and which income account
 * each posts to, the income half of the P&L by month, and sales by product,
 * so we can see how SaaS revenue is separated before teaching Cyrus to read it.
 * The raw report JSON is also written to capture-explore-<date>.json
 * (gitignored: it holds real company figures). Every call here is a read.
 */
import fs from 'fs';
import { QuickbooksClient } from '../clients/quickbooks-client.js';
import { installIntuitTidLogging } from '../helpers/intuit-tid.js';
import { flattenReport, renderRows, reportColumns } from '../helpers/report-rows.js';

function lastTwelveFullMonths(today = new Date()): [string, string] {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

function call<T>(fn: (cb: (err: any, data: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, data) => (err ? reject(err) : resolve(data))));
}

async function main() {
  installIntuitTidLogging();
  const [start, end] = process.argv[2] && process.argv[3] ? [process.argv[2], process.argv[3]] : lastTwelveFullMonths();
  const qb: any = await QuickbooksClient.getInstance();
  const raw: Record<string, unknown> = { range: { start, end } };

  const company: any = await call((cb) => qb.getCompanyInfo(qb.realmId, cb));
  console.log(`# ${company?.CompanyName ?? 'Company'} (fiscal year starts ${company?.FiscalYearStartMonth ?? '?'})`);
  console.log(`Range: ${start} to ${end}\n`);

  const accounts: any = await call((cb) => qb.findAccounts({ fetchAll: true }, cb));
  const revenue = (accounts?.QueryResponse?.Account ?? []).filter((a: any) => a.Classification === 'Revenue');
  raw.revenueAccounts = revenue;
  console.log(`## Revenue accounts (${revenue.length})`);
  for (const a of revenue) {
    console.log(`- [${a.Id}] ${a.FullyQualifiedName} | ${a.AccountType} / ${a.AccountSubType}${a.Active ? '' : ' | INACTIVE'}`);
  }

  const items: any = await call((cb) => qb.findItems({ fetchAll: true }, cb));
  const itemList = items?.QueryResponse?.Item ?? [];
  raw.items = itemList;
  console.log(`\n## Products/services (${itemList.length}) -> income account`);
  for (const i of itemList) {
    console.log(`- [${i.Id}] ${i.FullyQualifiedName ?? i.Name} | ${i.Type} -> ${i.IncomeAccountRef?.name ?? '(none)'}${i.Active ? '' : ' | INACTIVE'}`);
  }

  const pnl: any = await call((cb) => qb.reportProfitAndLoss({ start_date: start, end_date: end, summarize_column_by: 'Month', accounting_method: 'Accrual' }, cb));
  raw.profitAndLossByMonth = pnl;
  const pnlRows = flattenReport(pnl);
  const incomeEnd = pnlRows.findIndex((r) => r.kind === 'total' && /^total income$/i.test(r.label));
  console.log('\n## P&L income by month (accrual)');
  console.log(renderRows(reportColumns(pnl), incomeEnd === -1 ? pnlRows : pnlRows.slice(0, incomeEnd + 1)));

  const itemSales: any = await call((cb) => qb.reportItemSales({ start_date: start, end_date: end }, cb));
  raw.salesByItem = itemSales;
  console.log('\n## Sales by product/service');
  console.log(renderRows(reportColumns(itemSales), flattenReport(itemSales)));

  const file = `capture-explore-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2), { mode: 0o600 });
  console.log(`\nRaw report JSON written to ${file} (gitignored; contains real figures).`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : JSON.stringify(err));
    process.exit(1);
  },
);
