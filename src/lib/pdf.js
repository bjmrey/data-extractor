// PDF handling in the browser: per-page text extraction (layout-aware) and page subsetting.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Parse "1-3, 7, 10-12" into sorted unique 1-based page numbers within [1, total]. */
export function parsePageRange(spec, total) {
  if (!spec || !String(spec).trim()) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) throw new Error(`Invalid page range "${part.trim()}" (use e.g. 3-10, 14)`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (p >= 1 && p <= total) pages.add(p);
  }
  if (!pages.size) throw new Error('The page range selects no pages of this document');
  return [...pages].sort((x, y) => x - y);
}

export async function getPageCount(arrayBuffer) {
  const task = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

/** Returns { numPages, pages: [{ page, text }] }. Lines are rebuilt from text positions; wide gaps become " | " so tables stay readable. */
export async function extractPdfText(arrayBuffer, pageSpec, onProgress) {
  const task = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) });
  const doc = await task.promise;
  try {
    const selected = parsePageRange(pageSpec, doc.numPages);
    const pages = [];
    for (const [i, p] of selected.entries()) {
      onProgress?.(`Reading page ${p} (${i + 1}/${selected.length})`);
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width || 0 }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of items) {
        const line = lines.find((l) => Math.abs(l.y - it.y) < 3);
        if (line) line.items.push(it);
        else lines.push({ y: it.y, items: [it] });
      }
      lines.sort((a, b) => b.y - a.y);
      const text = lines
        .map((l) => {
          l.items.sort((a, b) => a.x - b.x);
          let out = '';
          let lastEnd = null;
          for (const it of l.items) {
            if (lastEnd !== null) out += it.x - lastEnd > 12 ? ' | ' : ' ';
            out += it.str;
            lastEnd = it.x + it.w;
          }
          return out;
        })
        .join('\n');
      pages.push({ page: p, text });
      page.cleanup();
    }
    return { numPages: doc.numPages, pages };
  } finally {
    await task.destroy();
  }
}

/** New PDF with only the selected pages. pageMap[i] = original page number of page i+1. */
export async function subsetPdf(arrayBuffer, pageSpec) {
  if (!pageSpec || !String(pageSpec).trim()) return { bytes: new Uint8Array(arrayBuffer), pageMap: null };
  const src = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const selected = parsePageRange(pageSpec, src.getPageCount());
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, selected.map((p) => p - 1));
  copied.forEach((pg) => out.addPage(pg));
  return { bytes: await out.save(), pageMap: selected };
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}
