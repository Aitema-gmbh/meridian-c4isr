export const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev";

export async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`API ${path} returned ${resp.status}`);
  return resp.json() as Promise<T>;
}
