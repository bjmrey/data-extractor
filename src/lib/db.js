// Repository layer on top of the active storage backend. Records are JSON flat files.
import { BrowserBackend } from './storage.js';

let backend = new BrowserBackend();
const listeners = new Set();

export const getBackend = () => backend;
export function setBackend(b) {
  backend = b;
  listeners.forEach((l) => l());
}
export function onBackendChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

async function readJson(path, fallback = null) {
  const text = await backend.readText(path);
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`Corrupt JSON in ${path}`);
    return fallback;
  }
}
const writeJson = (path, data) => backend.writeText(path, JSON.stringify(data, null, 2));

function collection(dir) {
  return {
    async list() {
      const names = (await backend.list(dir)).filter((n) => n.endsWith('.json'));
      const items = await Promise.all(names.map((n) => readJson(`${dir}/${n}`)));
      return items.filter(Boolean).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    },
    get: (id) => readJson(`${dir}/${id}.json`),
    async save(record) {
      const now = new Date().toISOString();
      const rec = { ...record, id: record.id || newId(), createdAt: record.createdAt || now, updatedAt: now };
      await writeJson(`${dir}/${rec.id}.json`, rec);
      return rec;
    },
    remove: (id) => backend.remove(`${dir}/${id}.json`),
  };
}

export const templates = collection('templates');
export const destinations = collection('destinations');
export const extractions = collection('extractions');

const DEFAULT_SETTINGS = { providers: [], defaultProviderId: null };
export const settings = {
  get: async () => ({ ...DEFAULT_SETTINGS, ...(await readJson('settings.json', {})) }),
  save: (s) => writeJson('settings.json', s),
};

/** Binary uploads (source PDFs, template spreadsheets). */
export const files = {
  async save(file) {
    const ext = (file.name.match(/\.[A-Za-z0-9]+$/)?.[0] || '').toLowerCase();
    const path = `files/${newId()}${ext}`;
    await backend.writeBlob(path, file);
    return path;
  },
  read: (path) => backend.readBlob(path),
  remove: (path) => backend.remove(path),
};
