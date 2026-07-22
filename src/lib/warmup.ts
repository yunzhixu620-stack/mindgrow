import { API_BASE_URL } from "@/lib/config";

export const HEALTH_WARMUP_COOLDOWN_MS = 30_000;
export const HEALTH_WARMUP_TIMEOUT_MS = 3_000;

export type HealthWarmupDiagnostic = {
  kind: "http" | "network" | "timeout";
  status?: number;
};

type WarmupState = {
  warmedAt: number;
  inFlight: Promise<void> | null;
};

type HealthWarmerOptions = {
  apiBaseUrl: string;
  cooldownMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  diagnose?: (diagnostic: HealthWarmupDiagnostic) => void;
  state?: WarmupState;
};

type WarmupGlobal = typeof globalThis & {
  __mindgrowHealthWarmupState?: WarmupState;
};

function browserSessionState(): WarmupState {
  const scope = globalThis as WarmupGlobal;
  if (!scope.__mindgrowHealthWarmupState) {
    scope.__mindgrowHealthWarmupState = { warmedAt: Number.NEGATIVE_INFINITY, inFlight: null };
  }
  return scope.__mindgrowHealthWarmupState;
}

function recordDiagnostic(diagnostic: HealthWarmupDiagnostic) {
  // Deliberately omit the API URL, response body and thrown error message.
  // The warm request is opportunistic and must never block or expose secrets.
  console.debug("MindGrow health warmup diagnostic", diagnostic);
}

export function createHealthWarmer(options: HealthWarmerOptions) {
  const apiBaseUrl = String(options.apiBaseUrl || "").replace(/\/+$/, "");
  const cooldownMs = options.cooldownMs ?? HEALTH_WARMUP_COOLDOWN_MS;
  const timeoutMs = options.timeoutMs ?? HEALTH_WARMUP_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const diagnose = options.diagnose ?? recordDiagnostic;
  const state = options.state ?? { warmedAt: Number.NEGATIVE_INFINITY, inFlight: null };

  return function warmupHealthRequest(): Promise<void> | null {
    if (!apiBaseUrl) return null;
    if (state.inFlight) return state.inFlight;

    const currentTime = now();
    if (currentTime >= state.warmedAt && currentTime - state.warmedAt < cooldownMs) return null;
    state.warmedAt = currentTime;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const request = fetchImpl(`${apiBaseUrl}/health`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) diagnose({ kind: "http", status: response.status });
    }).catch((error: unknown) => {
      diagnose({ kind: error instanceof Error && error.name === "AbortError" ? "timeout" : "network" });
    }).finally(() => {
      clearTimeout(timer);
      if (state.inFlight === request) state.inFlight = null;
    });

    state.inFlight = request;
    return request;
  };
}

export function warmupHealth(): Promise<void> | null {
  return createHealthWarmer({
    apiBaseUrl: API_BASE_URL,
    state: browserSessionState(),
  })();
}
