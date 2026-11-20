import { LumenApiError, LumenTimeoutError } from "./errors.js";

export interface FetchWithRetryOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit & FetchWithRetryOptions = {},
): Promise<Response> {
  const { timeoutMs = 30_000, retries = 0, signal, ...rest } = init;
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const composite = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    try {
      const res = await fetch(input, { ...rest, signal: composite });
      clearTimeout(timeout);
      if (!res.ok) {
        let payload: Record<string, unknown> = {};
        try {
          payload = (await res.json()) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        throw new LumenApiError(`${res.status} ${res.statusText}`, {
          status: res.status,
          code: typeof payload.code === "string" ? payload.code : undefined,
          requestId:
            typeof payload.requestId === "string" ? payload.requestId : res.headers.get("x-request-id") ?? undefined,
          details: payload.details ?? payload,
        });
      }
      return res;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        if (signal?.aborted) throw err;
        throw new LumenTimeoutError();
      }
      if (attempt >= retries || (rest.method && rest.method !== "GET")) {
        throw err;
      }
      attempt += 1;
    }
  }
}