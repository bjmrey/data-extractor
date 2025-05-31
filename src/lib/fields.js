// Pure helpers for template fields, value coercion and JSON payload building (no browser APIs).

export const FIELD_TYPES = [
  { value: 'currency', label: 'Amount (currency)' },
  { value: 'number', label: 'Number' },
  { value: 'percent', label: 'Percent' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes / No' },
];

export const NUMBER_SCALES = [
  { value: 'as_reported', label: 'As reported in the document' },
  { value: 'units', label: 'Units (full amounts)' },
  { value: 'thousands', label: 'Thousands' },
  { value: 'millions', label: 'Millions' },
  { value: 'billions', label: 'Billions' },
];

export const META_FIELDS = [
  { key: 'company_name', label: 'Company name' },
  { key: 'fiscal_year', label: 'Fiscal year' },
  { key: 'period_end', label: 'Period end date' },
  { key: 'currency', label: 'Currency' },
  { key: 'unit', label: 'Unit / scale' },
];

export const isNumericType = (t) => t === 'currency' || t === 'number' || t === 'percent';

export function slugify(label) {
  const s = String(label || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/%/g, ' pct ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (/^[0-9]/.test(s) ? `f_${s}` : s) || 'field';
}

/** Return a key not present in `taken` (a Set), appending _2, _3... */
export function uniqueKey(base, taken) {
  let k = base;
  let i = 2;
  while (taken.has(k)) k = `${base}_${i++}`;
  taken.add(k);
  return k;
}

export function guessType(label, sample) {
  const l = String(label).toLowerCase();
  if (/(^|\b)(date|period end|year end)(\b|$)/.test(l)) return 'date';
  if (/%|margin|ratio|rate|percent|growth|yield/.test(l)) return 'percent';
  if (/name|auditor|currency|description|comment|address|country|sector|industry|opinion/.test(l)) return 'text';
  if (/number of|employees|headcount|shares|count/.test(l)) return 'number';
  if (typeof sample === 'string' && sample.trim() && Number.isNaN(Number(sample.replace(/[,\s]/g, '')))) return 'text';
  return 'currency';
}

/** Turn an LLM/user string into a typed value. Returns null for empty. */
export function coerceValue(raw, type) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return type === 'boolean' ? raw : String(raw);
  let s = String(raw).trim();
  if (!s || /^(null|n\/a|na|none|-|—|–)$/i.test(s)) return null;
  if (isNumericType(type)) {
    let neg = false;
    if (/^\(.*\)$/.test(s)) {
      neg = true;
      s = s.slice(1, -1);
    }
    s = s.replace(/[^0-9.eE+-]/g, ''); // drop spaces, thousands separators, currency symbols, %
    if (s.startsWith('-')) {
      neg = !neg;
      s = s.slice(1);
    }
    const n = Number(s);
    if (s === '' || Number.isNaN(n)) return String(raw).trim(); // keep original so the user can fix it
    return neg ? -n : n;
  }
  if (type === 'boolean') {
    if (/^(true|yes|y|1|oui)$/i.test(s)) return true;
    if (/^(false|no|n|0|non)$/i.test(s)) return false;
    return s;
  }
  return s;
}

function setPath(obj, path, value) {
  const parts = path.split('.').filter(Boolean);
  let o = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof o[p] !== 'object' || o[p] === null) o[p] = {};
    o = o[p];
  }
  o[parts[parts.length - 1]] = value;
}

/** JSON path of a field inside the "data" object. Keys may themselves contain dots. */
export function fieldPath(field, structure) {
  if (structure === 'nested' && field.section && !field.key.includes('.')) return `${slugify(field.section)}.${field.key}`;
  return field.key;
}

/** Build the JSON document sent to the destination / downloaded. */
export function buildJsonPayload(template, extraction) {
  const structure = template.json?.structure || 'flat';
  const data = {};
  for (const f of extraction.fields) {
    const v = extraction.values[f.key]?.value;
    setPath(data, fieldPath(f, structure), v === undefined ? null : v);
  }
  if (template.json?.includeMeta === false) return data;
  const m = extraction.meta || {};
  return {
    company_name: m.company_name ?? null,
    fiscal_year: m.fiscal_year ?? null,
    period_end: m.period_end ?? null,
    currency: m.currency ?? null,
    unit: m.unit ?? null,
    template: template.name,
    source_document: extraction.document?.fileName ?? null,
    extracted_at: extraction.createdAt,
    data,
  };
}

/** Derive fields from a sample JSON document: one field per leaf. */
export function fieldsFromSampleJson(obj) {
  const fields = [];
  const taken = new Set();
  const walk = (o, prefix, section) => {
    for (const [k, v] of Object.entries(o)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path, section ?? humanize(k));
      else {
        const label = humanize(k);
        let type = guessType(label, v);
        if (typeof v === 'boolean') type = 'boolean';
        else if (typeof v === 'number' && type === 'text') type = 'number';
        fields.push({ id: crypto.randomUUID(), key: uniqueKey(path, taken), label, section: section || '', type, description: '' });
      }
    }
  };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Sample JSON must be an object');
  walk(obj, '', null);
  return fields;
}

export const humanize = (k) =>
  String(k)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());

/** Validate a template before saving; returns a list of error strings. */
export function validateTemplate(t) {
  const errors = [];
  if (!t.name?.trim()) errors.push('Template name is required.');
  if (!t.fields?.length) errors.push('Add at least one field.');
  const seen = new Set();
  for (const f of t.fields || []) {
    if (!f.key?.trim()) errors.push(`Field "${f.label || '(unnamed)'}" has no key.`);
    else if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(f.key)) errors.push(`Key "${f.key}" may only contain letters, digits, "_" and "." (dot = nesting).`);
    else if (seen.has(f.key)) errors.push(`Duplicate key "${f.key}".`);
    seen.add(f.key);
    if (!f.label?.trim()) errors.push(`Field "${f.key}" has no label.`);
  }
  if (!t.outputs?.excel && !t.outputs?.csv && !t.outputs?.json) errors.push('Select at least one output format.');
  return errors;
}
