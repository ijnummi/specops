const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);
  return readResponse<T>(response);
}

export async function apiSend<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  return readResponse<T>(response);
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  throw new Error(await readErrorMessage(response));
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as unknown;
      return extractJsonError(payload) ?? fallback;
    } catch {
      return fallback;
    }
  }

  const text = await response.text();
  return text.trim() || fallback;
}

function extractJsonError(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const error = payload.error;
  if (isRecord(error) && typeof error.message === "string") {
    const details = formatDetails(error.details);
    return details ? `${error.message}: ${details}` : error.message;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return null;
}

function formatDetails(details: unknown): string | null {
  if (details === null || details === undefined) {
    return null;
  }

  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
