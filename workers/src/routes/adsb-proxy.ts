import { CORS_HEADERS, corsError } from "../lib/cors";
import type { Env } from "../lib/anthropic";

export async function adsbProxy(_req: Request, _env: Env): Promise<Response> {
  try {
    const resp = await fetch("https://api.adsb.lol/v2/mil");
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ ac: [], error: `ADS-B API returned ${resp.status}` }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}
