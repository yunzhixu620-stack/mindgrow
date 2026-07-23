export type InitialSessionResult<T> =
  | { status: "ready"; session: T | null }
  | { status: "timeout"; session: null }
  | { status: "error"; session: null };

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
