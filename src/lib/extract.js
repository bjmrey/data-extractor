// Orchestrates an extraction: PDF -> prompt -> LLM -> typed, editable values.
import { extractPdfText, subsetPdf, bytesToBase64 } from './pdf.js';
import { runLLM, parseJsonResponse, supportsNativePdf } from './llm.js';
import { coerceValue } from './fields.js';
import { buildSchema, buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';

/**
 * @param opts { template, provider, pdfFile (File|Blob), fileName, fiscalYear, pages, pdfMode: 'auto'|'text'|'native', instructions, onProgress, signal }
 * @returns partial extraction record { meta, values, notes, numPages, mode, model, usage, warnings }
 */
export async function runExtraction(opts) {
  const { template, provider, pdfFile, fileName, fiscalYear, pages, instructions, onProgress, signal } = opts;
  const fields = template.fields;
  const buf = await pdfFile.arrayBuffer();
  const warnings = [];

  let mode = opts.pdfMode || 'auto';
  if (mode === 'auto') mode = supportsNativePdf(provider) ? 'native' : 'text';
  if (mode === 'native' && !supportsNativePdf(provider)) {
    warnings.push(`${provider.name} does not accept PDF files; used extracted text instead.`);
    mode = 'text';
  }

  onProgress?.('Reading PDF…');
  const { numPages, pages: pageTexts } = await extractPdfText(buf, pages, onProgress);
  const totalChars = pageTexts.reduce((n, p) => n + p.text.length, 0);

  let pdfPayload = null;
  let pageMap = null;
  let documentText = null;
  if (mode === 'native') {
    const sub = await subsetPdf(buf, pages);
    pageMap = sub.pageMap;
    pdfPayload = { base64: bytesToBase64(sub.bytes), fileName };
    if (pageMap) warnings.push(`Only pages ${pages} were sent to the model.`);
  } else {
    if (totalChars < 50 * pageTexts.length && totalChars < 2000) {
      throw new Error('Almost no text could be read from this PDF (it is probably scanned). Use a provider that accepts PDF files (Claude or OpenAI) with PDF mode "native".');
    }
    documentText = pageTexts.map((p) => `=== Page ${p.page} ===\n${p.text}`).join('\n\n');
  }

  const schema = buildSchema(fields);
  const text = buildUserPrompt({ template, fields, fiscalYear, instructions, documentText });
  onProgress?.(`Asking ${provider.name} (${provider.model})… this can take a minute or two.`);
  const res = await runLLM(provider, { system: SYSTEM_PROMPT, text, pdf: pdfPayload, schema, signal });

  onProgress?.('Parsing response…');
  const parsed = parseJsonResponse(res.text);
  const byKey = new Map((parsed.values || []).map((v) => [v.key, v]));
  const values = {};
  for (const f of fields) {
    const v = byKey.get(f.key);
    let page = Number.isInteger(v?.page) ? v.page : null;
    if (page && pageMap) page = pageMap[page - 1] ?? page; // map subset page numbers back to the original document
    values[f.key] = {
      value: coerceValue(v?.value ?? null, f.type),
      raw: v?.value ?? null,
      page,
      source: v?.source ?? null,
      confidence: v ? v.confidence || 'medium' : 'low',
      edited: false,
    };
  }
  const missing = fields.filter((f) => !byKey.has(f.key)).length;
  if (missing) warnings.push(`The model returned no entry for ${missing} field(s).`);

  return {
    meta: { company_name: null, fiscal_year: fiscalYear || null, period_end: null, currency: null, unit: null, ...(parsed.meta || {}) },
    values,
    notes: parsed.notes || null,
    numPages,
    mode,
    model: res.model,
    usage: res.usage,
    warnings,
  };
}
