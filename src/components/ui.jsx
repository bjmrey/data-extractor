import { useEffect, useState } from 'react';

export function Page({ title, actions, children, subtitle }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <div className="actions">{actions}</div>
      </header>
      {children}
    </div>
  );
}

export function Card({ title, children, actions, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          <div className="actions">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, wide }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Alert({ kind = 'error', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`alert ${kind}`}>
      <div>{children}</div>
      {onClose && (
        <button className="link" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/** Transient message helper: const [msg, flash] = useFlash(); */
export function useFlash(ms = 4000) {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg || msg.kind === 'error') return;
    const t = setTimeout(() => setMsg(null), ms);
    return () => clearTimeout(t);
  }, [msg, ms]);
  return [msg, (kind, text) => setMsg(text ? { kind, text } : null), () => setMsg(null)];
}

export function Flash({ msg, onClose }) {
  if (!msg) return null;
  return (
    <Alert kind={msg.kind} onClose={onClose}>
      {msg.text}
    </Alert>
  );
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '');

export const errorText = (e) => (e?.message ? e.message : String(e));
