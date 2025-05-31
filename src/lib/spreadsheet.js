// Spreadsheet I/O in the browser (ExcelJS): read uploaded templates, fill them, generate outputs.
import ExcelJS from 'exceljs';
import { parseCsv, csvRowsToGrid, toCsv, detectDelimiter, parseAddress } from './sheet-detect.js';
import { isNumericType, META_FIELDS } from './fields.js';

const MAX_ROWS = 500;
const MAX_COLS = 40;

function cellToGridCell(cell) {
  let v = cell.value;
  let formula = false;
  if (v && typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) {
      formula = true;
      v = v.result ?? '';
    } else if ('richText' in v) v = v.richText.map((t) => t.text).join('');
    else if ('text' in v) v = v.text;
    else if (v instanceof Date) v = v.toISOString().slice(0, 10);
    else if ('error' in v) v = v.error;
  }
  if (v instanceof Date) v = v.toISOString().slice(0, 10);
  const n = typeof v === 'number' ? v : null;
  return { v: v === null || v === undefined ? '' : String(v).trim(), n, bold: !!cell.font?.bold, formula };
}

/** Read a spreadsheet File into { kind: 'xlsx'|'csv', sheets: [{ name, grid }] }. */
export async function readSpreadsheet(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    const rows = parseCsv(await file.text());
    return { kind: 'csv', sheets: [{ name: 'CSV', grid: csvRowsToGrid(rows.slice(0, MAX_ROWS)) }] };
  }
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) throw new Error('Supported formats: .xlsx, .xlsm, .csv (save .xls files as .xlsx first).');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sheets = [];
  wb.eachSheet((ws) => {
    const grid = [];
    const rowCount = Math.min(ws.rowCount, MAX_ROWS);
    const colCount = Math.min(ws.columnCount, MAX_COLS);
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const cells = [];
      for (let c = 1; c <= colCount; c++) cells.push(cellToGridCell(row.getCell(c)));
      grid.push(cells);
    }
    // Trim trailing empty rows.
    while (grid.length && grid[grid.length - 1].every((c) => c.v === '')) grid.pop();
    sheets.push({ name: ws.name, grid });
  });
  if (!sheets.length) throw new Error('The workbook has no sheets.');
  return { kind: 'xlsx', sheets };
}

const cellValue = (v, type) => {
  if (v === null || v === undefined || v === '') return null;
  if (isNumericType(type) && typeof v === 'number') return type === 'percent' ? v / 100 : v;
  return v;
};

function addDetailsSheet(wb, template, extraction, name = 'Extraction details') {
  const existing = wb.getWorksheet(name);
  if (existing) wb.removeWorksheet(existing.id);
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { header: 'Section', key: 'section', width: 22 },
    { header: 'Field', key: 'label', width: 40 },
    { header: 'Key', key: 'key', width: 28 },
    { header: 'Value', key: 'value', width: 18 },
    { header: 'Page', key: 'page', width: 8 },
    { header: 'Confidence', key: 'confidence', width: 12 },
    { header: 'Edited', key: 'edited', width: 8 },
    { header: 'Source excerpt', key: 'source', width: 60 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const m of META_FIELDS) ws.addRow({ section: 'Document', label: m.label, key: m.key, value: extraction.meta?.[m.key] ?? '' });
  ws.addRow({ section: 'Document', label: 'Source file', key: 'source_document', value: extraction.document?.fileName ?? '' });
  for (const f of extraction.fields) {
    const v = extraction.values[f.key] || {};
    const row = ws.addRow({
      section: f.section,
      label: f.label,
      key: f.key,
      value: cellValue(v.value, f.type),
      page: v.page ?? '',
      confidence: v.confidence ?? '',
      edited: v.edited ? 'yes' : '',
      source: v.source ?? '',
    });
    const vc = row.getCell('value');
    if (f.type === 'percent') vc.style = { ...vc.style, numFmt: '0.00%' };
    else if (isNumericType(f.type)) vc.style = { ...vc.style, numFmt: '#,##0.##;-#,##0.##' };
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

/** Build the Excel output. Fills the template's original spreadsheet when there is one. */
export async function buildExcel(template, extraction, readFile) {
  const wb = new ExcelJS.Workbook();
  const src = template.source;
  if (src?.kind === 'xlsx' && src.filePath) {
    const blob = await readFile(src.filePath);
    if (!blob) throw new Error('The template spreadsheet file is missing from storage.');
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet(src.sheetName) || wb.worksheets[0];
    for (const f of extraction.fields) {
      if (!f.cell) continue;
      const cell = ws.getCell(f.cell);
      const v = cellValue(extraction.values[f.key]?.value, f.type);
      cell.value = v;
      // Copy the style before changing it: ExcelJS shares style objects between cells of a column.
      if (f.type === 'percent' && typeof v === 'number' && !cell.numFmt?.includes('%')) cell.style = { ...cell.style, numFmt: '0.00%' };
    }
    wb.calcProperties.fullCalcOnLoad = true; // recompute template formulas when opened
    addDetailsSheet(wb, template, extraction);
  } else {
    addDetailsSheet(wb, template, extraction, 'Financials');
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Build the CSV output. Fills the original CSV layout when the template came from a CSV. */
export async function buildCsv(template, extraction, readFile) {
  const src = template.source;
  if (src?.kind === 'csv' && src.filePath) {
    const blob = await readFile(src.filePath);
    if (blob) {
      const text = await blob.text();
      const delimiter = detectDelimiter(text);
      const rows = parseCsv(text, delimiter);
      for (const f of extraction.fields) {
        const a = f.cell && parseAddress(f.cell);
        if (!a) continue;
        while (rows.length <= a.row) rows.push([]);
        while (rows[a.row].length <= a.col) rows[a.row].push('');
        const v = extraction.values[f.key]?.value;
        rows[a.row][a.col] = v ?? '';
      }
      return new Blob([toCsv(rows, delimiter)], { type: 'text/csv' });
    }
  }
  const rows = [['section', 'label', 'key', 'value', 'page', 'confidence']];
  for (const m of META_FIELDS) rows.push(['_meta', m.label, m.key, extraction.meta?.[m.key] ?? '', '', '']);
  for (const f of extraction.fields) {
    const v = extraction.values[f.key] || {};
    rows.push([f.section || '', f.label, f.key, v.value ?? '', v.page ?? '', v.confidence ?? '']);
  }
  return new Blob(['﻿' + toCsv(rows)], { type: 'text/csv' });
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
