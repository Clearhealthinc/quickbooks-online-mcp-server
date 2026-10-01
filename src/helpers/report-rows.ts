/**
 * Clear Health fork: flatten a QuickBooks report (P&L, Sales by Item, ...) into
 * labelled rows, for the explore CLI and for reading reports in tests.
 *
 * QBO report JSON nests Sections inside Rows.Row; a Section has a Header (its
 * label), child Rows, and a Summary (its total). Data rows carry ColData.
 */

export interface FlatRow {
  depth: number;
  kind: 'data' | 'total';
  label: string;
  values: string[];
}

export function reportColumns(report: any): string[] {
  const cols = report?.Columns?.Column;
  return Array.isArray(cols) ? cols.map((c: any) => String(c?.ColTitle ?? '')) : [];
}

export function flattenReport(report: any): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (rows: any, depth: number) => {
    const list = rows?.Row;
    if (!Array.isArray(list)) return;
    for (const row of list) {
      if (Array.isArray(row?.ColData)) {
        out.push(toRow(row.ColData, depth, 'data'));
        continue;
      }
      walk(row?.Rows, depth + 1);
      if (Array.isArray(row?.Summary?.ColData)) {
        out.push(toRow(row.Summary.ColData, depth, 'total'));
      }
    }
  };
  walk(report?.Rows, 0);
  return out;
}

function toRow(colData: any[], depth: number, kind: FlatRow['kind']): FlatRow {
  const [first, ...rest] = colData;
  return { depth, kind, label: String(first?.value ?? ''), values: rest.map((c) => String(c?.value ?? '')) };
}

/** Plain-text table of flattened rows; indentation shows nesting. */
export function renderRows(columns: string[], rows: FlatRow[]): string {
  const header = columns.join(' | ');
  const body = rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'total' ? '= ' : ''}${r.label} | ${r.values.join(' | ')}`);
  return [header, ...body].join('\n');
}
