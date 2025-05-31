// Export / import the whole workspace (all flat files) as a zip.
import JSZip from 'jszip';
import { getBackend } from './db.js';

export async function exportWorkspace() {
  const backend = getBackend();
  const zip = new JSZip();
  for (const path of await backend.listAll()) {
    const blob = await backend.readBlob(path);
    if (blob) zip.file(path, blob);
  }
  return zip.generateAsync({ type: 'blob' });
}

export async function importWorkspace(file) {
  const zip = await JSZip.loadAsync(file);
  const backend = getBackend();
  let n = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const path = entry.name.replace(/\\/g, '/');
    if (path.split('/').some((p) => p === '..' || p === '')) continue;
    if (!/^(settings\.json|(templates|destinations|extractions)\/[^/]+\.json|files\/[^/]+)$/.test(path)) continue;
    await backend.writeBlob(path, await entry.async('blob'));
    n++;
  }
  return n;
}
