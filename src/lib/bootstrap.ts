export interface BootstrapTenantIdentity {
  user?: { id?: string } | null;
  workspace?: { id?: string } | null;
}

export function matchesBootstrapTenant(
  bootstrap: BootstrapTenantIdentity | null | undefined,
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
): boolean {
  if (!bootstrap || !userId || !workspaceId) return false;
  return bootstrap.user?.id === userId && bootstrap.workspace?.id === workspaceId;
}
