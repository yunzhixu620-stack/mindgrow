import { describe, expect, it, vi } from "vitest";
import { sendWithManagedSession, type ManagedSessionAuth } from "@/lib/managed-session";

function auth(tokens: Array<string | null>, refreshError = false): ManagedSessionAuth {
  let index = 0;
  const sessionAt = (position: number) => {
    const token = tokens[position];
    return token ? { access_token: token } : null;
  };
  return {
    getSession: vi.fn(async () => ({ data: { session: sessionAt(0) } })),
    refreshSession: vi.fn(async () => {
      index += 1;
      return { data: { session: sessionAt(index) }, error: refreshError ? new Error("refresh failed") : undefined };
    }),
  };
}

describe("managed Supabase session requests", () => {
  it("adds only the managed token and selected workspace", async () => {
    const sessionAuth = auth(["managed-token"]);
    const send = vi.fn(async (headers: Headers) => new Response(JSON.stringify({
      authorization: headers.get("Authorization"),
      workspace: headers.get("X-Workspace-Id"),
    }), { status: 200 }));

    const response = await sendWithManagedSession({
      auth: sessionAuth,
      workspaceId: "workspace-a",
      headers: { Authorization: "Bearer caller-token", "X-Workspace-Id": "workspace-b" },
      send,
    });

    expect(await response.json()).toEqual({ authorization: "Bearer managed-token", workspace: "workspace-a" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refreshes one time after a 401 and retries with the new token", async () => {
    const sessionAuth = auth(["expired-token", "fresh-token"]);
    const seen: Array<string | null> = [];
    const send = vi.fn(async (headers: Headers) => {
      seen.push(headers.get("Authorization"));
      return new Response(null, { status: seen.length === 1 ? 401 : 200 });
    });

    const response = await sendWithManagedSession({ auth: sessionAuth, workspaceId: "workspace-a", send });

    expect(response.status).toBe(200);
    expect(seen).toEqual(["Bearer expired-token", "Bearer fresh-token"]);
    expect(sessionAuth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("never loops when the retry is also unauthorized", async () => {
    const sessionAuth = auth(["expired-token", "still-invalid"]);
    const send = vi.fn(async () => new Response(null, { status: 401 }));

    const response = await sendWithManagedSession({ auth: sessionAuth, send });

    expect(response.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sessionAuth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("returns the original 401 when refresh fails", async () => {
    const sessionAuth = auth(["expired-token", "unused-token"], true);
    const first = new Response("original unauthorized", { status: 401 });
    const send = vi.fn(async () => first);

    const response = await sendWithManagedSession({ auth: sessionAuth, send });

    expect(response).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends no authorization or workspace header without managed context", async () => {
    const sessionAuth = auth([null]);
    const send = vi.fn(async (headers: Headers) => new Response(JSON.stringify({
      authorization: headers.get("Authorization"),
      workspace: headers.get("X-Workspace-Id"),
    }), { status: 401 }));

    const response = await sendWithManagedSession({
      auth: sessionAuth,
      headers: { Authorization: "Bearer injected", "X-Workspace-Id": "injected-workspace" },
      send,
    });

    expect(await response.json()).toEqual({ authorization: null, workspace: null });
    expect(sessionAuth.refreshSession).not.toHaveBeenCalled();
  });

  it("shares one refresh across concurrent 401 responses", async () => {
    let releaseRefresh: ((value: { data: { session: { access_token: string } } }) => void) | undefined;
    const sessionAuth: ManagedSessionAuth = {
      getSession: vi.fn(async () => ({ data: { session: { access_token: "expired-token" } } })),
      refreshSession: vi.fn(() => new Promise<{ data: { session: { access_token: string } } }>((resolve) => { releaseRefresh = resolve; })),
    };
    const send = vi.fn(async (headers: Headers) => new Response(null, {
      status: headers.get("Authorization") === "Bearer expired-token" ? 401 : 200,
    }));

    const first = sendWithManagedSession({ auth: sessionAuth, send });
    const second = sendWithManagedSession({ auth: sessionAuth, send });
    await vi.waitFor(() => expect(sessionAuth.refreshSession).toHaveBeenCalledTimes(1));
    releaseRefresh?.({ data: { session: { access_token: "fresh-token" } } });

    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(sessionAuth.refreshSession).toHaveBeenCalledTimes(1);
  });
});
