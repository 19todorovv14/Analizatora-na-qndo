export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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
    try {
      const j = await res.json();
      message = detailToMessage(j.detail, message);
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && redirectOn401 && typeof window !== "undefined" && !path.startsWith("/auth")) {
      // a hard navigation is intended here: the session is gone, so all client state is reset
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
    throw new ApiError(res.status, message);
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
