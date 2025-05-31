import { Link, useNavigate } from 'react-router-dom';
import { Page, Card, Empty, fmtDate } from '../components/ui.jsx';
import { templates as tplDb } from '../lib/db.js';
import { useLoad } from '../storage-context.jsx';
import { downloadBlob } from '../lib/spreadsheet.js';

export const outputsLabel = (o = {}) => [o.excel && 'Excel', o.csv && 'CSV', o.json && 'JSON'].filter(Boolean).join(' · ');

export default function TemplatesPage() {
  const { data: list = [], reload } = useLoad(() => tplDb.list());
  const nav = useNavigate();

  const duplicate = async (t) => {
    const { id, createdAt, updatedAt, ...rest } = t;
    const copy = await tplDb.save({ ...rest, name: `${t.name} (copy)` });
    nav(`/templates/${copy.id}`);
  };
  const remove = async (t) => {
    if (!confirm(`Delete template "${t.name}"? Existing results keep their own copy of the fields.`)) return;
    await tplDb.remove(t.id);
    reload();
  };
  const exportTpl = (t) => downloadBlob(new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' }), `${t.name.replace(/[^\w-]+/g, '_')}.template.json`);
  const importTpl = async (file) => {
    if (!file) return;
    try {
      const t = JSON.parse(await file.text());
      if (!Array.isArray(t.fields)) throw new Error('Not a template file');
      const { id, createdAt, updatedAt, source, ...rest } = t;
      await tplDb.save({ ...rest, source: null });
      reload();
    } catch (e) {
      alert(`Could not import: ${e.message}`);
    }
  };

  return (
    <Page
      title="Output templates"
      subtitle="A template defines the fields to extract for one fiscal year, and the output formats (Excel, CSV, JSON)."
      actions={
        <>
          <label className="btn">
            Import template file
            <input type="file" accept=".json" hidden onChange={(e) => importTpl(e.target.files[0])} />
          </label>
          <Link className="btn" to="/templates/import">
            From spreadsheet…
          </Link>
          <Link className="btn primary" to="/templates/new">
            New template
          </Link>
        </>
      }
    >
      <Card>
        {list.length === 0 ? (
          <Empty>
            No templates yet. <Link to="/templates/new">Create one with the field editor</Link> or <Link to="/templates/import">upload a spreadsheet</Link>.
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Outputs</th>
                <th>Fields</th>
                <th>Layout</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/templates/${t.id}`}>{t.name}</Link>
                    {t.description && <div className="muted small">{t.description}</div>}
                  </td>
                  <td>{outputsLabel(t.outputs)}</td>
                  <td>{t.fields.length}</td>
                  <td>{t.source ? `${t.source.fileName} › ${t.source.sheetName}` : <span className="muted">standard</span>}</td>
                  <td className="small">{fmtDate(t.updatedAt)}</td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => nav(`/templates/${t.id}`)}>
                      Edit
                    </button>
                    <button className="btn small" onClick={() => duplicate(t)}>
                      Duplicate
                    </button>
                    <button className="btn small" onClick={() => exportTpl(t)}>
                      Export
                    </button>
                    <button className="btn small danger" onClick={() => remove(t)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
