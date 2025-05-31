// Storage backends. Everything the app persists is a "flat file" addressed by a path such as
// "settings.json", "templates/<id>.json" or "files/<id>.xlsx".
//
//  - FolderBackend: real files in a local folder chosen by the user (File System Access API,
//    Chromium-based browsers). The folder handle is remembered in IndexedDB.
//  - BrowserBackend: the same file layout kept in IndexedDB (fallback for other browsers).
//    It can be exported/imported as a zip of the exact same files.
//  - ServerBackend: real files in <project root>/data via the Vite server's file API. This is the
//    default whenever the app runs from `npm run dev` / `npm run preview`.

const IDB_NAME = 'financial-extractor';
const IDB_VERSION = 1;

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(store, mode, fn) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const normalize = (p) => String(p).replace(/^\/+|\/+$/g, '');

export class BrowserBackend {
  kind = 'browser';
  label = 'Browser storage';
  async readBlob(path) {
    const v = await idb('files', 'readonly', (s) => s.get(normalize(path)));
    return v ?? null;
  }
  async writeBlob(path, blob) {
    await idb('files', 'readwrite', (s) => s.put(blob, normalize(path)));
  }
  async readText(path) {
    const b = await this.readBlob(path);
    return b ? b.text() : null;
  }
  async writeText(path, text) {
    await this.writeBlob(path, new Blob([text], { type: 'application/json' }));
  }
  async list(dir) {
    const prefix = normalize(dir) + '/';
    const keys = await idb('files', 'readonly', (s) => s.getAllKeys());
    return keys
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => k.slice(prefix.length));
  }
  async listAll() {
    return idb('files', 'readonly', (s) => s.getAllKeys());
  }
  async remove(path) {
    await idb('files', 'readwrite', (s) => s.delete(normalize(path)));
  }
}

export class FolderBackend {
  kind = 'folder';
  constructor(handle) {
    this.handle = handle;
    this.label = `Folder: ${handle.name}`;
  }
  async #dir(parts, create) {
    let d = this.handle;
    for (const part of parts) d = await d.getDirectoryHandle(part, { create });
    return d;
  }
  async #fileHandle(path, create) {
    const parts = normalize(path).split('/');
    const name = parts.pop();
    try {
      const dir = await this.#dir(parts, create);
      return await dir.getFileHandle(name, { create });
    } catch (e) {
      if (!create && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return null;
      throw e;
    }
  }
  async readBlob(path) {
    const fh = await this.#fileHandle(path, false);
    return fh ? fh.getFile() : null;
  }
  async writeBlob(path, blob) {
    const fh = await this.#fileHandle(path, true);
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }
  async readText(path) {
    const f = await this.readBlob(path);
    return f ? f.text() : null;
  }
  async writeText(path, text) {
    await this.writeBlob(path, new Blob([text], { type: 'application/json' }));
  }
  async list(dir) {
    let d;
    try {
      d = await this.#dir(normalize(dir).split('/').filter(Boolean), false);
    } catch (e) {
      if (e.name === 'NotFoundError') return [];
      throw e;
    }
    const out = [];
    for await (const [name, h] of d.entries()) if (h.kind === 'file') out.push(name);
    return out;
  }
  async listAll() {
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'file') out.push(prefix + name);
        else await walk(h, prefix + name + '/');
      }
    };
    await walk(this.handle, '');
    return out;
  }
  async remove(path) {
    const parts = normalize(path).split('/');
    const name = parts.pop();
    try {
      const dir = await this.#dir(parts, false);
      await dir.removeEntry(name);
    } catch (e) {
      if (e.name !== 'NotFoundError') throw e;
    }
  }
}

// Real files in <project root>/data, through the dev/preview server's file API (server/data-api.js).
const API = '/__data';
const H = { 'X-Data-Api': '1' };
const fileUrl = (path) => `${API}/file/${normalize(path).split('/').map(encodeURIComponent).join('/')}`;

async function check(res) {
  if (res.ok || res.status === 404) return res;
  let msg = `${res.status} ${res.statusText}`;
  try {
    msg = (await res.json()).error || msg;
  } catch {}
  throw new Error(`Data folder: ${msg}`);
}

export class ServerBackend {
  kind = 'server';
  label = 'Project folder: data/';
  async readBlob(path) {
    const res = await check(await fetch(fileUrl(path), { headers: H, cache: 'no-store' }));
    return res.status === 404 ? null : res.blob();
  }
  async writeBlob(path, blob) {
    await check(await fetch(fileUrl(path), { method: 'PUT', headers: H, body: blob }));
  }
  async readText(path) {
    const b = await this.readBlob(path);
    return b ? b.text() : null;
  }
  async writeText(path, text) {
    await this.writeBlob(path, new Blob([text], { type: 'application/json' }));
  }
  async list(dir) {
    const res = await check(await fetch(`${API}/list?dir=${encodeURIComponent(normalize(dir))}`, { headers: H, cache: 'no-store' }));
    return res.status === 404 ? [] : res.json();
  }
  async listAll() {
    return (await check(await fetch(`${API}/all`, { headers: H, cache: 'no-store' }))).json();
  }
  async remove(path) {
    await check(await fetch(fileUrl(path), { method: 'DELETE', headers: H }));
  }
}

/** True when the app is served by `npm run dev` / `npm run preview` with the data API. */
export async function serverAvailable() {
  try {
    const res = await fetch(`${API}/ping`, { headers: H, cache: 'no-store' });
    return res.ok && (await res.json()).ok === true;
  } catch {
    return false;
  }
}

export const folderSupported =() => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function rememberFolderHandle(handle) {
  await idb('handles', 'readwrite', (s) => (handle ? s.put(handle, 'workspace') : s.delete('workspace')));
}
export async function getRememberedFolderHandle() {
  try {
    return (await idb('handles', 'readonly', (s) => s.get('workspace'))) ?? null;
  } catch {
    return null;
  }
}

/** Copy every file from one backend to another (used when switching storage). */
export async function copyAll(from, to) {
  const paths = await from.listAll();
  for (const p of paths) {
    const b = await from.readBlob(p);
    if (b) await to.writeBlob(p, b);
  }
  return paths.length;
}
