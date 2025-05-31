// LLM provider adapters. All calls run directly from the browser.
//  - Anthropic (Claude): official @anthropic-ai/sdk with dangerouslyAllowBrowser.
//  - OpenAI, Google Gemini, Mistral, any OpenAI-compatible endpoint: official openai SDK with a baseURL.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const PROVIDER_TYPES = {
  anthropic: { label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-20250514', nativePdf: true, baseUrl: '' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4.1', nativePdf: true, baseUrl: 'https://api.openai.com/v1' },
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-2.5-pro-preview-05-06', nativePdf: false, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  mistral: { label: 'Mistral', defaultModel: 'mistral-large-latest', nativePdf: false, baseUrl: 'https://api.mistral.ai/v1' },
  'openai-compatible': { label: 'OpenAI-compatible (Azure, Groq, Ollama, LM Studio…)', defaultModel: '', nativePdf: false, baseUrl: 'http://localhost:11434/v1' },
};

export const supportsNativePdf = (provider) => !!PROVIDER_TYPES[provider?.type]?.nativePdf;

/**
 * Run one structured-extraction request.
 * @param provider  { type, apiKey, model, baseUrl }
 * @param req       { system, text, pdf?: { base64, fileName }, schema, signal }
 * @returns { text, model, usage }
 */
export async function runLLM(provider, req) {
  if (!provider) throw new Error('No LLM provider configured. Add one in Settings.');
  if (!provider.model) throw new Error(`Provider "${provider.name}" has no model set.`);
  if (provider.type === 'anthropic') return runAnthropic(provider, req);
  return runOpenAICompatible(provider, req);
}

// Output token limits per Claude model family (Opus 4: 32k, Sonnet 4 / 3.7: 64k, older: 8k).
function claudeMaxTokens(model) {
  if (/opus-4/.test(model)) return 32000;
  if (/sonnet-4|3-7-sonnet/.test(model)) return 64000;
  return 8192;
}

const TOOL_NAME = 'record_extraction';

// The Messages API has no JSON-schema output mode, so the schema is given as the input schema of a
// single tool and the model is forced to call it. The tool input is the structured result. It is not
// guaranteed to match the schema, so it is checked here and the request is retried once with the errors.
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

  const tools = [{ name: TOOL_NAME, description: 'Record the extracted values. Call this exactly once with the complete result.', input_schema: schema }];
  let messages = [{ role: 'user', content }];
  const usage = { input: 0, output: 0 };

  for (let attempt = 1; ; attempt++) {
    let message;
    try {
      // Streaming avoids HTTP timeouts on long documents; finalMessage() collects the full response.
      message = await client.messages
        .stream({ model: p.model, max_tokens: claudeMaxTokens(p.model), system, messages, tools, tool_choice: { type: 'tool', name: TOOL_NAME } }, { signal })
        .finalMessage();
    } catch (e) {
      throw friendlyAnthropicError(e);
    }
    usage.input += message.usage?.input_tokens || 0;
    usage.output += message.usage?.output_tokens || 0;

    if (message.stop_reason === 'refusal') throw new Error('The model declined this request.');
    if (message.stop_reason === 'max_tokens') throw new Error('The response was cut off (max tokens reached). Try a smaller page range or fewer fields.');

    const call = message.content.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
    const errors = call ? validateSchema(call.input, schema) : ['the model did not call the record_extraction tool'];
    if (!errors.length) return { text: JSON.stringify(call.input), model: message.model, usage };
    if (attempt >= 2) throw new Error(`The model's output did not match the expected format: ${errors.slice(0, 5).join('; ')}`);

    // Retry once, telling the model what was wrong.
    messages = [
      ...messages,
      { role: 'assistant', content: message.content },
      {
        role: 'user',
        content: [
          ...(call ? [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Invalid input: ${errors.slice(0, 20).join('; ')}` }] : []),
          { type: 'text', text: `Call ${TOOL_NAME} again with the complete, corrected result.` },
        ],
      },
    ];
  }
}

/** Minimal JSON-schema check for the subset buildSchema() uses: type, anyOf, enum, required, additionalProperties, items. */
export function validateSchema(value, schema, path = '$') {
  if (schema.anyOf) {
    return schema.anyOf.some((s) => !validateSchema(value, s, path).length) ? [] : [`${path}: does not match any allowed type`];
  }
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of the allowed values`);
  const t = schema.type;
  const typeOk =
    !t ||
    (t === 'null' && value === null) ||
    (t === 'string' && typeof value === 'string') ||
    (t === 'boolean' && typeof value === 'boolean') ||
    (t === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (t === 'integer' && Number.isInteger(value)) ||
    (t === 'array' && Array.isArray(value)) ||
    (t === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value));
  if (!typeOk) return [...errors, `${path}: expected ${t}`];
  if (t === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${path}.${k}: missing`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errors.push(...validateSchema(v, schema.properties[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: unexpected property`);
    }
  }
  if (t === 'array' && schema.items) value.forEach((v, i) => errors.push(...validateSchema(v, schema.items, `${path}[${i}]`)));
  return errors;
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
