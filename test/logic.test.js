import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceValue, slugify, buildJsonPayload, fieldsFromSampleJson, validateTemplate } from '../src/lib/fields.js';
import { parseCsv, toCsv, csvRowsToGrid, detectCandidates, suggestSettings, colLetter, colIndex } from '../src/lib/sheet-detect.js';
import { buildSchema, buildUserPrompt } from '../src/lib/prompt.js';
import { parseJsonResponse, validateSchema } from '../src/lib/llm.js';

test('coerceValue handles financial number formats', () => {
  assert.equal(coerceValue('1,234.5', 'currency'), 1234.5);
  assert.equal(coerceValue('(1,234)', 'currency'), -1234);
  assert.equal(coerceValue('-12', 'number'), -12);
  assert.equal(coerceValue('€ 3 400', 'currency'), 3400);
  assert.equal(coerceValue('12.5%', 'percent'), 12.5);
  assert.equal(coerceValue('n/a', 'currency'), null);
  assert.equal(coerceValue('', 'text'), null);
  assert.equal(coerceValue('abc', 'currency'), 'abc'); // kept so the user can fix it
  assert.equal(coerceValue('yes', 'boolean'), true);
  assert.equal(coerceValue(null, 'currency'), null);
});

test('slugify', () => {
  assert.equal(slugify('Revenue & other income'), 'revenue_and_other_income');
  assert.equal(slugify('EBITDA margin %'), 'ebitda_margin_pct');
  assert.equal(slugify('2024 sales'), 'f_2024_sales');
  assert.equal(slugify('Chiffre d’affaires'), 'chiffre_d_affaires');
});

test('buildJsonPayload nested / flat / dotted keys / no meta', () => {
  const fields = [
    { key: 'revenue', label: 'Revenue', section: 'Income statement', type: 'currency' },
    { key: 'balance.total_assets', label: 'Total assets', section: 'Balance sheet', type: 'currency' },
  ];
  const x = { fields, values: { revenue: { value: 100 }, 'balance.total_assets': { value: null } }, meta: { company_name: 'ACME', fiscal_year: '2024' }, document: { fileName: 'a.pdf' }, createdAt: 'now' };
  const nested = buildJsonPayload({ name: 'T', json: { structure: 'nested' } }, x);
  assert.deepEqual(nested.data, { income_statement: { revenue: 100 }, balance: { total_assets: null } });
  assert.equal(nested.company_name, 'ACME');
  const flat = buildJsonPayload({ name: 'T', json: { structure: 'flat', includeMeta: false } }, x);
  assert.deepEqual(flat, { revenue: 100, balance: { total_assets: null } });
});

test('fieldsFromSampleJson', () => {
  const f = fieldsFromSampleJson({ income: { revenue: 1, ebitda_margin: 0.2 }, company: { auditor_name: '' }, audited: true });
  assert.deepEqual(f.map((x) => x.key), ['income.revenue', 'income.ebitda_margin', 'company.auditor_name', 'audited']);
  assert.deepEqual(f.map((x) => x.type), ['currency', 'percent', 'text', 'boolean']);
  assert.equal(f[0].section, 'Income');
});

test('validateTemplate', () => {
  assert.ok(validateTemplate({ name: '', fields: [], outputs: {} }).length >= 3);
  assert.deepEqual(validateTemplate({ name: 'x', fields: [{ key: 'a', label: 'A' }], outputs: { json: true } }), []);
  assert.match(validateTemplate({ name: 'x', fields: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }], outputs: { json: true } })[0], /Duplicate/);
});

test('CSV round trip with quotes and semicolons', () => {
  const text = 'Label;2024\n"Revenue; net";"1 000"\nEBIT;"he said ""hi"""\n';
  const rows = parseCsv(text);
  assert.deepEqual(rows, [['Label', '2024'], ['Revenue; net', '1 000'], ['EBIT', 'he said "hi"']]);
  assert.deepEqual(parseCsv(toCsv(rows, ';'), ';'), rows);
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(27), 'AB');
  assert.equal(colIndex('AB'), 27);
});

test('detectCandidates finds sections, fields, year headers, formulas', () => {
  const g = csvRowsToGrid(parseCsv('Item,FY2024,FY2023\nINCOME STATEMENT,,\nRevenue,,\nEBITDA,,\nBalance sheet:,,\nTotal assets,,2000\n'));
  g[5][1].formula = true;
  const s = suggestSettings(g);
  assert.deepEqual(s, { orientation: 'rows', labelIndex: 0, valueIndex: 1, startIndex: 1 });
  const c = detectCandidates(g, s);
  assert.deepEqual(c.map((r) => [r.label, r.role, r.section, r.cell]), [
    ['INCOME STATEMENT', 'section', '', 'B2'],
    ['Revenue', 'field', 'INCOME STATEMENT', 'B3'],
    ['EBITDA', 'field', 'INCOME STATEMENT', 'B4'],
    ['Balance sheet', 'section', '', 'B5'],
    ['Total assets', 'formula', 'Balance sheet', 'B6'],
  ]);
  const cols = detectCandidates(csvRowsToGrid(parseCsv('Revenue,EBITDA\n,\n')), { orientation: 'columns', labelIndex: 0, valueIndex: 1, startIndex: 0 });
  assert.deepEqual(cols.map((r) => [r.key, r.cell]), [['revenue', 'A2'], ['ebitda', 'B2']]);
});

test('schema and prompt', () => {
  const fields = [{ key: 'revenue', label: 'Revenue', section: 'IS', type: 'currency', description: 'net sales' }];
  const s = buildSchema(fields);
  assert.deepEqual(s.properties.values.items.properties.key.enum, ['revenue']);
  const p = buildUserPrompt({ template: { numberScale: 'millions', currency: 'EUR' }, fields, fiscalYear: '2024', documentText: '=== Page 1 ===\nRevenue 10' });
  assert.match(p, /Fiscal year to extract: 2024/);
  assert.match(p, /millions/);
  assert.match(p, /- revenue: Revenue \(currency\) — net sales/);
});

test('parseJsonResponse tolerates fences and prose', () => {
  assert.deepEqual(parseJsonResponse('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonResponse('Here you go: {"a":2} hope it helps'), { a: 2 });
  assert.throws(() => parseJsonResponse('nope'));
});

test('validateSchema checks Claude tool output against the extraction schema', () => {
  const schema = buildSchema([{ key: 'revenue', label: 'Revenue', type: 'number' }]);
  const meta = { company_name: 'Acme', fiscal_year: '2024', period_end: null, currency: 'EUR', unit: 'thousands' };
  const ok = { meta, values: [{ key: 'revenue', value: '1200', page: 4, source: 'Revenue 1,200', confidence: 'high' }], notes: null };
  assert.deepEqual(validateSchema(ok, schema), []);
  const bad = { meta: { ...meta, extra: 1 }, values: [{ key: 'ebitda', value: 5, page: 1.5, source: null, confidence: 'sure' }] };
  const errs = validateSchema(bad, schema);
  for (const frag of ['$.notes: missing', '$.meta.extra: unexpected', '$.values[0].key', '$.values[0].value', '$.values[0].page', '$.values[0].confidence'])
    assert.ok(errs.some((e) => e.startsWith(frag)), `expected error for ${frag}: ${errs.join(' | ')}`);
});
