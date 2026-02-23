export interface Env {
  CLIPROXY_BASE_URL: string;  // Hetzner CLIProxy via Cloudflare Tunnel
  DB: D1Database;
  AISSTREAM_API_KEY?: string;
  NASA_FIRMS_API_KEY?: string;
}

export type ClaudeModel = "gemini-2.5-flash" | "gemini-2.5-pro" | "gemini-3.1-pro-high" | "gemini-3-pro-preview" | "claude-sonnet-4-6" | "claude-opus-4-6-thinking";

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface AIRequest {
  model: ClaudeModel;
  max_tokens?: number;
  system?: string;
  messages: Message[];
  tools?: Tool[];
  tool_choice?: { type: "function"; function: { name: string } };
  stream?: boolean;
}

export async function callClaude(baseUrl: string, req: AIRequest): Promise<Response> {
  const messages: Message[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push(...req.messages);

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream: req.stream || false,
  };
  if (req.max_tokens) body.max_tokens = req.max_tokens;
  if (req.tools) {
    body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }
  // Gemini models don't reliably support tool_choice in OpenAI format — omit it
  if (req.tool_choice && !req.model.startsWith("gemini")) {
    body.tool_choice = req.tool_choice;
  }

  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer cliproxy`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Model fallback chain: if primary model fails (429/5xx), try fallback */
const MODEL_FALLBACKS: Record<string, ClaudeModel> = {
  "claude-sonnet-4-6": "gemini-3.1-pro-high",
  "gemini-3.1-pro-high": "gemini-2.5-flash",
  "gemini-2.5-pro": "gemini-3.1-pro-high",
};

/** Convert snake_case keys to camelCase (Gemini sometimes returns snake_case despite camelCase schema) */
function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

function parseAIResponse<T>(data: Record<string, unknown>): T {
  const choices = data.choices as Array<{
    message: { content?: string; tool_calls?: Array<{ function: { arguments: string } }> };
    finish_reason?: string;
  }>;
  const choice = choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];

  // Check tool_call args — Gemini sometimes sends empty "{}" with analysis in content
  if (toolCall?.function?.arguments) {
    const parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    if (Object.keys(parsed).length >= 3) {
      return snakeToCamel(parsed) as T;
    }
    // Empty or near-empty tool_call — fall through to content parsing
  }

  // Fallback: extract JSON from content (Gemini puts analysis + JSON in content)
  const content = choice?.message?.content || "";

  // Try markdown code block first (```json ... ```)
  const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]) as Record<string, unknown>;
      if (Object.keys(parsed).length >= 3) return snakeToCamel(parsed) as T;
    } catch { /* ignore */ }
  }

  // Try to find the outermost JSON object in content
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (Object.keys(parsed).length >= 3) return snakeToCamel(parsed) as T;
    } catch { /* ignore parse errors */ }
  }

  throw new Error(`No tool_call in response (finish_reason: ${choice?.finish_reason})`);
}

/** Normalize watchcon values: "WATCHCON 4" → "IV", "WATCHCON III" → "III", "3" → "III" */
export function normalizeWatchcon(val: unknown): string {
  const s = String(val || "V").trim().toUpperCase().replace(/^WATCHCON\s*/i, "");
  const numToRoman: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV", "5": "V" };
  return numToRoman[s] || (["I", "II", "III", "IV", "V"].includes(s) ? s : "V");
}

/** Convert a tool-calling request to a JSON-in-content request (for Gemini models that don't support tool calling reliably) */
function convertToJsonContentRequest(req: AIRequest): AIRequest {
  // Extract required fields from the tool schema
  const tool = req.tools?.[0];
  const props = (tool?.parameters as Record<string, unknown>)?.properties as Record<string, { type: string; description?: string }> | undefined;
  const required = ((tool?.parameters as Record<string, unknown>)?.required as string[]) || [];

  let schemaHint = "";
  if (props) {
    const fields = Object.entries(props).map(([k, v]) => `  "${k}": ${v.type}${v.description ? ` // ${v.description}` : ""}`);
    schemaHint = `\n\nYou MUST respond with ONLY a JSON object (no markdown, no explanation before/after). Required fields:\n{\n${fields.join(",\n")}\n}\nRequired: ${required.join(", ")}`;
  }

  const systemContent = (req.system || "") + schemaHint;
  return {
    ...req,
    system: systemContent,
    tools: undefined,
    tool_choice: undefined,
  };
}

export async function callClaudeJSON<T>(baseUrl: string, req: AIRequest): Promise<T> {
  // Try primary model
  const resp = await callClaude(baseUrl, req);
  if (resp.ok) {
    return parseAIResponse<T>(await resp.json() as Record<string, unknown>);
  }

  // Check if we should try fallback (429 rate limit or 5xx server error)
  const status = resp.status;
  const fallbackModel = MODEL_FALLBACKS[req.model];
  if ((status === 429 || status >= 500) && fallbackModel) {
    console.log(`[AI Fallback] ${req.model} returned ${status}, trying ${fallbackModel}`);
    // For Gemini fallbacks: convert to JSON-in-content (Gemini tool calling is unreliable via proxy)
    const isGemini = fallbackModel.startsWith("gemini");
    const fallbackReq = isGemini
      ? convertToJsonContentRequest({ ...req, model: fallbackModel })
      : { ...req, model: fallbackModel };
    const fallbackResp = await callClaude(baseUrl, fallbackReq);
    if (fallbackResp.ok) {
      return parseAIResponse<T>(await fallbackResp.json() as Record<string, unknown>);
    }

    // Try second fallback
    const secondFallback = MODEL_FALLBACKS[fallbackModel];
    if ((fallbackResp.status === 429 || fallbackResp.status >= 500) && secondFallback) {
      console.log(`[AI Fallback] ${fallbackModel} returned ${fallbackResp.status}, trying ${secondFallback}`);
      const isGemini2 = secondFallback.startsWith("gemini");
      const secondReq = isGemini2
        ? convertToJsonContentRequest({ ...req, model: secondFallback })
        : { ...req, model: secondFallback };
      const secondResp = await callClaude(baseUrl, secondReq);
      if (secondResp.ok) {
        return parseAIResponse<T>(await secondResp.json() as Record<string, unknown>);
      }
      const text = await secondResp.text();
      throw new Error(`AI API error ${secondResp.status} (all fallbacks exhausted): ${text}`);
    }

    const text = await fallbackResp.text();
    throw new Error(`AI API error ${fallbackResp.status} (fallback ${fallbackModel}): ${text}`);
  }

  const text = await resp.text();
  throw new Error(`AI API error ${status}: ${text}`);
}

/**
 * Batch-translate non-English article titles using Claude.
 * Returns map of original → translated title.
 */
export async function translateBatch(
  baseUrl: string,
  titles: string[],
  sourceLang: string = "auto"
): Promise<Record<string, string>> {
  if (titles.length === 0) return {};
  const batch = titles.slice(0, 20); // limit batch size
  try {
    const resp = await callClaude(baseUrl, {
      model: "gemini-2.5-flash",
      max_tokens: 2048,
      system: `You are a translation assistant. Translate the following ${sourceLang !== "auto" ? sourceLang + " " : ""}titles to English. Return ONLY a JSON object mapping original titles to English translations. No explanation.`,
      messages: [{ role: "user", content: JSON.stringify(batch) }],
    });
    if (!resp.ok) return {};
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}
