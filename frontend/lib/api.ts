export class ApiError extends Error {
  status: number;
  /** machine-readable error code of the response body, e.g. "DATA_NOT_AVAILABLE" (null when absent) */
  code: string | null;
  /** the parsed JSON error body (null when the body was not JSON) */
  data: unknown;
  constructor(status: number, message: string, data: unknown = null) {
    super(message);
    this.status = status;
    this.data = data ?? null;
    const code = data && typeof data === "object" ? (data as { code?: unknown }).code : undefined;
    this.code = typeof code === "string" && code ? code : null;
  }
}

/** True for the backend's "no provider can serve this instrument" error (503 {code: "DATA_NOT_AVAILABLE"}). */
export function isDataNotAvailable(e: unknown): boolean {
  return e instanceof ApiError && e.code === "DATA_NOT_AVAILABLE";
}

/** The `reason` of a structured error body (DATA_NOT_AVAILABLE / MARKET_DATA_ERROR), else the message. */
export function errorReason(e: unknown): string {
  if (e instanceof ApiError && e.data && typeof e.data === "object") {
    const reason = (e.data as { reason?: unknown }).reason;
    if (typeof reason === "string" && reason) return reason;
  }
  return errorMessage(e);
}

type Options = { method?: string; body?: unknown; signal?: AbortSignal; redirectOn401?: boolean };

function detailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const item = d as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(item.loc) ? item.loc.filter((x) => x !== "body").join(".") : "";
        return field ? `${field}: ${item.msg}` : item.msg;
      })
      .join("; ");
  }
  return fallback;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, signal, redirectOn401 = true } = opts;
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-ta-client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    let data: unknown = null;
    try {
      data = await res.json();
      message = detailToMessage((data as { detail?: unknown } | null)?.detail, message);
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && redirectOn401 && typeof window !== "undefined" && !path.startsWith("/auth")) {
      // a hard navigation is intended here: the session is gone, so all client state is reset
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
    throw new ApiError(res.status, message, data);
  }
  return (await res.json()) as T;
}

export const fetcher = <T,>(path: string) => api<T>(path);

export const post = <T = unknown,>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const put = <T = unknown,>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const patch = <T = unknown,>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const del = <T = unknown,>(path: string) => api<T>(path, { method: "DELETE" });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
