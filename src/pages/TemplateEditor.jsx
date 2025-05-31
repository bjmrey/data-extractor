import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Page, Card, Field, Alert, Flash, useFlash, errorText } from '../components/ui.jsx';
import { templates as tplDb, destinations as destDb } from '../lib/db.js';
import { FIELD_TYPES, NUMBER_SCALES, slugify, uniqueKey, validateTemplate, buildJsonPayload, fieldsFromSampleJson, isNumericType } from '../lib/fields.js';
import { useLoad } from '../storage-context.jsx';

export const blankTemplate = () => ({
  name: '',
  description: '',
  outputs: { excel: true, csv: false, json: true },
  numberScale: 'as_reported',
  currency: '',
  json: { structure: 'nested', includeMeta: true, destinationId: '' },
  fields: [],
  source: null,
});

const newField = (section = '') => ({ id: crypto.randomUUID(), key: '', label: '', section, type: 'currency', description: '' });

export default function TemplateEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === 'new';
  const { data: loaded, loading } = useLoad(() => (isNew ? Promise.resolve(blankTemplate()) : tplDb.get(id)), [id]);
  const { data: dests = [] } = useLoad(() => destDb.list());
  const [t, setT] = useState(null);
  const [errors, setErrors] = useState([]);
  const [sampleJson, setSampleJson] = useState(null);
  const [msg, flash, clear] = useFlash();

  useEffect(() => {
    if (loaded) setT(structuredClone(loaded));
  }, [loaded]);

  const preview = useMemo(() => {
    if (!t) return null;
    const values = Object.fromEntries(t.fields.map((f) => [f.key, { value: isNumericType(f.type) ? 0 : f.type === 'boolean' ? false : '' }]));
    return buildJsonPayload(t, {
      fields: t.fields.filter((f) => f.key),
      values,
      meta: { company_name: 'Example Corp', fiscal_year: '2024', period_end: '2024-12-31', currency: t.currency || 'EUR', unit: t.numberScale === 'as_reported' ? 'millions' : t.numberScale },
      document: { fileName: 'annual-report.pdf' },
      createdAt: new Date().toISOString(),
    });
  }, [t]);

  if (loading) return <Page title="Template" />;
  if (!t) return <Page title="Template not found" />;

  const set = (k, v) => setT({ ...t, [k]: v });
  const setField = (i, patch) => setT({ ...t, fields: t.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const sections = [...new Set(t.fields.map((f) => f.section).filter(Boolean))];

  const onLabel = (i, label) => {
    const f = t.fields[i];
    const autoKey = !f.key || f.key === slugify(f.label);
    setField(i, { label, ...(autoKey ? { key: slugify(label) } : {}) });
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= t.fields.length) return;
    const fields = [...t.fields];
    [fields[i], fields[j]] = [fields[j], fields[i]];
    set('fields', fields);
  };
  const addField = () => set('fields', [...t.fields, newField(t.fields[t.fields.length - 1]?.section || '')]);

  const applySample = () => {
    try {
      const fields = fieldsFromSampleJson(JSON.parse(sampleJson));
      const taken = new Set(t.fields.map((f) => f.key));
      const added = fields.map((f) => ({ ...f, key: uniqueKey(f.key, taken) }));
      setT({ ...t, fields: [...t.fields, ...added], json: { ...t.json, structure: 'flat' } });
      setSampleJson(null);
      flash('success', `Added ${added.length} field(s). Keys keep the sample's nesting via dot notation (structure set to "flat").`);
    } catch (e) {
      flash('error', `Invalid sample JSON: ${errorText(e)}`);
    }
  };

  const save = async () => {
    const errs = validateTemplate(t);
    setErrors(errs);
    if (errs.length) return;
    const saved = await tplDb.save(t);
    flash('success', 'Template saved.');
    if (isNew) nav(`/templates/${saved.id}`, { replace: true });
    else setT(saved);
  };

  return (
    <Page
      title={isNew ? 'New template' : t.name || 'Template'}
      actions={
        <>
          <Link className="btn" to="/templates">
            Back
          </Link>
          <button className="btn primary" onClick={save}>
            Save template
          </button>
        </>
      }
    >
      <Flash msg={msg} onClose={clear} />
      {errors.length > 0 && (
        <Alert onClose={() => setErrors([])}>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card title="General">
        <div className="grid">
          <Field label="Name">
            <input value={t.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Credit review — key financials" />
          </Field>
          <Field label="Description">
            <input value={t.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Output formats">
            <div className="checks">
              {[
                ['excel', 'Excel (.xlsx)'],
                ['csv', 'CSV'],
                ['json', 'JSON'],
              ].map(([k, l]) => (
                <label key={k}>
                  <input type="checkbox" checked={!!t.outputs[k]} onChange={(e) => set('outputs', { ...t.outputs, [k]: e.target.checked })} /> {l}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Monetary amounts in" hint="The model converts figures to this scale.">
            <select value={t.numberScale} onChange={(e) => set('numberScale', e.target.value)}>
              {NUMBER_SCALES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expected currency" hint="Optional ISO code, e.g. EUR, USD">
            <input value={t.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={3} />
          </Field>
        </div>
        {t.source && (
          <p className="muted">
            Layout from spreadsheet <b>{t.source.fileName}</b>, sheet <b>{t.source.sheetName}</b>: Excel{t.source.kind === 'csv' ? '/CSV' : ''} output fills that file at each field's cell, plus a details sheet.{' '}
            <button className="link" onClick={() => confirm('Detach the spreadsheet? Output will use the standard layout.') && set('source', null)}>
              Detach
            </button>
          </p>
        )}
      </Card>

      <Card
        title={`Fields (${t.fields.length})`}
        actions={
          <>
            <button className="btn" onClick={() => setSampleJson(sampleJson === null ? '' : null)}>
              Prefill from sample JSON
            </button>
            <button className="btn primary" onClick={addField}>
              Add field
            </button>
          </>
        }
      >
        {sampleJson !== null && (
          <div className="subform">
            <Field label="Paste a sample of the JSON your API expects (one fiscal year). One field is created per leaf value." wide>
              <textarea rows={8} value={sampleJson} onChange={(e) => setSampleJson(e.target.value)} placeholder={'{\n  "income_statement": { "revenue": 0, "ebitda": 0 },\n  "balance_sheet": { "total_assets": 0 }\n}'} />
            </Field>
            <div className="actions">
              <button className="btn primary" onClick={applySample} disabled={!sampleJson?.trim()}>
                Add fields
              </button>
              <button className="btn" onClick={() => setSampleJson(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <datalist id="sections">
          {sections.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {t.fields.length > 0 && (
          <div className="table-wrap">
            <table className="table fields-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Type</th>
                  <th>Hint for the model</th>
                  {t.source && <th>Cell</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {t.fields.map((f, i) => (
                  <tr key={f.id || i}>
                    <td>
                      <input list="sections" value={f.section} onChange={(e) => setField(i, { section: e.target.value })} />
                    </td>
                    <td>
                      <input value={f.label} onChange={(e) => onLabel(i, e.target.value)} placeholder="e.g. Revenue" />
                    </td>
                    <td>
                      <input className="mono" value={f.key} onChange={(e) => setField(i, { key: e.target.value })} />
                    </td>
                    <td>
                      <select value={f.type} onChange={(e) => setField(i, { type: e.target.value })}>
                        {FIELD_TYPES.map((x) => (
                          <option key={x.value} value={x.value}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={f.description} onChange={(e) => setField(i, { description: e.target.value })} placeholder="synonyms, definition…" />
                    </td>
                    {t.source && (
                      <td>
                        <input className="mono narrow" value={f.cell || ''} onChange={(e) => setField(i, { cell: e.target.value.toUpperCase() })} />
                      </td>
                    )}
                    <td className="row-actions">
                      <button className="btn small" onClick={() => move(i, -1)} title="Move up">
                        ↑
                      </button>
                      <button className="btn small" onClick={() => move(i, 1)} title="Move down">
                        ↓
                      </button>
                      <button className="btn small danger" onClick={() => set('fields', t.fields.filter((_, j) => j !== i))} title="Delete">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {t.fields.length === 0 && <p className="muted">No fields yet. Add fields one by one, prefill from a sample JSON, or create the template from a spreadsheet.</p>}
      </Card>

      {t.outputs.json && (
        <Card title="JSON output">
          <div className="grid">
            <Field label="Structure" hint="Nested groups fields by section; dots in keys always create nesting.">
              <select value={t.json.structure} onChange={(e) => set('json', { ...t.json, structure: e.target.value })}>
                <option value="nested">Nested by section</option>
                <option value="flat">Flat (keys as written)</option>
              </select>
            </Field>
            <Field label="Envelope">
              <label className="checks">
                <input type="checkbox" checked={t.json.includeMeta !== false} onChange={(e) => set('json', { ...t.json, includeMeta: e.target.checked })} /> Include company / year / currency metadata
              </label>
            </Field>
            <Field label="Default destination" hint={dests.length ? '' : 'Create one under Destinations'}>
              <select value={t.json.destinationId || ''} onChange={(e) => set('json', { ...t.json, destinationId: e.target.value })}>
                <option value="">(none)</option>
                {dests.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="field-label">Preview</div>
          <pre className="code">{JSON.stringify(preview, null, 2)}</pre>
        </Card>
      )}
    </Page>
  );
}
