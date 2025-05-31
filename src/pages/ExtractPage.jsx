import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page, Card, Field, Alert, errorText } from '../components/ui.jsx';
import { templates as tplDb, settings as settingsDb, extractions as exDb, files } from '../lib/db.js';
import { runExtraction } from '../lib/extract.js';
import { supportsNativePdf } from '../lib/llm.js';
import { getPageCount } from '../lib/pdf.js';
import { useLoad } from '../storage-context.jsx';
import { outputsLabel } from './TemplatesPage.jsx';

export default function ExtractPage() {
  const nav = useNavigate();
  const { data: tpls = [] } = useLoad(() => tplDb.list());
  const { data: cfg } = useLoad(() => settingsDb.get());
  const [pdf, setPdf] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [templateId, setTemplateId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [fiscalYear, setFiscalYear] = useState('');
  const [pages, setPages] = useState('');
  const [pdfMode, setPdfMode] = useState('auto');
  const [instructions, setInstructions] = useState('');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!templateId && tpls.length) setTemplateId(tpls[0].id);
  }, [tpls, templateId]);
  useEffect(() => {
    if (cfg && !providerId) setProviderId(cfg.defaultProviderId || cfg.providers[0]?.id || '');
  }, [cfg, providerId]);

  const template = tpls.find((t) => t.id === templateId);
  const provider = cfg?.providers.find((p) => p.id === providerId);

  const onPdf = async (f) => {
    setError(null);
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return setError('Please choose a PDF file.');
    setPdf(f);
    setNumPages(null);
    try {
      setNumPages(await getPageCount(await f.arrayBuffer()));
    } catch (e) {
      setError(`Could not open the PDF: ${errorText(e)}`);
    }
  };

  const process = async () => {
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress('Starting…');
    try {
      const result = await runExtraction({ template, provider, pdfFile: pdf, fileName: pdf.name, fiscalYear: fiscalYear.trim(), pages, pdfMode, instructions, onProgress: setProgress, signal: ctrl.signal });
      setProgress('Saving…');
      const filePath = await files.save(pdf);
      const { values, meta, notes, warnings, mode, model, usage } = result;
      const { id: _i, createdAt: _c, updatedAt: _u, ...snapshot } = template;
      const rec = await exDb.save({
        templateId: template.id,
        template: snapshot,
        fields: template.fields,
        document: { fileName: pdf.name, filePath, numPages: result.numPages },
        options: { providerName: provider.name, providerType: provider.type, model, fiscalYear, pages, pdfMode: mode, instructions },
        usage,
        meta,
        values,
        notes,
        warnings,
        sends: [],
      });
      nav(`/extractions/${rec.id}`);
    } catch (e) {
      if (ctrl.signal.aborted) setError('Cancelled.');
      else setError(errorText(e));
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const ready = pdf && template && provider && !progress;
  const native = provider && supportsNativePdf(provider);

  return (
    <Page title="New extraction" subtitle="Upload a company financials document, pick an output template and let the model fill it for one fiscal year.">
      <Alert onClose={() => setError(null)}>{error}</Alert>
      {cfg && cfg.providers.length === 0 && (
        <Alert kind="info">
          No LLM provider configured yet — <Link to="/settings">add one in Settings</Link>.
        </Alert>
      )}
      {tpls.length === 0 && (
        <Alert kind="info">
          No template yet — <Link to="/templates/new">create one</Link> or <Link to="/templates/import">import a spreadsheet</Link>.
        </Alert>
      )}

      <Card title="1. Document">
        <label
          className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onPdf(e.dataTransfer.files[0]);
          }}
        >
          <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => onPdf(e.target.files[0])} />
          {pdf ? (
            <>
              <b>{pdf.name}</b>
              <span className="muted">
                {(pdf.size / 1024 / 1024).toFixed(1)} MB{numPages ? ` · ${numPages} pages` : ''} — click to change
              </span>
            </>
          ) : (
            <>
              <b>Drop a PDF here</b>
              <span className="muted">or click to browse (annual report, financial statements…)</span>
            </>
          )}
        </label>
      </Card>

      <Card title="2. Template & model">
        <div className="grid">
          <Field label="Output template" hint={template ? `${template.fields.length} fields · ${outputsLabel(template.outputs)}` : ''}>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {tpls.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="LLM provider" hint={provider ? provider.model : ''}>
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {cfg?.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fiscal year" hint="Leave empty for the most recent year in the document">
            <input value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} placeholder="e.g. 2025" />
          </Field>
          <Field label="Pages" hint="Optional, e.g. 45-60, 72. Limits what is sent to the model.">
            <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder={numPages ? `1-${numPages}` : 'all'} />
          </Field>
          <Field label="PDF handling" hint={native ? 'This provider can read the PDF itself (tables, scans).' : 'This provider receives the extracted text.'}>
            <select value={pdfMode} onChange={(e) => setPdfMode(e.target.value)}>
              <option value="auto">Automatic</option>
              <option value="native" disabled={!native}>
                Send the PDF file
              </option>
              <option value="text">Send extracted text</option>
            </select>
          </Field>
          <Field label="Extra instructions (optional)" wide>
            <textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Use the group (consolidated) figures, not the parent company accounts." />
          </Field>
        </div>
      </Card>

      <div className="actions">
        <button className="btn primary big" disabled={!ready} onClick={process}>
          Process document
        </button>
        {progress && (
          <>
            <span className="spinner" /> <span>{progress}</span>
            <button className="btn" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </>
        )}
      </div>
    </Page>
  );
}
