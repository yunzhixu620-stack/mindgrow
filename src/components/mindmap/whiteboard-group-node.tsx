"use client";

import { memo } from "react";
import { NodeProps } from "reactflow";
import type { WhiteboardGroup } from "@/types";

export interface WhiteboardGroupNodeData {
  group: WhiteboardGroup;
  cardCount: number;
  busy: boolean;
  onRename: (groupId: string) => void;
  onToggleCollapsed: (groupId: string) => void;
  onDelete: (groupId: string) => void;
  onResize: (groupId: string, geometry: { positionX: number; positionY: number; width: number; height: number }) => void;
}

function WhiteboardGroupNodeView({ data, selected }: NodeProps<WhiteboardGroupNodeData>) {
  const { group } = data;
  const resizeBy = (widthDelta: number, heightDelta: number) => data.onResize(group.id, {
    positionX: group.positionX,
    positionY: group.positionY,
    width: Math.max(240, Math.min(2400, group.width + widthDelta)),
    height: Math.max(160, Math.min(2000, group.height + heightDelta)),
  });
  return (
    <section
      className="pointer-events-none relative h-full w-full rounded-[22px] border-2 border-dashed shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors"
      style={{
        borderColor: `${group.color}99`,
        backgroundColor: `${group.color}12`,
        boxShadow: selected ? `0 0 0 2px ${group.color}44, inset 0 1px 0 rgba(255,255,255,0.05)` : undefined,
      }}
      data-testid="whiteboard-group"
      data-whiteboard-group-id={group.id}
      data-whiteboard-group-collapsed={String(group.collapsed)}
    >
      <div
        className="whiteboard-group-drag pointer-events-auto flex h-[76px] cursor-grab items-center justify-between gap-3 rounded-t-[20px] px-4 active:cursor-grabbing"
        data-testid="whiteboard-group-drag-handle"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
            <h3 className="truncate text-sm font-semibold text-[var(--foreground)]" title={group.name}>{group.name}</h3>
          </div>
          <p className="mt-1 pl-[18px] text-[10px] text-[var(--muted-foreground)]">
            {data.cardCount} 张卡片{group.collapsed ? " · 已折叠" : " · 拖动标题移动整组"}
          </p>
        </div>

        <div className="nodrag nopan flex shrink-0 items-center gap-1">
          {!group.collapsed && (
            <>
              <button
                type="button"
                onClick={() => resizeBy(-120, -80)}
                disabled={data.busy || (group.width <= 240 && group.height <= 160)}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)]/90 px-2 py-1 text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                aria-label={`缩小分组 ${group.name}`}
                title="缩小分组"
              >−</button>
              <button
                type="button"
                onClick={() => resizeBy(120, 80)}
                disabled={data.busy || (group.width >= 2400 && group.height >= 2000)}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)]/90 px-2 py-1 text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                aria-label={`放大分组 ${group.name}`}
                title="放大分组"
              >＋</button>
            </>
          )}
          <button
            type="button"
            onClick={() => data.onRename(group.id)}
            disabled={data.busy}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)]/90 px-2 py-1 text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
            aria-label={`重命名分组 ${group.name}`}
          >编辑</button>
          <button
            type="button"
            onClick={() => data.onToggleCollapsed(group.id)}
            disabled={data.busy}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)]/90 px-2 py-1 text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
            aria-label={`${group.collapsed ? "展开" : "折叠"}分组 ${group.name}`}
          >{group.collapsed ? "展开" : "折叠"}</button>
          <button
            type="button"
            onClick={() => data.onDelete(group.id)}
            disabled={data.busy}
            className="rounded-lg border border-red-400/20 bg-red-500/5 px-2 py-1 text-[10px] text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-40"
            aria-label={`删除分组 ${group.name}`}
          >删除</button>
        </div>
      </div>

      {!group.collapsed && (
        <div className="pointer-events-none absolute inset-x-4 bottom-3 text-[9px] text-[var(--muted-foreground)]/70">
          把卡片中心拖入此区域即可归组；拖出边界即可移出
        </div>
      )}
    </section>
  );
}

export const WhiteboardGroupNode = memo(WhiteboardGroupNodeView);
