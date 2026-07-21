import { tenantCache, type TenantScope } from "@/lib/tenant-cache";
import { useMindGrowStore } from "@/store/mindgrow-store";

type SessionIdentity = { user: { id: string } } | null;

export interface AuthTransition {
  nextUserId: string | null;
  shouldReset: boolean;
}

export function resolveAuthTransition(
  event: string,
  previousUserId: string | null,
  nextSession: SessionIdentity,
): AuthTransition {
  const nextUserId = nextSession?.user.id || null;
  const changedUser = previousUserId !== null && nextUserId !== null && previousUserId !== nextUserId;
  return {
    nextUserId,
    shouldReset: event === "SIGNED_OUT" || nextSession === null || changedUser,
  };
}

export function resetTenantData(userId: string | null, workspaceIds: Iterable<string>): void {
  if (userId) {
    const uniqueWorkspaceIds = new Set(Array.from(workspaceIds).filter((workspaceId) => workspaceId.trim()));
    uniqueWorkspaceIds.forEach((workspaceId) => {
      const scope: TenantScope = { userId, workspaceId };
      tenantCache.clearAllTenantCache(scope);
    });
  }
  useMindGrowStore.getState().resetTenantContext();
}
