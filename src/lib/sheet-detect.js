// Pure spreadsheet helpers: CSV parsing/serialising and template field detection from a cell grid.
// Grid = array of rows, each row an array of cells { v: string, n: number|null, bold: bool, formula: bool }.
import { slugify, uniqueKey, guessType } from './fields.js';

export const colLetter = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const colIndex = (letters) => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
export const cellAddress = (row, col) => `${colLetter(col)}${row + 1}`;
export function parseAddress(addr) {
  const m = String(addr).toUpperCase().match(/^([A-Z]+)(\d+)$/);
  return m ? { row: Number(m[2]) - 1, col: colIndex(m[1]) } : null;
}

export function detectDelimiter(text) {
  const firstLines = text.split(/\r?\n/).slice(0, 10).join('\n');
  const counts = [',', ';', '\t', '|'].map((d) => [d, firstLines.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function toCsv(rows, delimiter = ',') {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(delimiter)).join('\r\n');
}

export function csvRowsToGrid(rows) {
  return rows.map((r) =>
    r.map((v) => {
      const t = v.trim();
      const n = t !== '' && !Number.isNaN(Number(t.replace(/[,\s]/g, ''))) ? Number(t.replace(/[,\s]/g, '')) : null;
      return { v: t, n, bold: false, formula: false };
    }),
  );
}

const isEmpty = (c) => !c || c.v === '' || c.v === null || c.v === undefined;
const isYearLike = (s) => /^(FY\s?)?(19|20)\d{2}([/-]\d{2,4})?[A-Z]?$/i.test(String(s).trim());
const cellAt = (grid, r, c) => grid[r]?.[c];
// A header row: every other cell is a year label, and either several of them or text like "FY2024"
// (a single numeric 2000 is more likely an amount than a year).
const isYearHeader = (cells) =>
  cells.length > 0 && cells.every((c) => isYearLike(c.v)) && (cells.length >= 2 || cells.every((c) => c.n === null));

/** Suggest default detection settings for a grid. */
export function suggestSettings(grid) {
  const maxCols = Math.max(0, ...grid.map((r) => r.length));
  const textScore = (c) => grid.slice(0, 200).filter((r) => r[c] && r[c].v && r[c].n === null && !isYearLike(r[c].v)).length;
  let labelIndex = 0;
  let best = -1;
  for (let c = 0; c < Math.min(maxCols, 5); c++) {
    const s = textScore(c);
    if (s > best) {
      best = s;
      labelIndex = c;
    }
  }
  // Value column: first column right of the labels whose header looks like a year, else the next column.
  let valueIndex = labelIndex + 1;
  let startIndex = 0;
  outer: for (let r = 0; r < Math.min(grid.length, 30); r++) {
    for (let c = labelIndex + 1; c < (grid[r]?.length || 0); c++) {
      if (grid[r][c] && isYearLike(grid[r][c].v)) {
        valueIndex = c;
        startIndex = r + 1;
        break outer;
      }
    }
  }
  return { orientation: 'rows', labelIndex, valueIndex, startIndex };
}

/**
 * Detect template rows.
 * orientation 'rows': labels down column `labelIndex`, values written to column `valueIndex`.
 * orientation 'columns': labels across row `labelIndex`, values written to row `valueIndex`.
 * Returns [{ index, label, role: 'field'|'section'|'formula'|'ignore', section, key, type, cell, sample }]
 */
export function detectCandidates(grid, { orientation = 'rows', labelIndex = 0, valueIndex = 1, startIndex = 0 }) {
  const out = [];
  const taken = new Set();
  let section = '';
  const rows = orientation === 'rows';
  const length = rows ? grid.length : Math.max(0, ...grid.map((r) => r.length));
  for (let i = startIndex; i < length; i++) {
    const labelCell = rows ? cellAt(grid, i, labelIndex) : cellAt(grid, labelIndex, i);
    if (isEmpty(labelCell)) continue;
    const label = String(labelCell.v).trim().replace(/:$/, '');
    if (!label) continue;
    const valueCell = rows ? cellAt(grid, i, valueIndex) : cellAt(grid, valueIndex, i);
    const others = rows
      ? (grid[i] || []).filter((c, ci) => ci !== labelIndex && !isEmpty(c))
      : grid.map((r) => r[i]).filter((c, ri) => ri !== labelIndex && !isEmpty(c));

    let role = 'field';
    if (labelCell.n !== null && !isYearLike(labelCell.v)) role = 'ignore';
    else if (isYearHeader(others)) role = 'ignore'; // header row with years
    else if (valueCell?.formula) role = 'formula';
    else if (!others.length && (labelCell.bold || /:$/.test(String(labelCell.v).trim()) || (label === label.toUpperCase() && /[A-Z]/.test(label) && /\s/.test(label)))) role = 'section';

    if (role === 'section') section = label;
    const key = role === 'field' || role === 'formula' ? uniqueKey(slugify(label), taken) : '';
    out.push({
      index: i,
      label,
      role,
      section: role === 'section' ? '' : section,
      key,
      type: guessType(label, valueCell?.n === null ? valueCell?.v : undefined),
      cell: rows ? cellAddress(i, valueIndex) : cellAddress(valueIndex, i),
      sample: valueCell?.v ?? '',
    });
  }
  return out;
}
