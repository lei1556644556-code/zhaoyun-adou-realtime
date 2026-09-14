import type { OperationsMetricsSnapshot } from "@adou/shared";

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function errorFrom(response: Response) {
  const body = await response.json().catch(() => null) as { message?: string } | null;
  return new AdminApiError(body?.message ?? `运维接口返回 ${response.status}`, response.status);
}

export async function fetchMetrics(token: string, signal?: AbortSignal) {
  const response = await fetch("/api/admin/metrics", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<OperationsMetricsSnapshot>;
}

export async function streamMetrics(
  token: string,
  onMetrics: (snapshot: OperationsMetricsSnapshot) => void,
  signal: AbortSignal,
) {
  const response = await fetch("/api/admin/metrics/stream", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new AdminApiError("浏览器不支持实时指标流", 0);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (data) onMetrics(JSON.parse(data) as OperationsMetricsSnapshot);
    }
  }
}
