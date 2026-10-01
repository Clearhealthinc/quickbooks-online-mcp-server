import { z } from 'zod';
import { QuickbooksClient } from '../clients/quickbooks-client.js';
import { formatError } from '../helpers/format-error.js';
import { ToolDefinition } from '../types/tool-definition.js';
import { defaultRange, fetchSaasRevenue, SAAS_ACCOUNTS } from './saas-revenue.js';

const toolName = 'get_saas_revenue';
const toolDescription =
  `Clear Health SaaS revenue from QuickBooks: ONLY the ${Object.values(SAAS_ACCOUNTS).join(' and ')} accounts. ` +
  'Returns monthly and per-customer totals, every SaaS invoice line (date, invoice #, customer, description, amount), ' +
  'and each SaaS invoice\'s due date, paid/open status, open SaaS amount, overdue flag and payment dates. ' +
  'Accrual basis (counted on invoice date). Defaults to the last 12 months including the current one. ' +
  'This is the only QuickBooks data available; nothing else in the books can be read.';

const toolSchema = z.object({
  start_date: z.string().optional().describe('Start date YYYY-MM-DD (default: first day of the month 11 months ago)'),
  end_date: z.string().optional().describe('End date YYYY-MM-DD (default: today)'),
});

const toolHandler = async ({ params }: any) => {
  try {
    const range = defaultRange(new Date());
    const qb = await QuickbooksClient.getInstance();
    const result = await fetchSaasRevenue(qb, params?.start_date ?? range.start, params?.end_date ?? range.end);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
  }
};

export const GetSaasRevenueTool: ToolDefinition<typeof toolSchema> = { name: toolName, description: toolDescription, schema: toolSchema, handler: toolHandler };
