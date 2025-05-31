import { useState } from 'react';
import { Page, Card, Field, Flash, useFlash, errorText, Empty } from '../components/ui.jsx';
import { destinations as destDb } from '../lib/db.js';
import { sendJson } from '../lib/send.js';
import { useLoad } from '../storage-context.jsx';

const blank = () => ({ name: '', url: '', method: 'POST', authType: 'bearer', token: '', headerName: 'X-API-Key', extraHeaders: [] });

export default function DestinationsPage() {
  const { data: list = [], reload } = useLoad(() => destDb.list());
  const [editing, setEditing] = useState(null);
  const [msg, flash, clear] = useFlash();

  const save = async () => {
    await destDb.save(editing);
    setEditing(null);
    reload();
    flash('success', 'Destination saved.');
  };
  const remove = async (d) => {
    if (!confirm(`Delete destination "${d.name}"?`)) return;
    await destDb.remove(d.id);
    reload();
  };
  const test = async (d) => {
    clear();
    try {
      const r = await sendJson(d, { test: true, sent_at: new Date().toISOString(), source: 'financial-extractor' });
      flash(r.ok ? 'success' : 'error', `HTTP ${r.status} ${r.statusText} in ${r.ms} ms${r.body ? ` — ${r.body.slice(0, 300)}` : ''}`);
    } catch (e) {
      flash('error', errorText(e));
    }
  };

  return (
    <Page
      title="Output destinations"
      subtitle="API endpoints that receive the JSON output of an extraction."
      actions={
        <button className="btn primary" onClick={() => setEditing(blank())}>
          Add destination
        </button>
      }
    >
      <Flash msg={msg} onClose={clear} />
      {editing && (
        <Card title={editing.id ? 'Edit destination' : 'New destination'}>
          <DestinationForm value={editing} onChange={setEditing} />
          <div className="actions">
            <button className="btn primary" disabled={!editing.name || !/^https?:\/\//.test(editing.url)} onClick={save}>
              Save
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </Card>
      )}
      <Card>
        {list.length === 0 ? (
          <Empty>No destinations yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Endpoint</th>
                <th>Auth</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>
                    <code>
                      {d.method} {d.url}
                    </code>
                  </td>
                  <td>{d.authType === 'bearer' ? 'Bearer token' : d.authType === 'header' ? `Header ${d.headerName}` : 'None'}</td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => test(d)} title="Sends a small test JSON payload">
                      Send test
                    </button>
                    <button className="btn small" onClick={() => setEditing({ ...d })}>
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => remove(d)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">
          The request is made by your browser, so the endpoint must allow CORS from <code>{location.origin}</code>. Tokens are stored in <code>destinations/*.json</code>.
        </p>
      </Card>
    </Page>
  );
}

function DestinationForm({ value: d, onChange }) {
  const set = (k, v) => onChange({ ...d, [k]: v });
  const setHeader = (i, k, v) => set('extraHeaders', d.extraHeaders.map((h, j) => (j === i ? { ...h, [k]: v } : h)));
  return (
    <>
      <div className="grid">
        <Field label="Name">
          <input value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Credit system (prod)" />
        </Field>
        <Field label="Method">
          <select value={d.method} onChange={(e) => set('method', e.target.value)}>
            {['POST', 'PUT', 'PATCH'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Endpoint URL" wide>
          <input value={d.url} onChange={(e) => set('url', e.target.value)} placeholder="https://api.example.com/financials" />
        </Field>
        <Field label="Authentication">
          <select value={d.authType} onChange={(e) => set('authType', e.target.value)}>
            <option value="bearer">Bearer token (Authorization header)</option>
            <option value="header">Token in custom header</option>
            <option value="none">None</option>
          </select>
        </Field>
        {d.authType === 'header' && (
          <Field label="Header name">
            <input value={d.headerName} onChange={(e) => set('headerName', e.target.value)} />
          </Field>
        )}
        {d.authType !== 'none' && (
          <Field label="Token">
            <input type="password" autoComplete="off" value={d.token} onChange={(e) => set('token', e.target.value)} />
          </Field>
        )}
      </div>
      <div className="field-label" style={{ marginTop: 8 }}>
        Extra headers
      </div>
      {d.extraHeaders.map((h, i) => (
        <div className="inline" key={i}>
          <input placeholder="Header" value={h.name} onChange={(e) => setHeader(i, 'name', e.target.value)} />
          <input placeholder="Value" value={h.value} onChange={(e) => setHeader(i, 'value', e.target.value)} />
          <button className="btn small" onClick={() => set('extraHeaders', d.extraHeaders.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn small" onClick={() => set('extraHeaders', [...d.extraHeaders, { name: '', value: '' }])}>
        + Add header
      </button>
    </>
  );
}
