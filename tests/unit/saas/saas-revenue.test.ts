import { describe, it, expect, jest } from "@jest/globals";
import {
  buildSaasRevenue,
  defaultRange,
  fetchSaasRevenue,
  GL_COLUMNS,
  parsePostings,
  SAAS_ACCOUNTS,
  validateRange,
} from "../../../src/saas/saas-revenue";

// A GL detail report shaped like QuickBooks' real response (columns in GL_COLUMNS order).
const row = (date: string, type: string, txnId: string | undefined, doc: string, customer: string, memo: string, acctId: string, acct: string, amount: string) => ({
  ColData: [
    { value: date },
    { value: type, ...(txnId ? { id: txnId } : {}) },
    { value: doc },
    { value: customer, id: "c" },
    { value: memo },
    { value: acct, id: acctId },
    { value: amount },
  ],
});
const gl = {
  Rows: {
    Row: [
      {
        Header: { ColData: [{ value: "SaaS:Monthly SaaS Fees" }] },
        Rows: {
          Row: [
            row("2026-09-01", "Invoice", "101", "1086", "Heritage", "Subscription Fee", "84", "SaaS:Monthly SaaS Fees", "1000.00"),
            row("2026-08-01", "Invoice", "100", "1079", "Surgical", "Estimator", "84", "SaaS:Monthly SaaS Fees", "1500.00"),
            row("2026-08-01", "Invoice", "99", "1078", "Lake Charles", "MCI", "84", "SaaS:Monthly SaaS Fees", "1500.00"),
            { ColData: [{ value: "Beginning Balance" }, {}, {}, {}, {}, {}, { value: "0" }] },
          ],
        },
        Summary: { ColData: [{ value: "Total for SaaS:Monthly SaaS Fees" }] },
      },
      {
        Header: { ColData: [{ value: "SaaS:SaaS Implementation Fees" }] },
        Rows: { Row: [row("2026-07-22", "Invoice", "98", "1073", "Omega", "One Time", "85", "SaaS:SaaS Implementation Fees", "20000.00")] },
      },
      // Defense in depth: a row on another account must never come out, even if the report contained it.
      { Rows: { Row: [row("2026-08-15", "Journal Entry", "7", "", "", "Payroll", "60", "Payroll Expenses:Salaries & Wages", "99999.00")] } },
      row("2026-08-20", "Credit Memo", "55", "CM1", "Surgical", "credit", "84", "SaaS:Monthly SaaS Fees", "-100.00"),
    ],
  },
};
const items = [
  { Id: "2", IncomeAccountRef: { value: "84" } },
  { Id: "3", IncomeAccountRef: { value: "85" } },
  { Id: "1010000001", IncomeAccountRef: { value: "67" } },
  { Id: "9" },
];
const saasLine = (item: string, amount: number, description?: string) => ({ Amount: amount, Description: description, SalesItemLineDetail: { ItemRef: { value: item } } });
const invoices = [
  { Id: "101", DocNumber: "1086", TxnDate: "2026-09-01", DueDate: "2026-10-01", CustomerRef: { name: "Heritage" }, TotalAmt: 1097.5, Balance: 1097.5,
    Line: [saasLine("2", 1000, "Subscription Fee"), { Amount: 97.5, Description: "processing fee", SalesItemLineDetail: { ItemRef: { value: "1010000001" } } }, { Amount: 1097.5, DetailType: "SubTotalLineDetail" }] },
  { Id: "100", DocNumber: "1079", TxnDate: "2026-08-01", DueDate: "2026-08-31", CustomerRef: { name: "Surgical" }, TotalAmt: 1500, Balance: 1500, Line: [saasLine("2", 1500)] },
  { Id: "99", DocNumber: "1078", TxnDate: "2026-08-01", DueDate: "2026-08-31", CustomerRef: { name: "Lake Charles" }, TotalAmt: 1500, Balance: 0, Line: [saasLine("2", 1500, "MCI")] },
  { Id: "98", DocNumber: "1073", TxnDate: "2026-07-22", CustomerRef: { name: "Omega" }, TotalAmt: 20000, Balance: 5000, Line: [saasLine("3", 20000)] },
  // Not a SaaS posting: must be ignored even though it was returned.
  { Id: "50", DocNumber: "9", TxnDate: "2026-08-01", CustomerRef: { name: "Other" }, TotalAmt: 10, Balance: 10, Line: [saasLine("2", 10)] },
  // A posted invoice whose lines are no longer SaaS items: dropped.
  { Id: "55", DocNumber: "CM1", TxnDate: "2026-08-20", CustomerRef: { name: "Surgical" }, TotalAmt: 5, Balance: 5, Line: [saasLine("1010000001", 5)] },
];
const payments = [
  { TxnDate: "2026-08-14", Line: [{ LinkedTxn: [{ TxnType: "Invoice", TxnId: "99" }, { TxnType: "CreditMemo", TxnId: "55" }] }] },
  { TxnDate: "2026-03-06", Line: [{ LinkedTxn: [{ TxnType: "Invoice", TxnId: "99" }] }] },
  { TxnDate: "2026-08-27" },
];

describe("validateRange / defaultRange", () => {
  it("accepts a valid range", () => expect(() => validateRange("2026-01-01", "2026-01-01")).not.toThrow());
  it("refuses bad formats, impossible dates and reversed ranges", () => {
    expect(() => validateRange("2026-1-1", "2026-02-01")).toThrow("YYYY-MM-DD");
    expect(() => validateRange("2026-01-01", "x")).toThrow("YYYY-MM-DD");
    expect(() => validateRange("2026-13-45", "2026-12-31")).toThrow("YYYY-MM-DD");
    expect(() => validateRange("2026-03-01", "2026-02-01")).toThrow("on or before");
  });
  it("defaults to 12 months including the current one", () =>
    expect(defaultRange(new Date("2026-10-01T15:00:00Z"))).toEqual({ start: "2025-11-01", end: "2026-10-01" }));
});

describe("parsePostings", () => {
  it("keeps only rows on the two SaaS accounts, sorted, with the invoice id for invoices only", () => {
    const rows = parsePostings(gl);
    expect(rows.map((r) => [r.posting.date, r.posting.invoice, r.accountId, r.invoiceId])).toEqual([
      ["2026-07-22", "1073", "85", "98"],
      ["2026-08-01", "1078", "84", "99"],
      ["2026-08-01", "1079", "84", "100"],
      ["2026-08-20", "CM1", "84", undefined],
      ["2026-09-01", "1086", "84", "101"],
    ]);
    expect(rows.some((r) => r.posting.description === "Payroll")).toBe(false);
    expect(rows[0].posting).toEqual({ date: "2026-07-22", invoice: "1073", customer: "Omega", account: "SaaS Implementation Fees", description: "One Time", amount: 20000 });
  });
  it("tolerates an empty or partial report", () => {
    expect(parsePostings(undefined)).toEqual([]);
    expect(parsePostings({ Rows: { Row: [{ ColData: [{}, {}, {}, {}, {}, { id: "84" }, {}] }] } })).toEqual([]);
    expect(parsePostings({ Rows: { Row: [{ ColData: [{ value: "2026-01-01" }, {}, {}, {}, {}, { id: "84" }, {}] }] } })[0].posting).toEqual({
      date: "2026-01-01", invoice: "", customer: "", account: "Monthly SaaS Fees", description: "", amount: 0,
    });
  });
});

describe("buildSaasRevenue", () => {
  const r = buildSaasRevenue({ start: "2026-07-01", end: "2026-09-30", today: "2026-10-01", glReport: gl, invoices, items, payments });

  it("totals by account, month and customer from SaaS postings only", () => {
    expect(r.totals).toEqual({ monthlyFees: 3900, implementationFees: 20000, total: 23900, openSaas: 7500, overdueSaas: 1500 });
    expect(r.monthly).toEqual([
      { month: "2026-07", monthlyFees: 0, implementationFees: 20000, total: 20000 },
      { month: "2026-08", monthlyFees: 2900, implementationFees: 0, total: 2900 },
      { month: "2026-09", monthlyFees: 1000, implementationFees: 0, total: 1000 },
    ]);
    expect(r.byCustomer.map((c) => [c.customer, c.total])).toEqual([["Omega", 20000], ["Lake Charles", 1500], ["Surgical", 1400], ["Heritage", 1000]]);
    expect(r.byCustomer.find((c) => c.customer === "Surgical")!.byMonth).toEqual({ "2026-08": 1400 });
    expect(r.accounts).toEqual(Object.values(SAAS_ACCOUNTS));
  });

  it("returns only SaaS lines of SaaS invoices, never other lines or other invoices", () => {
    expect(r.invoices.map((i) => i.invoice)).toEqual(["1073", "1078", "1079", "1086"]);
    const heritage = r.invoices.find((i) => i.invoice === "1086")!;
    expect(heritage.saasLines).toEqual([{ account: "Monthly SaaS Fees", description: "Subscription Fee", amount: 1000 }]);
    expect(JSON.stringify(r)).not.toContain("processing fee");
    expect(JSON.stringify(r)).not.toContain("97.5");
    expect(JSON.stringify(r)).not.toContain("99999");
  });

  it("derives status, open SaaS amount, overdue and payment dates", () => {
    const by = Object.fromEntries(r.invoices.map((i) => [i.invoice, i]));
    expect(by["1078"]).toMatchObject({ status: "paid", openSaasAmount: 0, overdue: false, paymentDates: ["2026-03-06", "2026-08-14"] });
    expect(by["1079"]).toMatchObject({ status: "open", openSaasAmount: 1500, overdue: true, paymentDates: [] });
    expect(by["1086"]).toMatchObject({ status: "open", openSaasAmount: 1000, overdue: false, dueDate: "2026-10-01" });
    expect(by["1073"]).toMatchObject({ status: "partially paid", openSaasAmount: 5000, overdue: false, dueDate: "" });
  });

  it("orders customers with equal totals by name", () => {
    const tie = buildSaasRevenue({
      start: "2026-01-01", end: "2026-01-31", today: "2026-02-01", invoices: [], items, payments: [],
      glReport: { Rows: { Row: [row("2026-01-05", "Invoice", "1", "1", "Zeta", "", "84", "x", "10"), row("2026-01-05", "Invoice", "2", "2", "Alpha", "", "84", "x", "10")] } },
    });
    expect(tie.byCustomer.map((c) => c.customer)).toEqual(["Alpha", "Zeta"]);
  });

  it("handles missing optional fields", () => {
    const bare = buildSaasRevenue({
      start: "2026-01-01", end: "2026-01-31", today: "2026-02-01",
      glReport: { Rows: { Row: [row("2026-01-05", "Invoice", "1", "", "", "", "84", "x", "10")] } },
      invoices: [{ Id: "1", TxnDate: "2026-01-05", Line: [{ SalesItemLineDetail: { ItemRef: { value: "2" } } }] }, { Id: "1", TxnDate: "2026-01-05" }],
      items, payments: [{ TxnDate: "2026-01-06", Line: [{}] }],
    });
    expect(bare.invoices).toEqual([{ invoice: "", date: "2026-01-05", dueDate: "", customer: "", saasLines: [{ account: "Monthly SaaS Fees", description: "", amount: 0 }], saasAmount: 0, status: "paid", openSaasAmount: 0, overdue: false, paymentDates: [] }]);
  });
});

describe("fetchSaasRevenue", () => {
  const cb = (data: unknown) => (...args: any[]) => args[args.length - 1](null, data);
  const fakeQb = () => ({
    reportGeneralLedgerDetail: jest.fn(cb(gl)),
    findInvoices: jest.fn(cb({ QueryResponse: { Invoice: invoices } })),
    findItems: jest.fn(cb({ QueryResponse: { Item: items } })),
    findPayments: jest.fn(cb({ QueryResponse: { Payment: payments } })),
  });

  it("asks QuickBooks only for the two SaaS accounts, then the invoices those postings belong to", async () => {
    const qb = fakeQb();
    const r = await fetchSaasRevenue(qb, "2026-07-01", "2026-09-30", new Date("2026-10-01T12:00:00Z"));
    expect((qb.reportGeneralLedgerDetail.mock.calls[0] as any[])[0]).toEqual({
      start_date: "2026-07-01", end_date: "2026-09-30", account: "84,85", accounting_method: "Accrual", columns: GL_COLUMNS.join(","),
    });
    expect((qb.findInvoices.mock.calls[0] as any[])[0]).toEqual([{ field: "Id", value: ["98", "99", "100", "101"], operator: "IN" }]);
    expect(r.totals.total).toBe(23900);
  });

  it("chunks invoice lookups by 50", async () => {
    const many = { Rows: { Row: Array.from({ length: 120 }, (_, i) => row("2026-01-01", "Invoice", String(i), String(i), "c", "", "84", "x", "1")) } };
    const qb = { ...fakeQb(), reportGeneralLedgerDetail: jest.fn(cb(many)), findInvoices: jest.fn(cb({})) , findItems: jest.fn(cb({})), findPayments: jest.fn(cb({})) };
    const r = await fetchSaasRevenue(qb, "2026-01-01", "2026-01-31");
    expect(qb.findInvoices.mock.calls.map((c: any[]) => c[0][0].value.length)).toEqual([50, 50, 20]);
    expect(r.invoices).toEqual([]);
  });

  it("makes no other calls when there are no SaaS postings", async () => {
    const qb = { ...fakeQb(), reportGeneralLedgerDetail: jest.fn(cb({})) };
    await fetchSaasRevenue(qb, "2026-01-01", "2026-01-31");
    expect(qb.findInvoices).not.toHaveBeenCalled();
    expect(qb.findItems).not.toHaveBeenCalled();
    expect(qb.findPayments).not.toHaveBeenCalled();
  });

  it("rejects a bad range before calling QuickBooks, and surfaces QuickBooks errors", async () => {
    const qb = fakeQb();
    await expect(fetchSaasRevenue(qb, "bad", "2026-01-31")).rejects.toThrow("YYYY-MM-DD");
    expect(qb.reportGeneralLedgerDetail).not.toHaveBeenCalled();
    const failing = { ...qb, reportGeneralLedgerDetail: jest.fn((...a: any[]) => a[a.length - 1](new Error("boom"))) };
    await expect(fetchSaasRevenue(failing, "2026-01-01", "2026-01-31")).rejects.toThrow("boom");
  });
});
