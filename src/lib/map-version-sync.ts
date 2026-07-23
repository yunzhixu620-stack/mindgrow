export interface MapVersionMessage {
  mapId: string;
  workspaceId: string;
  version: number;
  sourceTabId: string;
}

const CHANNEL_NAME = "mindgrow.map-version.v1";
const STORAGE_KEY = "mindgrow.map-version.v1";
const sourceTabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export function normalizeMapVersionMessage(value: unknown): MapVersionMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MapVersionMessage>;
  const mapId = String(candidate.mapId || "").trim();
  const workspaceId = String(candidate.workspaceId || "").trim();
  const version = Number(candidate.version);
  const sender = String(candidate.sourceTabId || "").trim();
  if (!mapId || !workspaceId || !sender || !Number.isFinite(version) || version <= 0) return null;
  return { mapId, workspaceId, version, sourceTabId: sender };
}

export function isNewerRemoteMapVersion(
  message: MapVersionMessage,
  workspaceId: string,
  currentVersion: number,
) {
  return message.sourceTabId !== sourceTabId
    && message.workspaceId === workspaceId
    && message.version > currentVersion;
}

export function broadcastMapVersion(mapId: string, workspaceId: string, version = Date.now()) {
  if (typeof window === "undefined" || !mapId || !workspaceId) return;
  const message: MapVersionMessage = { mapId, workspaceId, version, sourceTabId };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
  } catch {
    // BroadcastChannel can still deliver when storage is disabled.
  }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(message);
    channel.close();
  }
}

export function subscribeMapVersions(listener: (message: MapVersionMessage) => void) {
  if (typeof window === "undefined") return () => undefined;
  const emit = (value: unknown) => {
    const message = normalizeMapVersionMessage(value);
    if (message && message.sourceTabId !== sourceTabId) listener(message);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { emit(JSON.parse(event.newValue)); } catch { /* Ignore malformed cross-tab data. */ }
  };
  window.addEventListener("storage", onStorage);
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;
  if (channel) channel.onmessage = (event) => emit(event.data);
  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}

export const __mapVersionSyncInternal = { CHANNEL_NAME, STORAGE_KEY, sourceTabId };
