import { useEffect, useState } from 'react';
import { Page, Card, Field, Flash, useFlash, errorText, Empty } from '../components/ui.jsx';
import { settings as settingsDb, newId } from '../lib/db.js';
import { PROVIDER_TYPES, testProvider } from '../lib/llm.js';
import { useStorage, useLoad } from '../storage-context.jsx';
import { folderSupported } from '../lib/storage.js';
import { exportWorkspace, importWorkspace } from '../lib/workspace-zip.js';
import { downloadBlob } from '../lib/spreadsheet.js';

const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

function blankProvider(type = 'anthropic') {
  return { id: newId(), name: PROVIDER_TYPES[type].label, type, apiKey: '', model: PROVIDER_TYPES[type].defaultModel, baseUrl: '', effort: type === 'anthropic' ? 'high' : '' };
}

export default function SettingsPage() {
  const { data, loading, reload } = useLoad(() => settingsDb.get());
  const [s, setS] = useState(null);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState(null);
  const [msg, flash, clear] = useFlash();
  const storage = useStorage();

  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  if (loading || !s) return <Page title="Settings" />;

  const persist = async (next) => {
    setS(next);
    await settingsDb.save(next);
  };

  const saveProvider = async (p) => {
    const exists = s.providers.some((x) => x.id === p.id);
    const providers = exists ? s.providers.map((x) => (x.id === p.id ? p : x)) : [...s.providers, p];
    await persist({ ...s, providers, defaultProviderId: s.defaultProviderId || p.id });
    setEditing(null);
    flash('success', `Saved provider "${p.name}".`);
  };

  const removeProvider = async (p) => {
    if (!confirm(`Delete provider "${p.name}"?`)) return;
    const providers = s.providers.filter((x) => x.id !== p.id);
    await persist({ ...s, providers, defaultProviderId: s.defaultProviderId === p.id ? providers[0]?.id || null : s.defaultProviderId });
  };

  const runTest = async (p) => {
    setTesting(p.id);
    clear();
    try {
      const r = await testProvider(p);
      flash('success', `${p.name}: connection OK (model ${r.model}).`);
    } catch (e) {
      flash('error', `${p.name}: ${errorText(e)}`);
    } finally {
      setTesting(null);
    }
  };

  const choose = async (copy) => {
    try {
      const n = await storage.chooseFolder(copy);
      flash('success', copy ? `Workspace folder selected; ${n} file(s) copied into it.` : 'Workspace folder selected.');
    } catch (e) {
      if (e.name !== 'AbortError') flash('error', errorText(e));
    }
  };

  const doExport = async () => downloadBlob(await exportWorkspace(), `financial-extractor-workspace-${new Date().toISOString().slice(0, 10)}.zip`);
  const doImport = async (file) => {
    if (!file) return;
    try {
      const n = await importWorkspace(file);
      storage.refresh();
      reload();
      flash('success', `Imported ${n} file(s).`);
    } catch (e) {
      flash('error', `Import failed: ${errorText(e)}`);
    }
  };

  return (
    <Page title="Settings">
      <Flash msg={msg} onClose={clear} />

      <Card
        title="LLM providers"
        actions={
          <button className="btn primary" onClick={() => setEditing(blankProvider())}>
            Add provider
          </button>
        }
      >
        {s.providers.length === 0 && !editing && <Empty>No provider yet. Add one with your API key to start extracting.</Empty>}
        {s.providers.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Default</th>
                <th>Name</th>
                <th>Provider</th>
                <th>Model</th>
                <th>API key</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.providers.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input type="radio" name="default" checked={s.defaultProviderId === p.id} onChange={() => persist({ ...s, defaultProviderId: p.id })} />
                  </td>
                  <td>{p.name}</td>
                  <td>{PROVIDER_TYPES[p.type]?.label}</td>
                  <td>
                    <code>{p.model}</code>
                  </td>
                  <td>{p.apiKey ? `••••${p.apiKey.slice(-4)}` : <span className="muted">none</span>}</td>
                  <td className="row-actions">
                    <button className="btn small" disabled={testing === p.id} onClick={() => runTest(p)}>
                      {testing === p.id ? 'Testing…' : 'Test'}
                    </button>
                    <button className="btn small" onClick={() => setEditing({ ...p })}>
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => removeProvider(p)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {editing && <ProviderForm value={editing} onChange={setEditing} onSave={() => saveProvider(editing)} onCancel={() => setEditing(null)} />}
        <p className="hint">
          Requests go directly from this browser to the provider. API keys are saved in <code>settings.json</code> in your workspace — keep that folder private.
        </p>
      </Card>

      <Card title="Storage (flat files)">
        <p>
          Currently using: <b>{storage.label}</b>
        </p>
        <p className="muted">
          Files: <code>settings.json</code>, <code>templates/*.json</code>, <code>destinations/*.json</code>, <code>extractions/*.json</code>, <code>files/*</code> (PDFs and template spreadsheets).
        </p>
        <div className="actions wrap">
          {storage.kind === 'server' ? (
            <span className="muted">
              Running from the dev/preview server, so files are saved in the <code>data/</code> folder at the root of the app (gitignored).
            </span>
          ) : folderSupported() ? (
            <>
              <button className="btn primary" onClick={() => choose(true)}>
                Choose workspace folder (copy current data)
              </button>
              <button className="btn" onClick={() => choose(false)}>
                Open existing workspace folder
              </button>
            </>
          ) : (
            <span className="muted">This browser cannot write to local folders (use Chrome or Edge for that). Data is kept in browser storage; use export/import to move the files.</span>
          )}
          {storage.kind === 'folder' && (
            <button className="btn" onClick={() => storage.useBrowser()}>
              Switch to browser storage
            </button>
          )}
        </div>
        <div className="actions wrap" style={{ marginTop: 12 }}>
          <button className="btn" onClick={doExport}>
            Export workspace (.zip)
          </button>
          <label className="btn">
            Import workspace (.zip)
            <input type="file" accept=".zip" hidden onChange={(e) => doImport(e.target.files[0])} />
          </label>
        </div>
      </Card>
    </Page>
  );
}

function ProviderForm({ value: p, onChange, onSave, onCancel }) {
  const set = (k, v) => onChange({ ...p, [k]: v });
  const changeType = (type) => onChange({ ...p, type, name: PROVIDER_TYPES[type].label, model: PROVIDER_TYPES[type].defaultModel, baseUrl: '', effort: type === 'anthropic' ? 'high' : '' });
  const t = PROVIDER_TYPES[p.type];
  return (
    <div className="subform">
      <div className="grid">
        <Field label="Provider">
          <select value={p.type} onChange={(e) => changeType(e.target.value)}>
            {Object.entries(PROVIDER_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Display name">
          <input value={p.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Model" hint={t.defaultModel ? `e.g. ${t.defaultModel}` : 'Model / deployment name'}>
          <input value={p.model} onChange={(e) => set('model', e.target.value)} />
        </Field>
        <Field label="API key">
          <input type="password" autoComplete="off" value={p.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder={p.type === 'openai-compatible' ? 'optional' : ''} />
        </Field>
        <Field label="Base URL" hint={t.baseUrl ? `Default: ${t.baseUrl}` : 'Leave empty for the default endpoint'}>
          <input value={p.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder={t.baseUrl} />
        </Field>
        {p.type === 'anthropic' && (
          <Field label="Effort" hint="Higher = more thorough, slower. Leave empty for models that do not support effort.">
            <select value={p.effort || ''} onChange={(e) => set('effort', e.target.value)}>
              {EFFORTS.map((x) => (
                <option key={x} value={x}>
                  {x || '(not sent)'}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onSave} disabled={!p.name || !p.model}>
          Save provider
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
