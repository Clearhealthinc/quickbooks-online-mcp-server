import { describe, it, expect } from "@jest/globals";
import { flattenReport, renderRows, reportColumns } from "../../../src/helpers/report-rows";

// Shape of a real QBO ProfitAndLoss response (summarize_column_by=Month), trimmed.
const pnl = {
  Columns: { Column: [{ ColTitle: "" }, { ColTitle: "Jul 2026" }, { ColTitle: "Aug 2026" }, {}] },
  Rows: {
    Row: [
      {
        Header: { ColData: [{ value: "Income" }] },
        Rows: {
          Row: [
            { ColData: [{ value: "SaaS Revenue" }, { value: "6000.00" }, { value: "6000.00" }, {}] },
            {
              Header: { ColData: [{ value: "Services" }] },
              Rows: { Row: [{ ColData: [{ value: "Consulting" }, { value: "450.00" }, { value: "" }, { value: "450.00" }] }] },
              Summary: { ColData: [{ value: "Total Services" }, { value: "450.00" }, { value: "" }, { value: "450.00" }] },
            },
          ],
        },
        Summary: { ColData: [{ value: "Total Income" }, { value: "6450.00" }, { value: "6000.00" }, { value: "12450.00" }] },
      },
      { Summary: { ColData: [{ value: "Net Income" }, { value: "1.00" }] } },
      { group: "no data or rows" },
    ],
  },
};

describe("report-rows", () => {
  it("reads column titles", () => {
    expect(reportColumns(pnl)).toEqual(["", "Jul 2026", "Aug 2026", ""]);
    expect(reportColumns({})).toEqual([]);
  });

  it("flattens nested sections into data and total rows with depth", () => {
    expect(flattenReport(pnl)).toEqual([
      { depth: 1, kind: "data", label: "SaaS Revenue", values: ["6000.00", "6000.00", ""] },
      { depth: 2, kind: "data", label: "Consulting", values: ["450.00", "", "450.00"] },
      { depth: 1, kind: "total", label: "Total Services", values: ["450.00", "", "450.00"] },
      { depth: 0, kind: "total", label: "Total Income", values: ["6450.00", "6000.00", "12450.00"] },
      { depth: 0, kind: "total", label: "Net Income", values: ["1.00"] },
    ]);
    expect(flattenReport(undefined)).toEqual([]);
    expect(flattenReport({ Rows: { Row: [{ ColData: [] }] } })).toEqual([{ depth: 0, kind: "data", label: "", values: [] }]);
  });

  it("renders an indented text table", () => {
    const rows = flattenReport(pnl).slice(0, 3);
    expect(renderRows(["", "Jul"], rows)).toBe(" | Jul\n  SaaS Revenue | 6000.00 | 6000.00 | \n    Consulting | 450.00 |  | 450.00\n  = Total Services | 450.00 |  | 450.00");
  });
});
