// LLM provider adapters. All calls run directly from the browser.
//  - Anthropic (Claude): official @anthropic-ai/sdk with dangerouslyAllowBrowser.
//  - OpenAI, Google Gemini, Mistral, any OpenAI-compatible endpoint: official openai SDK with a baseURL.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const PROVIDER_TYPES = {
  anthropic: { label: 'Anthropic (Claude)', defaultModel: 'claude-opus-5-5', nativePdf: true, baseUrl: '' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-5.1', nativePdf: true, baseUrl: 'https://api.openai.com/v1' },
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-2.5-pro', nativePdf: false, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  mistral: { label: 'Mistral', defaultModel: 'mistral-large-latest', nativePdf: false, baseUrl: 'https://api.mistral.ai/v1' },
  'openai-compatible': { label: 'OpenAI-compatible (Azure, Groq, Ollama, LM Studio…)', defaultModel: '', nativePdf: false, baseUrl: 'http://localhost:11434/v1' },
};

// Claude models that accept server-side refusal fallbacks (fallbacks: "default").
const CLAUDE_FALLBACK_MODELS = ['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'];

export const supportsNativePdf = (provider) => !!PROVIDER_TYPES[provider?.type]?.nativePdf;

/**
 * Run one structured-extraction request.
 * @param provider  { type, apiKey, model, baseUrl, effort }
 * @param req       { system, text, pdf?: { base64, fileName }, schema, signal }
 * @returns { text, model, usage }
 */
export async function runLLM(provider, req) {
  if (!provider) throw new Error('No LLM provider configured. Add one in Settings.');
  if (!provider.model) throw new Error(`Provider "${provider.name}" has no model set.`);
  if (provider.type === 'anthropic') return runAnthropic(provider, req);
  return runOpenAICompatible(provider, req);
}

async function runAnthropic(p, { system, text, pdf, schema, signal }) {
  const client = new Anthropic({
    apiKey: p.apiKey,
    baseURL: p.baseUrl || undefined,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });
  const content = [];
  if (pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 }, title: pdf.fileName });
  content.push({ type: 'text', text });

  const outputConfig = { format: { type: 'json_schema', schema } };
  if (p.effort) outputConfig.effort = p.effort;
  const base = { model: p.model, max_tokens: 64000, system, messages: [{ role: 'user', content }], output_config: outputConfig };

  const useFallbacks = CLAUDE_FALLBACK_MODELS.includes(p.model);
  let message;
  try {
    // Streaming avoids HTTP timeouts on long documents; finalMessage() collects the full response.
    message = useFallbacks
      ? await client.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal }).finalMessage()
      : await client.messages.stream(base, { signal }).finalMessage();
  } catch (e) {
    if (useFallbacks && e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
      message = await client.messages.stream(base, { signal }).finalMessage();
    } else throw friendlyAnthropicError(e);
  }

  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.explanation || message.stop_details?.category || 'no details';
    throw new Error(`The model declined this request (${why}).`);
  }
  if (message.stop_reason === 'max_tokens') throw new Error('The response was cut off (max tokens reached). Try a smaller page range or fewer fields.');
  const out = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text: out, model: message.model, usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens } };
}

function friendlyAnthropicError(e) {
  if (e instanceof Anthropic.AuthenticationError) return new Error('Anthropic rejected the API key (401). Check it in Settings.');
  if (e instanceof Anthropic.NotFoundError) return new Error(`Anthropic: model not found (${e.message}).`);
  if (e instanceof Anthropic.RateLimitError) return new Error('Anthropic rate limit reached (429). Wait a moment and retry.');
  if (e instanceof Anthropic.APIConnectionError) return new Error(`Could not reach the Anthropic API: ${e.message}`);
  if (e instanceof Anthropic.APIError) return new Error(`Anthropic API error ${e.status ?? ''}: ${e.message}`);
  return e;
}

async function runOpenAICompatible(p, { system, text, pdf, schema, signal }) {
  const client = new OpenAI({
    apiKey: p.apiKey || 'not-needed',
    baseURL: p.baseUrl || PROVIDER_TYPES[p.type]?.baseUrl || undefined,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
  });
  const userContent = [];
  if (pdf) userContent.push({ type: 'file', file: { filename: pdf.fileName, file_data: `data:application/pdf;base64,${pdf.base64}` } });
  userContent.push({ type: 'text', text });
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: pdf ? userContent : text },
  ];

  // Prefer strict JSON schema; fall back to JSON mode, then to plain text, for endpoints that lack them.
  const formats = [
    { type: 'json_schema', json_schema: { name: 'financial_extraction', strict: true, schema } },
    { type: 'json_object' },
    null,
  ];
  let lastErr;
  for (const response_format of formats) {
    try {
      const res = await client.chat.completions.create(
        { model: p.model, messages, ...(response_format ? { response_format } : {}) },
        { signal },
      );
      const choice = res.choices?.[0];
      if (choice?.message?.refusal) throw new Error(`The model declined this request: ${choice.message.refusal}`);
      if (choice?.finish_reason === 'length') throw new Error('The response was cut off (length limit). Try a smaller page range or fewer fields.');
      return { text: choice?.message?.content || '', model: res.model, usage: { input: res.usage?.prompt_tokens, output: res.usage?.completion_tokens } };
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof OpenAI.BadRequestError || e?.status === 422 || e?.status === 400;
      if (!retryable || !response_format) break;
    }
  }
  if (lastErr instanceof OpenAI.AuthenticationError) throw new Error(`${p.name}: API key rejected (401). Check it in Settings.`);
  if (lastErr instanceof OpenAI.APIConnectionError)
    throw new Error(`Could not reach ${p.baseUrl || p.type}. If the endpoint does not allow browser (CORS) requests, it cannot be called from this app. (${lastErr.message})`);
  throw lastErr;
}

/** Small request to verify key/model/CORS. */
export async function testProvider(p) {
  const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
  const r = await runLLM(p, { system: 'Reply with JSON only.', text: 'Return {"ok": true}.', schema });
  return r;
}

/** Tolerant JSON parsing of a model response (strips code fences / surrounding prose). */
export function parseJsonResponse(text) {
  const t = String(text || '').trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error('The model did not return valid JSON.');
}
