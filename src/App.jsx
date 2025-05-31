import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useStorage } from './storage-context.jsx';
import ExtractPage from './pages/ExtractPage.jsx';
import ExtractionsPage from './pages/ExtractionsPage.jsx';
import ReviewPage from './pages/ReviewPage.jsx';
import TemplatesPage from './pages/TemplatesPage.jsx';
import TemplateEditor from './pages/TemplateEditor.jsx';
import TemplateImport from './pages/TemplateImport.jsx';
import DestinationsPage from './pages/DestinationsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

const NAV = [
  ['/extract', 'New extraction'],
  ['/extractions', 'Results'],
  ['/templates', 'Templates'],
  ['/destinations', 'Destinations'],
  ['/settings', 'Settings'],
];

export default function App() {
  const { label, kind, pendingHandle, reconnect, notice, dismissNotice } = useStorage();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">∑</span> Financials Extractor
        </div>
        <nav>
          {NAV.map(([to, text]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {text}
            </NavLink>
          ))}
        </nav>
        <div className="storage-pill" title="Where data and config files are stored">
          <span className={`dot ${kind}`} /> {label}
        </div>
      </aside>
      <main className="content">
        {pendingHandle && (
          <div className="banner">
            Your workspace folder <b>{pendingHandle.name}</b> needs permission again.{' '}
            <button className="btn small" onClick={reconnect}>
              Reconnect folder
            </button>
          </div>
        )}
        {notice && (
          <div className="banner">
            {notice}{' '}
            <button className="btn small" onClick={dismissNotice}>
              OK
            </button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/extract" replace />} />
          <Route path="/extract" element={<ExtractPage />} />
          <Route path="/extractions" element={<ExtractionsPage />} />
          <Route path="/extractions/:id" element={<ReviewPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/import" element={<TemplateImport />} />
          <Route path="/templates/:id" element={<TemplateEditor />} />
          <Route path="/destinations" element={<DestinationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/extract" replace />} />
        </Routes>
      </main>
    </div>
  );
}
