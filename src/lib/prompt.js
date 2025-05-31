// Prompt and JSON schema for the extraction request (pure, no browser APIs).
import { NUMBER_SCALES } from './fields.js';

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });

export function buildSchema(fields) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['meta', 'values', 'notes'],
    properties: {
      meta: {
        type: 'object',
        additionalProperties: false,
        required: ['company_name', 'fiscal_year', 'period_end', 'currency', 'unit'],
        properties: {
          company_name: nullable('string'),
          fiscal_year: nullable('string'),
          period_end: nullable('string'),
          currency: nullable('string'),
          unit: nullable('string'),
        },
      },
      values: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'value', 'page', 'source', 'confidence'],
          properties: {
            key: { type: 'string', enum: fields.map((f) => f.key) },
            value: nullable('string'),
            page: nullable('integer'),
            source: nullable('string'),
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
      notes: nullable('string'),
    },
  };
}

export const SYSTEM_PROMPT = `You are a meticulous financial analyst who extracts figures from company financial documents (annual reports, financial statements, filings).
Rules:
- Extract values for ONE fiscal year only. Never mix figures from different years or periods.
- Use the primary (consolidated, if available) financial statements; prefer statement figures over narrative text.
- Only report a value if it is stated in the document or is an unambiguous direct sum of stated line items; otherwise return null. Never guess.
- Numbers: plain numeric strings with "." as decimal separator, no thousands separators, no currency symbols, "-" for negatives (convert "(1,234)" to "-1234").
- Percentages: the number only, e.g. "12.5" for 12.5%.
- Dates: ISO format YYYY-MM-DD.
- For each value give the page number where it appears and a short verbatim source excerpt (the line label and figure).
- confidence: "high" if read directly from a statement, "medium" if derived or labelled differently, "low" if uncertain.
- Return exactly one entry in "values" for every requested field key (value null if not found).`;

function describeFields(fields) {
  let currentSection = null;
  const lines = [];
  for (const f of fields) {
    if ((f.section || '') !== currentSection) {
      currentSection = f.section || '';
      if (currentSection) lines.push(`\n[${currentSection}]`);
    }
    lines.push(`- ${f.key}: ${f.label} (${f.type})${f.description ? ` — ${f.description}` : ''}`);
  }
  return lines.join('\n');
}

export function buildUserPrompt({ template, fields, fiscalYear, instructions, documentText }) {
  const scale = template.numberScale && template.numberScale !== 'as_reported'
    ? `Report all monetary amounts in ${NUMBER_SCALES.find((s) => s.value === template.numberScale)?.label.toLowerCase()} — convert from the document's scale if needed, and set meta.unit accordingly.`
    : 'Report monetary amounts in the scale used by the document, and state that scale in meta.unit (e.g. "thousands", "millions").';
  const currency = template.currency ? `Expected reporting currency: ${template.currency}. If the document uses a different currency, keep the document's figures and set meta.currency to the actual currency.` : 'Set meta.currency to the ISO 4217 code of the reporting currency.';
  const year = fiscalYear
    ? `Fiscal year to extract: ${fiscalYear}. Set meta.fiscal_year to "${fiscalYear}".`
    : 'Fiscal year to extract: the most recent full fiscal year presented in the document. Set meta.fiscal_year to it.';
  return [
    year,
    scale,
    currency,
    instructions ? `Additional instructions: ${instructions}` : '',
    `Fields to extract:\n${describeFields(fields)}`,
    documentText ? `Document text (page markers show original page numbers; " | " separates table columns):\n\n${documentText}` : 'The document is attached as a PDF.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

