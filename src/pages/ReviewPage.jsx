import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page, Card, Field, Alert, Flash, useFlash, errorText, fmtDate } from '../components/ui.jsx';
import { extractions as exDb, destinations as destDb, files } from '../lib/db.js';
import { META_FIELDS, coerceValue, isNumericType, buildJsonPayload } from '../lib/fields.js';
import { buildExcel, buildCsv, downloadBlob } from '../lib/spreadsheet.js';
import { sendJson } from '../lib/send.js';
import { useLoad } from '../storage-context.jsx';

const display = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
const isBlank = (v) => v === null || v === undefined || v === '';

export default function ReviewPage() {
  const { id } = useParams();
  const { data: loaded, loading } = useLoad(() => exDb.get(id), [id]);
  const { data: dests = [] } = useLoad(() => destDb.list());
  const [x, setX] = useState(null);
  const [drafts, setDrafts] = useState({}); // key -> text being typed
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState('all');
  const [destId, setDestId] = useState('');
  const [busy, setBusy] = useState(null);
  const [showJson, setShowJson] = useState(false);
  const [msg, flash, clear] = useFlash(6000);

  useEffect(() => {
    if (loaded) {
      setX(loaded);
      setDestId(loaded.template?.json?.destinationId || '');
    }
  }, [loaded]);
  useEffect(() => {
    const warn = (e) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const payload = useMemo(() => (x ? buildJsonPayload(x.template, x) : null), [x]);
  if (loading) return <Page title="Result" />;
  if (!x) return <Page title="Result not found" actions={<Link className="btn" to="/extractions">Back</Link>} />;

  const t = x.template;
  const base = (x.meta?.company_name || x.document.fileName.replace(/\.pdf$/i, '')).replace(/[^\w-]+/g, '_') + (x.meta?.fiscal_year ? `_${x.meta.fiscal_year}` : '');

  const setMeta = (k, v) => {
    setX({ ...x, meta: { ...x.meta, [k]: v } });
    setDirty(true);
  };
  const commitValue = (f, text) => {
    const value = coerceValue(text, f.type);
    setX({ ...x, values: { ...x.values, [f.key]: { ...(x.values[f.key] || {}), value, edited: true } } });
    setDrafts(({ [f.key]: _, ...rest }) => rest);
    setDirty(true);
  };

  const save = async () => {
    const saved = await exDb.save(x);
    setX(saved);
    setDirty(false);
    flash('success', 'Saved.');
    return saved;
  };

  const download = async (kind) => {
    setBusy(kind);
    clear();
    try {
      if (kind === 'xlsx') downloadBlob(await buildExcel(t, x, files.read), `${base}.xlsx`);
      if (kind === 'csv') downloadBlob(await buildCsv(t, x, files.read), `${base}.csv`);
      if (kind === 'json') downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${base}.json`);
    } catch (e) {
      flash('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    const dest = dests.find((d) => d.id === destId);
    if (!dest) return;
    setBusy('send');
    clear();
    let entry;
    try {
      const r = await sendJson(dest, payload);
      entry = { at: new Date().toISOString(), destinationId: dest.id, destinationName: dest.name, ok: r.ok, status: r.status, response: r.body };
      flash(r.ok ? 'success' : 'error', `${dest.name}: HTTP ${r.status} ${r.statusText}${r.body ? ` — ${r.body.slice(0, 300)}` : ''}`);
    } catch (e) {
      entry = { at: new Date().toISOString(), destinationId: dest.id, destinationName: dest.name, ok: false, status: null, response: errorText(e) };
      flash('error', errorText(e));
    }
    const saved = await exDb.save({ ...x, sends: [...(x.sends || []), entry] });
    setX(saved);
    setDirty(false);
    setBusy(null);
  };

  const openPdf = async (page) => {
    const blob = await files.read(x.document.filePath);
    if (!blob) return flash('error', 'The PDF is no longer in storage.');
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    window.open(page ? `${url}#page=${page}` : url, '_blank');
  };

  const shown = x.fields.filter((f) => {
    const v = x.values[f.key] || {};
    if (filter === 'missing') return isBlank(v.value);
    if (filter === 'review') return isBlank(v.value) || v.confidence === 'low' || v.confidence === 'medium' || (isNumericType(f.type) && typeof v.value === 'string');
    return true;
  });
  const filled = x.fields.filter((f) => !isBlank(x.values[f.key]?.value)).length;
  let lastSection = null;

  return (
    <Page
      title={`${x.meta?.company_name || 'Result'}${x.meta?.fiscal_year ? ` — FY ${x.meta.fiscal_year}` : ''}`}
      subtitle={`${x.document.fileName} · template "${t.name}" · ${x.options.providerName} (${x.options.model}) · ${fmtDate(x.createdAt)}`}
      actions={
        <>
          <Link className="btn" to="/extractions">
            Back
          </Link>
          <button className="btn" onClick={() => openPdf()}>
            Open PDF
          </button>
          <button className="btn primary" disabled={!dirty} onClick={save}>
            {dirty ? 'Save changes' : 'Saved'}
          </button>
        </>
      }
    >
      <Flash msg={msg} onClose={clear} />
      {x.warnings?.length > 0 && <Alert kind="info">{x.warnings.join(' ')}</Alert>}
      {x.notes && <Alert kind="info">Model notes: {x.notes}</Alert>}

      <Card title="Output">
        <div className="actions wrap">
          {t.outputs.excel && (
            <button className="btn primary" disabled={!!busy} onClick={() => download('xlsx')}>
              {busy === 'xlsx' ? 'Building…' : 'Download Excel'}
            </button>
          )}
          {t.outputs.csv && (
            <button className="btn" disabled={!!busy} onClick={() => download('csv')}>
              Download CSV
            </button>
          )}
          {t.outputs.json && (
            <>
              <button className="btn" disabled={!!busy} onClick={() => download('json')}>
                Download JSON
              </button>
              <span className="sep" />
              <select value={destId} onChange={(e) => setDestId(e.target.value)}>
                <option value="">Choose destination…</option>
                {dests.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button className="btn primary" disabled={!destId || !!busy} onClick={send}>
                {busy === 'send' ? 'Sending…' : 'Send JSON'}
              </button>
              <button className="link" onClick={() => setShowJson(!showJson)}>
                {showJson ? 'Hide' : 'Preview'} JSON
              </button>
            </>
          )}
        </div>
        {dirty && <p className="hint">Unsaved edits are included in downloads and sends.</p>}
        {showJson && <pre className="code">{JSON.stringify(payload, null, 2)}</pre>}
        {x.sends?.length > 0 && (
          <details className="sends">
            <summary>Send history ({x.sends.length})</summary>
            <ul>
              {x.sends
                .slice()
                .reverse()
                .map((s, i) => (
                  <li key={i}>
                    <span className={`badge ${s.ok ? 'high' : 'low'}`}>{s.ok ? 'OK' : 'failed'}</span> {fmtDate(s.at)} → {s.destinationName} {s.status ? `(HTTP ${s.status})` : ''} <span className="muted small">{s.response?.slice(0, 200)}</span>
                  </li>
                ))}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Document">
        <div className="grid">
          {META_FIELDS.map((m) => (
            <Field key={m.key} label={m.label}>
              <input value={x.meta?.[m.key] ?? ''} onChange={(e) => setMeta(m.key, e.target.value || null)} />
            </Field>
          ))}
        </div>
      </Card>

      <Card
        title={`Extracted values — ${filled}/${x.fields.length} filled`}
        actions={
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All fields</option>
            <option value="review">Needs review</option>
            <option value="missing">Missing only</option>
          </select>
        }
      >
        <div className="table-wrap">
          <table className="table values-table">
            <thead>
              <tr>
                <th>Field</th>
                <th className="num">Value</th>
                <th>Page</th>
                <th>Confidence</th>
                <th>Source excerpt</th>
              </tr>
            </thead>
            <tbody>
              {shown.flatMap((f) => {
                const v = x.values[f.key] || {};
                const out = [];
                if ((f.section || '') !== lastSection) {
                  lastSection = f.section || '';
                  if (lastSection)
                    out.push(
                      <tr key={`s-${f.key}`} className="section-row">
                        <td colSpan={5}>{lastSection}</td>
                      </tr>,
                    );
                }
                const invalid = isNumericType(f.type) && typeof v.value === 'string';
                out.push(
                  <tr key={f.key} className={isBlank(v.value) ? 'missing' : ''}>
                    <td>
                      {f.label}
                      <div className="muted small mono">{f.key}</div>
                    </td>
                    <td className="num">
                      {f.type === 'boolean' ? (
                        <select value={v.value === true ? 'true' : v.value === false ? 'false' : ''} onChange={(e) => commitValue(f, e.target.value)}>
                          <option value="" />
                          <option value="true">yes</option>
                          <option value="false">no</option>
                        </select>
                      ) : (
                        <input
                          className={`value-input ${invalid ? 'invalid' : ''} ${v.edited ? 'edited' : ''}`}
                          value={drafts[f.key] ?? display(v.value)}
                          onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })}
                          onBlur={(e) => drafts[f.key] !== undefined && commitValue(f, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          title={invalid ? 'Not a number — please correct' : v.edited ? 'Edited by you' : ''}
                        />
                      )}
                      <span className="unit">{f.type === 'percent' ? '%' : ''}</span>
                    </td>
                    <td>
                      {v.page ? (
                        <button className="link" onClick={() => openPdf(v.page)} title="Open the PDF at this page">
                          p. {v.page}
                        </button>
                      ) : (
                        ''
                      )}
                    </td>
                    <td>{v.edited ? <span className="badge edited">edited</span> : <span className={`badge ${v.confidence}`}>{v.confidence}</span>}</td>
                    <td className="small source">{v.source}</td>
                  </tr>,
                );
                return out;
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
