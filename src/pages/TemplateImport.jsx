import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Page, Card, Field, Alert, errorText } from '../components/ui.jsx';
import { readSpreadsheet } from '../lib/spreadsheet.js';
import { detectCandidates, suggestSettings, colLetter } from '../lib/sheet-detect.js';
import { FIELD_TYPES, slugify } from '../lib/fields.js';
import { files, templates as tplDb } from '../lib/db.js';
import { blankTemplate } from './TemplateEditor.jsx';

const ROLES = [
  ['field', 'Field'],
  ['section', 'Section heading'],
  ['formula', 'Formula (keep, not extracted)'],
  ['ignore', 'Ignore'],
];

export default function TemplateImport() {
  const nav = useNavigate();
  const [file, setFile] = useState(null);
  const [book, setBook] = useState(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [opts, setOpts] = useState(null);
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [outputs, setOutputs] = useState({ excel: true, csv: false, json: true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const grid = book?.sheets[sheetIdx]?.grid || [];
  const maxCols = useMemo(() => Math.max(1, ...grid.map((r) => r.length)), [grid]);

  const redetect = (g, o) => {
    setOpts(o);
    setRows(detectCandidates(g, o));
  };

  const onFile = async (f) => {
    setError(null);
    if (!f) return;
    try {
      const b = await readSpreadsheet(f);
      setFile(f);
      setBook(b);
      setSheetIdx(0);
      setName(f.name.replace(/\.[^.]+$/, ''));
      setOutputs({ excel: b.kind === 'xlsx', csv: b.kind === 'csv', json: true });
      redetect(b.sheets[0].grid, suggestSettings(b.sheets[0].grid));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const onSheet = (i) => {
    setSheetIdx(i);
    redetect(book.sheets[i].grid, suggestSettings(book.sheets[i].grid));
  };
  const setOpt = (k, v) => redetect(grid, { ...opts, [k]: v });
  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const fields = rows.filter((r) => r.role === 'field');

  const save = async () => {
    setError(null);
    if (!fields.length) return setError('Mark at least one row as a field.');
    const keys = fields.map((f) => f.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) return setError(`Duplicate key "${dup}".`);
    setBusy(true);
    try {
      const filePath = await files.save(file);
      const t = {
        ...blankTemplate(),
        name: name || file.name,
        outputs,
        source: { kind: book.kind, fileName: file.name, filePath, sheetName: book.sheets[sheetIdx].name, orientation: opts.orientation },
        fields: fields.map((r) => ({ id: crypto.randomUUID(), key: r.key, label: r.label, section: r.section, type: r.type, description: '', cell: r.cell })),
      };
      const saved = await tplDb.save(t);
      nav(`/templates/${saved.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const isRows = opts?.orientation === 'rows';
  const idxOptions = (n, asCol) =>
    Array.from({ length: n }, (_, i) => (
      <option key={i} value={i}>
        {asCol ? colLetter(i) : i + 1}
      </option>
    ));

  return (
    <Page title="Template from spreadsheet" subtitle="Upload an Excel or CSV model; rows (or columns) become template fields and the file becomes the Excel/CSV output layout." actions={<Link className="btn" to="/templates">Cancel</Link>}>
      <Alert onClose={() => setError(null)}>{error}</Alert>
      <Card title="1. Spreadsheet">
        <input type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" onChange={(e) => onFile(e.target.files[0])} />
        {book && (
          <div className="grid" style={{ marginTop: 12 }}>
            {book.sheets.length > 1 && (
              <Field label="Sheet">
                <select value={sheetIdx} onChange={(e) => onSheet(Number(e.target.value))}>
                  {book.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Labels are in">
              <select value={opts.orientation} onChange={(e) => redetect(grid, { orientation: e.target.value, labelIndex: 0, valueIndex: 1, startIndex: e.target.value === 'rows' ? opts.startIndex : 0 })}>
                <option value="rows">a column (one field per row)</option>
                <option value="columns">a row (one field per column)</option>
              </select>
            </Field>
            <Field label={isRows ? 'Label column' : 'Label row'}>
              <select value={opts.labelIndex} onChange={(e) => setOpt('labelIndex', Number(e.target.value))}>
                {idxOptions(isRows ? maxCols : grid.length, isRows)}
              </select>
            </Field>
            <Field label={isRows ? 'Write values in column' : 'Write values in row'} hint="Where the extracted year's values go">
              <select value={opts.valueIndex} onChange={(e) => setOpt('valueIndex', Number(e.target.value))}>
                {idxOptions(isRows ? maxCols + 1 : grid.length + 1, isRows)}
              </select>
            </Field>
            <Field label={isRows ? 'Start at row' : 'Start at column'}>
              <select value={opts.startIndex} onChange={(e) => setOpt('startIndex', Number(e.target.value))}>
                {idxOptions(isRows ? grid.length : maxCols, !isRows)}
              </select>
            </Field>
          </div>
        )}
      </Card>

      {book && (
        <>
          <Card title="Preview">
            <div className="table-wrap sheet-preview">
              <table className="sheet">
                <thead>
                  <tr>
                    <th />
                    {Array.from({ length: Math.min(maxCols, 15) }, (_, c) => (
                      <th key={c} className={isRows && c === opts.labelIndex ? 'hl-label' : isRows && c === opts.valueIndex ? 'hl-value' : ''}>
                        {colLetter(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.slice(0, 60).map((r, ri) => (
                    <tr key={ri} className={!isRows && ri === opts.labelIndex ? 'hl-label' : !isRows && ri === opts.valueIndex ? 'hl-value' : ''}>
                      <th>{ri + 1}</th>
                      {Array.from({ length: Math.min(maxCols, 15) }, (_, c) => {
                        const cell = r[c];
                        return (
                          <td key={c} className={`${cell?.bold ? 'b' : ''} ${cell?.formula ? 'fx' : ''} ${isRows && c === opts.labelIndex ? 'hl-label' : isRows && c === opts.valueIndex ? 'hl-value' : ''}`}>
                            {cell?.v}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              <span className="swatch hl-label" /> labels <span className="swatch hl-value" /> value cells. Showing up to 60 rows × 15 columns.
            </p>
          </Card>

          <Card title={`2. Detected rows — ${fields.length} field(s)`}>
            <div className="table-wrap">
              <table className="table fields-table">
                <thead>
                  <tr>
                    <th>{isRows ? 'Row' : 'Col'}</th>
                    <th>Role</th>
                    <th>Label</th>
                    <th>Section</th>
                    <th>Key</th>
                    <th>Type</th>
                    <th>Cell</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.index} className={r.role === 'field' ? '' : 'dim'}>
                      <td>{isRows ? r.index + 1 : colLetter(r.index)}</td>
                      <td>
                        <select value={r.role} onChange={(e) => setRow(i, { role: e.target.value, key: r.key || slugify(r.label) })}>
                          {ROLES.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                      </td>
                      <td>{r.role === 'field' && <input value={r.section} onChange={(e) => setRow(i, { section: e.target.value })} />}</td>
                      <td>{r.role === 'field' && <input className="mono" value={r.key} onChange={(e) => setRow(i, { key: e.target.value })} />}</td>
                      <td>
                        {r.role === 'field' && (
                          <select value={r.type} onChange={(e) => setRow(i, { type: e.target.value })}>
                            {FIELD_TYPES.map((x) => (
                              <option key={x.value} value={x.value}>
                                {x.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="mono">{r.role === 'field' && r.cell}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="3. Save as template">
            <div className="grid">
              <Field label="Template name">
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Output formats">
                <div className="checks">
                  {[
                    ['excel', 'Excel'],
                    ['csv', 'CSV'],
                    ['json', 'JSON'],
                  ].map(([k, l]) => (
                    <label key={k}>
                      <input type="checkbox" checked={outputs[k]} onChange={(e) => setOutputs({ ...outputs, [k]: e.target.checked })} /> {l}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            <button className="btn primary" disabled={busy || !fields.length} onClick={save}>
              {busy ? 'Saving…' : `Create template with ${fields.length} field(s)`}
            </button>
          </Card>
        </>
      )}
    </Page>
  );
}
