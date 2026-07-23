type ManagedSession = { access_token: string };

export interface ManagedSessionAuth {
  getSession: () => Promise<{ data: { session: ManagedSession | null } }>;
  refreshSession: () => Promise<{ data: { session: ManagedSession | null }; error?: unknown }>;
}

type ManagedRequestOptions = {
  auth: ManagedSessionAuth;
  headers?: HeadersInit;
  workspaceId?: string | null;
  send: (headers: Headers) => Promise<Response>;
};

const refreshes = new WeakMap<ManagedSessionAuth, Promise<ManagedSession | null>>();

function managedHeaders(base: HeadersInit | undefined, session: ManagedSession | null, workspaceId?: string | null) {
  const headers = new Headers(base);
  // Callers cannot inject a different user or tenant. Both values come from
  // the managed session and the workspace selected by the signed-in user.
  headers.delete("Authorization");
  headers.delete("X-Workspace-Id");
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (workspaceId) headers.set("X-Workspace-Id", workspaceId);
  return headers;
}

async function refreshOnce(auth: ManagedSessionAuth): Promise<ManagedSession | null> {
  const existing = refreshes.get(auth);
  if (existing) return existing;
  const pending = (async () => {
    try {
      const { data, error } = await auth.refreshSession();
      return error ? null : data.session;
    } catch {
      return null;
    }
  })();
  refreshes.set(auth, pending);
  try {
    return await pending;
  } finally {
    if (refreshes.get(auth) === pending) refreshes.delete(auth);
  }
}

/**
 * Sends one request with the current Supabase session. A 401 triggers one
 * shared refresh and one retry; a second 401 is returned without a loop.
 */
export async function sendWithManagedSession({ auth, headers, workspaceId, send }: ManagedRequestOptions): Promise<Response> {
  const { data } = await auth.getSession();
  const firstResponse = await send(managedHeaders(headers, data.session, workspaceId));
  if (firstResponse.status !== 401 || !data.session?.access_token) return firstResponse;

  const refreshedSession = await refreshOnce(auth);
  if (!refreshedSession?.access_token) return firstResponse;
  return send(managedHeaders(headers, refreshedSession, workspaceId));
}
