export type InitialSessionResult<T> =
  | { status: "ready"; session: T | null }
  | { status: "timeout"; session: null }
  | { status: "error"; session: null };

export const AUTH_OPERATION_TIMEOUT = "AUTH_OPERATION_TIMEOUT";

export async function authOperationWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(AUTH_OPERATION_TIMEOUT)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function initialSessionWithTimeout<T>(
  getSession: () => Promise<{ data: { session: T | null } }>,
  timeoutMs = 12_000,
): Promise<InitialSessionResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      getSession()
        .then(({ data }) => ({ status: "ready" as const, session: data.session }))
        .catch(() => ({ status: "error" as const, session: null })),
      new Promise<InitialSessionResult<T>>((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout", session: null }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
