import { Link } from 'react-router-dom';
import { Page, Card, Empty, fmtDate } from '../components/ui.jsx';
import { extractions as exDb, files } from '../lib/db.js';
import { useLoad } from '../storage-context.jsx';

export default function ExtractionsPage() {
  const { data: list = [], reload } = useLoad(() => exDb.list());
  const remove = async (x) => {
    if (!confirm(`Delete the result for "${x.document.fileName}"? The stored PDF copy is deleted too.`)) return;
    await exDb.remove(x.id);
    if (x.document.filePath) await files.remove(x.document.filePath);
    reload();
  };
  return (
    <Page title="Results" actions={<Link className="btn primary" to="/extract">New extraction</Link>}>
      <Card>
        {list.length === 0 ? (
          <Empty>No extractions yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Fiscal year</th>
                <th>Document</th>
                <th>Template</th>
                <th>Filled</th>
                <th>Sent</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => {
                const filled = x.fields.filter((f) => x.values[f.key]?.value !== null && x.values[f.key]?.value !== undefined && x.values[f.key]?.value !== '').length;
                const lastSend = x.sends?.[x.sends.length - 1];
                return (
                  <tr key={x.id}>
                    <td>
                      <Link to={`/extractions/${x.id}`}>{x.meta?.company_name || '(unknown company)'}</Link>
                    </td>
                    <td>{x.meta?.fiscal_year}</td>
                    <td className="small">{x.document.fileName}</td>
                    <td>{x.template?.name}</td>
                    <td>
                      {filled}/{x.fields.length}
                    </td>
                    <td>{lastSend ? <span className={`badge ${lastSend.ok ? 'high' : 'low'}`}>{lastSend.ok ? 'sent' : `failed`}</span> : ''}</td>
                    <td className="small">{fmtDate(x.createdAt)}</td>
                    <td className="row-actions">
                      <Link className="btn small" to={`/extractions/${x.id}`}>
                        Open
                      </Link>
                      <button className="btn small danger" onClick={() => remove(x)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
