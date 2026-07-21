# MindGrow · Codex 任务书 v3

**v3 相对 v2 的关键修订**（详见附录 A）：

1. Vitest 显式 `passWithNoTests: true`。
2. **P1 缓存重构为三层快照 + 引入 Immer**（server / local overlay / pending writes）。修补 v2 "hydrate 被拒时仍写 cache" 与 "mutate 不同步 cache" 漏洞。
3. **新增 P1.4 同步状态模型**：`pendingWritesByMap` / `lastWriteSucceededAt` / `lastWriteError`，区分读写。写入之前 U2 无法正确工作。
4. `mutateGraphLocally` 采用 Immer producer，避免 Zustand 订阅漏触发。
5. P2.0.1 的内部导出改为**单次集中导出**，避免 `module.exports = { ... }` 覆盖。
6. **P2.0.4 翻译分支 usedIds 改为"先出类型报告，Owner 确认后再写实现"**。
7. U1 挂载点从 `HelpPanel` 修正为 `/guide` 页面；`guide-timeline` 已占用，新用 `test id: version-timeline`。
8. U1 md 加载改为 **`node:fs` 构建期读取**，不动 `next.config.js`。parser 兼容 CRLF；渲染支持 `-` 列表 / `**bold**` / `[text](url)` / 换行。
9. `universe-view.tsx` 是 Canvas 绘制，U7 改为在 draw loop 内按 hovered 节点计算透明度。
10. U6.2 PDF 高亮 **从 UX 任务中拆出**，改立 Sprint 2 `S2.11 PDF 内嵌 Viewer + findController`。U6 本轮只做三段化 + 引用 chip，回原文只滚动 + 3s 高亮，不含 PDF。
11. **UX 前置 U1**：可与 P0.0 并行（U1 只依赖 vitest）。
12. **UX 前置 U3**：合并进 P3.0.2（同一 PR）。
13. **UX 前置 U6**：合并进 P2.0.3（同一 PR，产品定位关键路径）。
14. **UX U10 不新增底部导航**：移动端当前是顶部 tab，改为"重构现有顶部 tab 为底部 tab bar"，避免叠一层导航。
15. U8 改名为 **"主题切换（新增亮色主题）"**：当前已是深色，本任务是从"仅深色"到"深/浅双主题一键切换"。
16. U2 依赖修正为 P1.4；用 `pendingWritesByMap` 判 dirty，不用 revision，不用全局 inflight。
17. **P2.1 实体图质量修复（P0 新增）**：当前论文解析出来的实体 description 大量为空、关系 label 冗长、识别精度低——违反产品定位承诺。本轮必须修，见 §2 P2.1。

## 0. 全局约定

- 每 PR 一个子任务，标题 `[Pk.m.n]` 或 `[Uk.n]`。
- 每 PR 跑并附日志：
  ```powershell
  npm run lint
  npm run build
  npm run test:unit
  npm run test:rag
  npm run test:e2e:local
  npm run test:backend:local   # 纯前端 PR 可省略
  ```
- 严禁修改 `out/`、`.next/`；提交前 `git status` 干净。
- 严禁输出/日志任何 `Authorization` 头、`SUPABASE_KEY`、`DASHSCOPE_KEY`、Supabase 服务角色密钥。
- Vitest 是本仓库单测框架，`node --test` / `jest` 不接受。
- `test:backend` 已拆 `:local` 与 `:public`；CI 门禁只跑 `:local`。
- 遇到任务书未覆盖的分歧点，先在 PR 描述列出选项 + 建议，等 Owner 确认。

## 1. 合并顺序

```
P0.0.1 Vitest 底座 ──┬─→ U1 使用指南 · 版本演进 Timeline（可并行）
                     │
P0.0.2 test:backend 拆分
P0.0.3 runbook + api-version.txt
        ↓
P0.1 鉴权 fail-closed
        ↓
P0.2 SSRF 加固
        ↓
P1.0 租户缓存底座（三层快照 + Immer） + Store reset
        ↓
P1.1 page/Universe 迁移 + 取消 + 切工作区清屏
        ↓
P1.3 桌面/移动端统一 loader
        ↓
P1.2 双账号 E2E
        ↓
P1.4 同步状态模型（U2 前置）
        ↓
P2.0 Citation 真实性（含 U6 合并） ─┐
P2.1 实体图质量修复（P0）           ─┤ 三条 P2 可并行
P3.0 骨架屏 + /health warm（含 U3） ─┘
                                          ↓
U4 面包屑 → U7 图谱悬停呼吸感 → U9 空状态模板卡 → U10 移动底部 tab bar → U5 Cmd+K
                                          ↓
U2 顶部同步状态灯（依赖 P1.4）
                                          ↓
U8 主题切换（新增亮色）
```

之后 Sprint 2：`maps.mode` → `/api/bootstrap` → CI 事实校验 → Backlinks/时间轴 → 实体图 v1.1 → React Flow bug 清单 → S2.11 PDF Viewer 高亮 → 白板底座。

---

## 2. Sprint 1 · PR 级任务

### P0.0 · 测试底座 + runbook 修正

#### P0.0.1 Vitest

- 文件：`package.json`、新建 `vitest.config.ts`、`.gitignore`
- `npm i -D vitest@^2 @vitest/coverage-v8@^2`
- `vitest.config.ts`：
  ```ts
  import { defineConfig } from "vitest/config";
  import path from "node:path";
  export default defineConfig({
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      passWithNoTests: true,     // v3 修正
      globals: false,
    },
  });
  ```
- `package.json` scripts 加：`"test:unit": "vitest run --reporter=default"`。
- `.gitignore` 追加 `coverage/`。
- 顺便新增第一个 smoke test `src/lib/__tests__/smoke.test.ts`：`expect(1+1).toBe(2)`——即使 Vitest 未来把 `passWithNoTests` 默认改回 false 也不会 fail。
- 验收：`npm run test:unit` 退出码 0。

#### P0.0.2 `test:backend:local` / `test:backend:public`

（内容同 v2 P0.0.2，此处不重复。）

#### P0.0.3 `docs/api-version.txt` + runbook 单一真源

（内容同 v2 P0.0.3。）

---

### U1 · 使用指南 · 版本演进 Timeline（可与 P0.0 并行）

**目标**：在 `/guide` 增加"版本演进 Timeline"，与现有"工作流程 Timeline"并存。

**依赖**：P0.0.1（用 vitest 测 parser）。

#### U1.1 新增 `docs/changelog.md`（唯一数据源）

- 格式（严格）：
  ````markdown
  ## 2026-07-21 · v10.5.2 · performance

  **知识库切换零白屏**

  - 工作区/知识库/知识宇宙都加入本地缓存
  - 后台静默刷新，取消过期请求
  - 首屏冷启动前显示骨架屏

  ## 2026-07-15 · v10.4.0 · feature

  **GraphRAG 上线**

  - 实体关系图作为答案证据
  - 引用不足时降级为拒答
  ````
- 二级标题 pattern：`## <date> · v<version> · <tag>`；`tag ∈ milestone|feature|performance|fix|security`。
- 段落用 `**bold**` 标题一行，然后 `-` 列表 + 空行分隔。

#### U1.2 构建期 md 解析（不动 next.config.js）

- 文件：新建 `src/lib/changelog.ts`
- 用 `node:fs` + `path` 在构建期读取；`/guide/page.tsx` 是 Server Component，可以直接 `import` 并调用：
  ```ts
  import fs from "node:fs";
  import path from "node:path";

  export interface TimelineEntry {
    date: string;
    version: string;
    tag: "milestone" | "feature" | "performance" | "fix" | "security";
    title: string;
    bullets: string[];
  }

  const HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s+·\s+v([^\s·]+)\s+·\s+(\w+)\s*$/;

  export function parseChangelog(md: string): TimelineEntry[] {
    const lines = md.replace(/\r\n/g, "\n").split("\n");   // 兼容 CRLF
    const entries: TimelineEntry[] = [];
    let cur: TimelineEntry | null = null;
    for (const line of lines) {
      const m = HEADING.exec(line);
      if (m) {
        if (cur) entries.push(cur);
        cur = { date: m[1], version: m[2], tag: m[3] as TimelineEntry["tag"], title: "", bullets: [] };
        continue;
      }
      if (!cur) continue;
      if (!cur.title) {
        const boldMatch = /^\*\*(.+?)\*\*\s*$/.exec(line);
        if (boldMatch) { cur.title = boldMatch[1]; continue; }
      }
      const bulletMatch = /^-\s+(.+)$/.exec(line);
      if (bulletMatch) cur.bullets.push(bulletMatch[1]);
    }
    if (cur) entries.push(cur);
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }

  export function loadChangelog(): TimelineEntry[] {
    const md = fs.readFileSync(path.join(process.cwd(), "docs/changelog.md"), "utf8");
    return parseChangelog(md);
  }
  ```
- 单测 `src/lib/__tests__/changelog.test.ts`：
  1. CRLF/LF 混合输入被正确解析。
  2. 无 title 的 entry 被丢弃（`title === ""` 视为无效）。
  3. 顺序按 date 倒序。
  4. tag 白名单外的值不 crash（当作字符串保留，测试可断言其存在）。

#### U1.3 组件

- 文件：新建 `src/components/guide/version-timeline.tsx`
- 测试 id：`data-testid="version-timeline"`（`guide-timeline` 已占用，勿冲突）。
- 简易行内 renderer 支持 `**bold**`、`[label](url)`、纯文本换行，不引入 MDX：
  ```tsx
  function renderInline(text: string): React.ReactNode[] {
    // 顺序：先切 link，再切 bold，剩下纯文本
    const parts: React.ReactNode[] = [];
    let rest = text;
    const linkRE = /\[([^\]]+)\]\(([^)]+)\)/;
    while (rest) {
      const m = linkRE.exec(rest);
      if (!m) { parts.push(rest); break; }
      parts.push(rest.slice(0, m.index));
      parts.push(<a key={parts.length} href={m[2]} className="underline">{m[1]}</a>);
      rest = rest.slice(m.index + m[0].length);
    }
    return parts.map((p, i) => typeof p === "string"
      ? p.split(/(\*\*[^*]+\*\*)/).map((seg, j) =>
          /^\*\*.+\*\*$/.test(seg)
            ? <strong key={`${i}-${j}`}>{seg.slice(2, -2)}</strong>
            : <span key={`${i}-${j}`}>{seg}</span>)
      : p);
  }
  ```
- JSX：竖线 + 圆点 + 日期 chip + tag chip + 标题 + `<ul>` 列表；用现有 `text-[var(--text-primary)]` 等 CSS 变量对齐 `/guide` 主题。

#### U1.4 挂载到 `/guide/page.tsx`

- 文件：`src/app/guide/page.tsx`
- 新增区块（放在现有 `workflow` timeline 下方）：
  ```tsx
  import { loadChangelog } from "@/lib/changelog";
  import { VersionTimeline } from "@/components/guide/version-timeline";

  // ...
  const changelog = loadChangelog();
  // ...
  <section aria-labelledby="version-timeline-heading" className="max-w-5xl mx-auto px-5 py-12">
    <h2 id="version-timeline-heading" className="text-2xl font-semibold mb-6">版本演进</h2>
    <VersionTimeline entries={changelog} />
  </section>
  ```
- **不改** `guide-timeline`；新组件独立测试 id。
- 验收：`npm run build` 通过；打开 `/guide` 见新时间线；`npm run test:unit` 覆盖 parser 4 项。

---

### P0.1 · 鉴权 fail-closed

（内容同 v2 P0.1，无变化。）

### P0.2 · SSRF 加固

（内容同 v2 P0.2，无变化。）

---

### P1.0 · 租户缓存底座 · 三层快照 + Immer + resetTenantContext

**关键变化（v3）**：v2 用单个 Map 存 graph + revision，导致 hydrate 被拒时仍能污染 cache、mutate 不同步 cache。v3 重构为 **server / local / pending 三层**。

#### P1.0.0 引入 Immer

- 文件：`package.json`
- `npm i immer@^10 zustand@^4`（zustand 已在，不重复；确认版本 ≥ 4.5 支持 immer middleware）。
- 单测确认：`import { produce } from "immer"` 可用。

#### P1.0.1 `src/lib/tenant-cache.ts`（三层快照）

- 文件：新建 `src/lib/tenant-cache.ts`
- **数据结构**：
  ```ts
  export type TenantScope = { userId: string; workspaceId: string };
  export interface GraphSnapshot {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    entityGraph: EntityGraph;
  }
  export interface CachedMapGraph {
    server: GraphSnapshot;        // 最近一次服务器成功响应
    local?: GraphSnapshot;        // 若有本地未同步的改动，overlay 快照
    storedAt: number;
    localBaseRevision?: number;   // local 是基于哪次 server 版本编辑的
  }
  export interface CachedUniverse { libraries: unknown[]; storedAt: number; }

  export function tenantKey(scope: TenantScope, mapId: string): string;
  export function getMapGraphCache(): Map<string, CachedMapGraph>;
  export function getUniverseCache(): Map<string, CachedUniverse>;
  export function clearAllTenantCache(): void;
  export function subscribeTenantReset(fn: () => void): () => void;

  // 便利方法（避免调用点 hand-roll）：
  export function readMapGraph(scope: TenantScope, mapId: string): GraphSnapshot | null;
  export function writeServerSnapshot(scope: TenantScope, mapId: string, snapshot: GraphSnapshot, revisionAtRequestStart: number): void;
  export function writeLocalOverlay(scope: TenantScope, mapId: string, overlay: GraphSnapshot, baseRevision: number): void;
  export function clearLocalOverlay(scope: TenantScope, mapId: string): void;
  ```
- **`writeServerSnapshot` 规则**：
  - 仅当 `existing.local === undefined` 或 `revisionAtRequestStart === existing.localBaseRevision` 才覆盖 `server`；否则**丢弃**（本地有更新的改动，服务器数据是旧的）。
  - 无论是否覆盖 server，都不动 local。
- **`readMapGraph` 规则**：有 `local` 优先返回 `local`，否则返回 `server`。
- 测试 `src/lib/__tests__/tenant-cache.test.ts`：
  1. tenantKey 唯一性 3 例。
  2. clearAllTenantCache → size===0 且订阅触发一次。
  3. writeServerSnapshot 无 local 时正常覆盖。
  4. writeLocalOverlay 后再来一个旧 revision 的 server response，server 不被覆盖。
  5. writeLocalOverlay 后 clearLocalOverlay，再来 server response 能正常覆盖。

#### P1.0.2 Store 三层通道 + Immer + `resetTenantContext`

- 文件：`src/store/mindgrow-store.ts`
- 引入 immer producer：
  ```ts
  import { produce, enableMapSet } from "immer";
  enableMapSet();   // 供 collapsedNodes Set 使用
  ```
- **新增字段**：
  ```ts
  serverRevisionByMap: Record<string, number>;   // 每次成功 hydrate 递增
  localRevisionByMap: Record<string, number>;    // 每次 mutate 递增
  getServerRevision: (mapId: string) => number;
  getLocalRevision: (mapId: string) => number;
  hydrateGraphFromServer: (
    mapId: string,
    snapshot: GraphSnapshot,
    baseServerRevision: number,   // 发起请求时的 serverRevision
    scope: TenantScope,
  ) => "applied" | "rejected-stale-request" | "rejected-local-dirty";
  mutateGraphLocally: (
    mapId: string,
    scope: TenantScope,
    recipe: (draft: GraphSnapshot) => void,
  ) => void;
  resetTenantContext: () => void;
  ```
- **`mutateGraphLocally` 实现**：
  ```ts
  mutateGraphLocally: (mapId, scope, recipe) => {
    const state = get();
    if (state.currentMapId !== mapId) return;
    const base: GraphSnapshot = { nodes: state.nodes, edges: state.edges, entityGraph: state.entityGraph };
    const next = produce(base, recipe);
    set(produce(state, (d) => {
      d.nodes = next.nodes;
      d.edges = next.edges;
      d.entityGraph = next.entityGraph;
      d.localRevisionByMap[mapId] = (d.localRevisionByMap[mapId] ?? 0) + 1;
    }));
    // 同步写 tenant cache 的 local overlay
    writeLocalOverlay(scope, mapId, next, get().serverRevisionByMap[mapId] ?? 0);
  }
  ```
- **`hydrateGraphFromServer` 实现**：
  ```ts
  hydrateGraphFromServer: (mapId, snapshot, baseServerRevision, scope) => {
    const state = get();
    if (state.currentMapId !== mapId) return "rejected-stale-request";
    const currentServerRev = state.serverRevisionByMap[mapId] ?? 0;
    if (currentServerRev !== baseServerRevision) return "rejected-stale-request";
    // 是否有本地未同步改动？
    const cached = getMapGraphCache().get(tenantKey(scope, mapId));
    const isLocalDirty = cached?.local !== undefined;
    if (isLocalDirty) {
      // 仍写 server snapshot 到 cache（供 clearLocalOverlay 后使用）
      writeServerSnapshot(scope, mapId, snapshot, currentServerRev);
      return "rejected-local-dirty";
    }
    set(produce(state, (d) => {
      d.nodes = snapshot.nodes;
      d.edges = snapshot.edges;
      d.entityGraph = snapshot.entityGraph;
      d.serverRevisionByMap[mapId] = currentServerRev + 1;
    }));
    writeServerSnapshot(scope, mapId, snapshot, currentServerRev);
    return "applied";
  }
  ```
- **`resetTenantContext`**：完整清理（见 v2 附录 A 列表），额外重置 `serverRevisionByMap = {}`、`localRevisionByMap = {}`。
- 测试 `src/store/__tests__/mindgrow-store.test.ts`：
  1. mutate → local rev +1；hydrate 使用旧 base rev → 返回 `"rejected-stale-request"`，nodes 不动。
  2. mutate → 使用正确 base rev 的 hydrate → 返回 `"rejected-local-dirty"`，nodes 保留 local。
  3. clearLocalOverlay 后再 hydrate → `"applied"`，nodes 被覆盖。
  4. resetTenantContext → 所有字段归零；再次调用幂等。
  5. mutate 后 `readMapGraph(scope, mapId)` 返回 local overlay。

#### P1.0.3 `auth-provider` 触发 `resetTenantContext`

（内容同 v2 P1.0.3，用 `nextSession?.user.id` + `lastUserIdRef` 判换号；`signOut` 与 `SIGNED_OUT` 幂等；调用 `clearAllTenantCache()` 与 `resetTenantContext()`。）

---

### P1.1 · page/Universe 迁移 + 取消 + 切工作区清屏

#### P1.1.1 `page.tsx` 迁移

- 文件：`src/app/page.tsx`
- 迁移要点（相对 v2 更严格）：
  1. 请求发起前记录：
     ```ts
     const baseServerRevision = useMindGrowStore.getState().getServerRevision(currentMapId);
     ```
  2. 响应处理：
     ```ts
     const result = useMindGrowStore.getState().hydrateGraphFromServer(
       currentMapId, snapshot, baseServerRevision, scope
     );
     if (result === "rejected-local-dirty") {
       // 已经把 server snapshot 写入 cache，安静返回，不覆盖本地
       setModeLibraryBusy(false);
       return;
     }
     if (result === "rejected-stale-request") return;   // 静默丢弃
     setModeLibraryBusy(false);
     ```
  3. 删除 v2 那段"本地编辑同步到 cache"的 effect（P1.0.2 的 `mutateGraphLocally` 已负责同步 overlay）。
  4. 依赖数组：`maps` → `mapsSignature`（`useMemo` 版）。
  5. `subscribeTenantReset` 订阅：清 `prefetchedMapKeysRef`。
- 测试：`src/app/__tests__/page-race.test.tsx`
  - 连续两次切图，第二次先返回：cache 与 store 都只有第二次结果。
  - `mutateGraphLocally` 后 revalidation 返回：store 保留 local，cache.server 被写入，cache.local 仍是本地版本。

#### P1.1.2 `universe-view.tsx` 迁移

（内容同 v2 P1.1.2；用 `tenantKey(scope, "__aggregate__")`，cancel/abort 齐全，`fetchUniverseLibraries(signal?)`。）

---

### P1.3 · 桌面/移动端统一 loader

（内容同 v2 P1.3。核心：删除 `page.tsx:857-871` 移动端自建 loader，改为 `handleSwitchMap(mapId)`。）

---

### P1.2 · 双账号隔离 E2E

（内容同 v2 P1.2。缺 env 时 skip 且 exit 0，不算发布通过。）

---

### P1.4 · 同步状态模型（U2 前置）

**目标**：提供 U2 顶栏状态灯所需的数据；把"写操作 pending"与"读操作 in-flight"严格分开。

- 文件：`src/store/mindgrow-store.ts`、`src/lib/client-api.ts`
- **Store 新增**：
  ```ts
  pendingWritesByMap: Record<string, number>;   // 每张图当前未完成写请求数
  lastWriteSucceededAt: number | null;
  lastWriteError: { code?: string; message: string; at: number } | null;
  networkOnline: boolean;                        // navigator.onLine 镜像
  beginWrite: (mapId: string) => void;
  endWrite: (mapId: string, result: { ok: true } | { ok: false; code?: string; message: string }) => void;
  ```
- **`client-api.ts` 改造**：
  - `apiFetch` 增加可选参数 `{ writeForMapId?: string }`；调用点在发起知识写请求（`POST /api/knowledge`、`PUT /api/knowledge`、`DELETE`）时传 mapId。
  - `apiFetch` 内部：写请求进入前 `beginWrite(mapId)`；请求成功/失败 finally 里 `endWrite(...)`。
  - 读请求（GET）**不**触发 pending。
  - `navigator.onLine` 与 `online/offline` 事件绑到 store 的 `networkOnline`。
- **派生 hook** `src/lib/use-sync-status.ts`：
  ```ts
  export type SyncState = "idle" | "syncing" | "dirty" | "offline" | "error";
  export function useSyncStatus(mapId: string): { state: SyncState; lastSuccessAt: number | null; error: string | null };
  ```
  规则：
  - `!networkOnline` → `offline`
  - `pendingWritesByMap[mapId] > 0` → `syncing`
  - `lastWriteError && Date.now() - lastWriteError.at < 5000` → `error`
  - `getLocalRevision(mapId) > getServerRevision(mapId)` → `dirty`
  - else → `idle`
- 测试：`src/lib/__tests__/use-sync-status.test.ts` 覆盖 5 个分支。
- 验收：`useSyncStatus(currentMapId).state` 在各分支正确迁移。

---

### P2.0 · Citation 真实性 + Claim 支持度 + U6 三段化（合并）

**目标**：把答案的准确性卡点与视觉呈现一起交付，避免 UI 与后端字段脱节。

#### P2.0.1 精确归一化匹配工具（单次集中导出）

- 文件：`fc-proxy/index.js`
- **重要修正**：所有 module.exports 一次性组装：
  ```js
  // 文件末尾集中定义
  module.exports = {
    handler,   // 原有
    __citationInternal: { normalizeForExactMatch, isVerbatimQuote },
    __ssrfInternal: { isPrivateAddress, assertPublicUrl },   // 顺手补 P0.2 也用同一模式
  };
  ```
  在正文中不要再有 `module.exports.xxx =` 覆盖式写法。若原文件已有多处 `module.exports.xxx = ...`，把它们全部合并到末尾一次。
- `normalizeForExactMatch` / `isVerbatimQuote` 定义同 v2 P2.0.1。
- 测试 `scripts/citation-verify.test.ts`（Vitest 直接 `require` CJS）。

#### P2.0.2 Citation 写入前 verbatim 卡点

（同 v2 P2.0.2：`verifiedIndexes` 增加 `sourceChunks` 参数，逐条筛选 `isVerbatimQuote(cit.quote, chunk.content)`。）

#### P2.0.3 Claim 支持度审计 + U6 三段化前端

- 后端 `citationAudit`（`fc-proxy/index.js:2484-2498`）改为逐条 Claim 判断，返回 `perClaim[]`（内容同 v2 P2.0.3）。
- 前端 **U6 合并进本 PR**：
  - 文件：新建 `src/components/answer/answer-card.tsx`、修改 `src/components/modes/article-parser.tsx`、`src/components/modes/meeting-assistant.tsx`
  - 三段布局：结论 / 证据 / AI 延伸；引用 chip 显示"来源图标 + quote 前 15 字 + …"，hover 300ms 展开完整 quote 与 locator，点击滚动到原文并 3s 高亮。
  - `citationAudit.perClaim[i].supported === false` → 前面加 ⚠ + tooltip"模型未能从原文找到证据"。
  - **本轮不做 PDF 高亮**（拆到 S2.11）；点击 PDF 引用只显示 locator，暂不打开 Viewer。
- 验收：
  - `test:rag` 新增 3 用例（正常、单条 claim 不支持、全篇不支持触发 refusal）。
  - 手工：文章 Q&A 显示三段卡片；chip hover/click 正常；⚠ 出现在正确位置。

#### P2.0.4 翻译分支 usedIds 修复 —— **先出类型报告**

**注意**：v2 假设 `usedSourceIds` 是数字索引，但可能是节点字符串 ID。Codex **必须先在 PR 描述里提交类型报告**，Owner 确认后再写实现。

- 类型报告内容：
  1. 定位 `articleRequest.task === 'translate'` 的所有分支（`fc-proxy/index.js:1439-1441` 附近）。
  2. 打印以下位置的字段类型：
     - `modelResult.usedSourceIds` 的实际形态（跑 test:rag 时 log 一次）
     - `citations[].index` 类型
     - `evidence[].id` 类型
     - `allowedIds` 上下游类型
  3. 结合类型给出 2–3 个修复方案（例如：a) 数字索引白名单 b) 字符串节点 ID 白名单 c) 双通道）。
- Owner 确认后 Codex 再实施。
- 验收：类型报告 PR 单独 review；实施 PR 再 review。

---

### P2.1 · 实体图质量修复（P0，产品定位关键）

**背景**：当前论文解析产出的实体图存在三个严重可见问题：
1. 实体 description 大量为空（前端根据类型硬拼"概念 · "已无意义）。
2. 关系 label 冗长（`${label}${status}· ${n} 证据`），用户看不懂关系本质。
3. 识别精度低（`deterministicEvidenceEntityGraph` 用正则匹配为主；LLM 主路径无 self-verify；`aliases` 通常空导致同名同物无法聚合）。

**证据**：
- `fc-proxy/index.js:2507` `ENTITY_GRAPH_SCHEMA_PROMPT` 中 `"description":""` 是默认空字符串，模型经常直接返回空。
- `src/lib/entity-graph.ts:51` filter 只挡 `citations.length === 0`，**不**挡 `description === ""`——空描述实体照样进图。
- `src/lib/entity-graph.ts:100` 关系 label 拼串太长；用户不知道"depends_on"到底在讲什么。
- `fc-proxy/index.js:2509-2573+` 兜底 `deterministicEvidenceEntityGraph` 用几个中英文正则找"使用/采用/依赖"等词——精度受语料限制。

**目标**：兑现"识别 + 概念解释"的产品承诺；实体没有解释就不是资产。

#### P2.1.1 Prompt 强化 + 硬性字段

- 文件：`fc-proxy/index.js:2507`
- **改动**：把 `ENTITY_GRAPH_SCHEMA_PROMPT` 改为要求：
  ```text
  同时返回 entityGraph：{
    "entities":[{
      "tempId":"E1",
      "name":"规范名称",
      "type":"person|organization|model|method|dataset|metric|task|event|decision|time|concept|claim|other",
      "aliases":["同义词/缩写/英文名"],
      "description":"用一句 30-80 字的解释说明该实体在本文中指什么、有什么关键属性；必须来自原文可推断的信息，不得凭空补充。若原文没有直接说明，输出空字符串——空描述的实体将被丢弃。",
      "descriptionEvidence": [1],   // 支持该描述的 citation 编号数组，至少 1 个
      "citationIndexes":[1],
      "confidence":0.9
    }],
    "relations":[{
      "source":"E1","target":"E2",
      "type":"uses|proposes|evaluated_on|achieves|depends_on|retrieves_from|has_metric|part_of|contains|contradicts|responsible_for|due_on|is|related_to",
      "shortLabel":"3-8 个字的中文动词短语，如'依赖于'、'在...上评测'、'提出'——不要加'· N 证据'等元信息",
      "explanation":"用一句 20-60 字说明这段关系的具体含义，例如'RAG 使用 dense retriever 作为召回入口'。",
      "status":"asserted|historical|negated|proposed",
      "citationIndexes":[1],
      "confidence":0.9
    }]
  }。
  实体最多 24 个、关系最多 36 条。每个实体必须给出 description（除非原文确实无从推断），且必须有直接支持它的 C 编号。
  关系必须有明确方向；没有原文逐字证据的关系不要输出。
  实体名称保留论文/会议中的规范原名，中英文别名放 aliases（至少给出可推断的英文与中文两种写法）。
  ```
- 相应更新 `AIEntityGraphEntity` / `AIEntityGraphRelation` 类型（`src/types/index.ts:51-70`）：
  ```ts
  export interface AIEntityGraphEntity {
    tempId: string;
    name: string;
    type: string;
    aliases?: string[];
    description?: string;
    descriptionEvidence?: number[];   // 新增
    citationIndexes?: number[];
    confidence?: number;
  }
  export interface AIEntityGraphRelation {
    source: string;
    target: string;
    type: string;
    shortLabel?: string;      // 新增，取代原 label
    explanation?: string;     // 新增
    label?: string;           // 向后兼容
    status?: "asserted" | "historical" | "negated" | "proposed";
    citationIndexes?: number[];
    confidence?: number;
  }
  ```

#### P2.1.2 服务端 verbatim 卡点：description + shortLabel

- 文件：`fc-proxy/index.js`（`aiEntityGraphToEntityGraph` 之前的服务端装配处；若前端才装配则见 P2.1.3）
- **规则**：
  1. `description` 与 `descriptionEvidence` 至少一个 citation 必须存在，且该 citation 的 quote 与 description **有共享关键词**（用现有 `tokenize` + 重叠 ≥ 1 token）。不满足则把 description 置空。
  2. `shortLabel` 长度 3–20 字符；超出用 first 20；缺失则用 `type` 的中文映射作 fallback。
  3. `explanation` 长度 ≤ 120 字符；超出截断。
  4. 每条 relation 至少 1 个 citation 的 quote 必须**同时包含** source 与 target 的 canonicalName 或其 alias（用 `normalizeForExactMatch`）——否则丢弃该 relation（识别不准的主要来源就是"两个词在同一段落但无因果"）。

#### P2.1.3 前端 filter：无 description 的实体丢弃

- 文件：`src/lib/entity-graph.ts:43-68`
- 改动：
  ```ts
  const entities: GraphEntity[] = (graph?.entities || []).map(...).filter((entity) =>
    entity.canonicalName
    && entity.citations.length > 0
    && entity.description.trim().length >= 8    // 新增：description 至少 8 字
  );
  ```
- 关系 label 简化（`entity-graph.ts:100`）：
  ```ts
  relationLabel: relation.label,   // 只用 shortLabel 作为主标签
  // 状态标签移到独立字段，或前端渲染时用 chip 显示
  ```
  同时给 `GraphRelation` 加 `explanation?: string`（`src/types/index.ts:35`），用于前端 hover 展开。

#### P2.1.4 实体详情面板 UX（用户可见的核心）

- 文件：新建 `src/components/entity/entity-detail-panel.tsx`；`mind-map-panel.tsx` 与 `universe-view.tsx` 点击实体节点时打开
- 内容（从上到下）：
  1. 实体名（大字）+ 别名 chips
  2. **一句话解释**（`entity.description`，若为空则显示"⚠ 原文未直接说明"）
  3. **证据来源**（`entity.citations`）：每条一行 quote 前 50 字 + locator，可点击回原文
  4. **相关关系**列表：每条显示 `[shortLabel] 目标实体名 · (点击展开 explanation)`
  5. 底部 "在本图定位" 按钮
- 关系 hover：在图上显示 `shortLabel`；点击弹小卡片显示 `explanation` + citation quote。

#### P2.1.5 兜底：`deterministicEvidenceEntityGraph` 不再返回空 description

- 文件：`fc-proxy/index.js:2509+`
- 现在的兜底实体全部 `description: ''`（`2541`）。改为：
  - 若能在 citation.quote 里找到 `<name>(?:是|指|意为|定义为|Full name:).*?[。.\n]` 的短模式，把匹配到的短句作为 description。
  - 找不到则**不生成该实体**（宁可少也不空）。
- 关系兜底同样：正则匹配到关系时必须能同时定位 source/target 的原文位置才生成，且 `shortLabel` 用固定映射表：
  ```js
  const RELATION_SHORT_LABELS = {
    uses: '使用',
    depends_on: '依赖',
    proposes: '提出',
    evaluated_on: '在...上评测',
    achieves: '取得',
    retrieves_from: '从...检索',
    has_metric: '指标',
    part_of: '属于',
    contains: '包含',
    contradicts: '与...相悖',
    responsible_for: '负责',
    due_on: '截止于',
    is: '是',
    related_to: '相关',
  };
  ```

#### P2.1.6 评测：实体图质量固定评测集

- 文件：新建 `docs/entity-quality-benchmark.md`（含 10 篇代表性论文 URL 或短样本）、`scripts/entity-quality-test.js`（Vitest 或 Node 脚本）
- 指标（初始阈值）：
  1. `descriptionCoverage`: 有非空 description 的实体占比 ≥ 80%
  2. `descriptionEvidenceOverlap`: description 与其 citation quote 有 ≥1 关键词重叠的占比 ≥ 90%
  3. `relationCoverage`: shortLabel 长度 3–20 且非默认值的关系占比 ≥ 90%
  4. `relationVerbatimCoverage`: 关系 citation.quote 同时命中 source/target name 的占比 ≥ 85%
- CI 门禁：`npm run test:entity-quality`；先设为 warning，稳定后升级为 fail。

#### P2.1 验收

- `test:rag` 46/46 保持通过。
- 手工：解析一篇论文（Owner 给一个固定 URL），断言 UI 上每个实体都有非空一句话解释；关系上悬停能看到 explanation；识别精度肉眼合理。
- `descriptionCoverage ≥ 80%` 首次运行。

---

### P3.0 · 骨架屏（合并 U3） + `/health` warm

#### P3.0.1 `/health` warm（未登录也预热）

- 文件：新建 `src/lib/warmup.ts`、`src/app/layout.tsx` 或顶层 Provider。
- 30s 冷却；单一 `/health` 请求；**不**在此处预热 workspaces/knowledge。登录后数据由 Sprint 2 的 `/api/bootstrap` 承担。
- 需要在 `src/lib/config.ts` 显式导出 `API_BASE_URL`（若尚未导出）。

#### P3.0.2 骨架屏 + U3 慢加载文案（合并）

- 文件：`src/app/page.tsx`、`src/components/mindmap/mind-map-panel.tsx`、新建 `src/components/mindmap/mind-map-skeleton.tsx`
- 骨架屏：5 圆 + 虚线连线 + `animate-pulse`。
- **合并 U3**：1500ms 后骨架屏下方出现 `"网络较慢，正在唤醒服务…通常需要 3–5 秒"`：
  ```tsx
  const [slowHint, setSlowHint] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlowHint(true), 1500);
    return () => clearTimeout(t);
  }, []);
  ```
- 骨架屏与真实图之间 200ms 淡入。
- 验收：4G throttle 首帧 <100ms；1.5s 后见慢加载文案；正常网络无文案。

---

### U4 · 面包屑

- 文件：新建 `src/components/ui/breadcrumb.tsx`；挂到 header
- 数据源：`useAuth().currentWorkspace.name`、`useMindGrowStore.maps.find(...).name`、`currentMapId`
- 移动端只显示图名
- 图名点击弹当前库下图列表（复用现有侧栏组件或 headless Menu）
- 依赖：P1.1、P1.3
- 验收：切图/切库/切工作区面包屑同步；点图名弹出快速切换。

---

### U7 · 图谱 hover 呼吸感

- 文件：`src/components/universe/universe-view.tsx`（Canvas）、`src/components/mindmap/mind-map-panel.tsx`（React Flow）
- **`universe-view.tsx` 是 Canvas**：在 draw loop 内根据 `hoveredNodeId` 与 `edges` 计算每个节点/边的 `globalAlpha`（1.0 或 0.25），不设 style。
- `mind-map-panel.tsx` 是 React Flow：可用 node/edge 的 `style.opacity`，配 `transition: 'opacity 200ms'`。
- 依赖：P1.1.2、P3.0.2
- 验收：60fps；无 hover 时行为不变。

---

### U9 · 空状态三张模板卡

- 文件：新建 `src/components/empty-state.tsx`；`src/app/page.tsx` 触发
- 触发条件：`maps.length <= 1 && nodes.length === 0 && !modeLibraryBusy`（骨架屏期间不显示，避免误闪）
- 三张卡：个人笔记（预置 3 节点）/ 论文速读（跳文章解析）/ 会议纪要（跳会议助手）
- 依赖：P1.1、P1.3、P3.0.2
- 验收：新账号首次进入见三张卡；老账号不见；骨架屏期间不见。

---

### U10 · 移动端底部 tab bar（**替换现有顶部 tab**）

- **修正**：不新增底部导航，而是**把现有移动端顶部三 tab 移到底部**并加浮起"新建"按钮。
- 文件：新建 `src/components/mobile/bottom-nav.tsx`；`src/app/page.tsx` 移动端渲染分支
- 删掉/隐藏原顶部 tab 组件；`bottom-nav` 内部调 `setCurrentMode(...)`（P1.3 后统一 loader 已就绪）
- 依赖：P1.3、P3.0.2
- 验收：iPhone SE 视口三 tab 常驻底部；旧顶部 tab 不再出现；内容区不被遮挡。

---

### U5 · `Cmd+K` 命令面板

- 文件：新建 `src/components/ui/command-palette.tsx`；全局键盘监听
- 依赖 `cmdk@^1`（可选，~8KB gzip）或自写 modal + input
- 索引来源：仅**当前已加载**的数据（maps、当前 map 的 nodes、当前 map 的实体、最近 chat）。**不宣称能搜索"所有知识库"**（跨 map 需要后端支持，Sprint 2 处理）
- 依赖：P1.1、P1.3、P3.0.1
- 验收：Cmd+K 打开；500 节点搜索 <30ms；键盘导航正常。

---

### U2 · 顶部同步状态灯（依赖 P1.4）

- 文件：新建 `src/components/ui/sync-indicator.tsx`；挂 header
- 数据源：`useSyncStatus(currentMapId)`（P1.4 提供）
- 显示：
  - `idle` → 绿色实心圆 + tooltip "已同步 · HH:mm:ss"
  - `syncing` → 黄色脉冲圆 + tooltip "同步中…"
  - `dirty` → 黄色虚线圆 + tooltip "有本地未提交改动"
  - `offline` → 红色实心圆 + tooltip "离线 · 改动仅保存在本地"
  - `error` → 红色感叹号 + tooltip 显示 error.message（不含密钥/token）
- 依赖：P1.4
- 验收：断网切图变红；恢复变绿；本地拖节点未持久化时虚线黄；写请求失败 5s 内红色感叹号。

---

### U8 · 主题切换（新增亮色主题）

**说明**：当前 UI 已是深色主题（`rgba(9,9,11,0.9)` 等）。本任务是从"仅深色"→"深/浅双主题一键切换 + 记忆用户选择"。

- 文件：`tailwind.config.js`（`darkMode: 'class'` 若未开则开）、`src/app/layout.tsx`（防 FOUC 脚本）、新建 `src/components/ui/theme-toggle.tsx`、CSS 变量文件（若有 `globals.css` 里的 `:root` 变量，加 `.light` 类下的对应值）
- 防 FOUC：`layout.tsx` head 内插一段 blocking 脚本读 localStorage 并给 `<html>` 加 `light` 或 `dark` class。
- Toggle 挂 header 右侧（与 U2 靠近）。
- 逐组件补 `dark:` / `light:` 前缀：优先 header、侧栏、卡片、图谱背景、按钮、输入框。
- 依赖：本轮所有其它 UX 完成后（避免与 U4/U2 同时改 header）。
- 验收：切换无 flash；主要面对比度 AA；刷新后主题记忆。

---

## 3. Sprint 2+（保留粗颗粒）

| # | 任务 |
|---|---|
| S2.1 | `maps.mode` 字段迁移 |
| S2.2 | `/api/bootstrap` 合并首屏（登录后一次拿完 workspaces/maps/defaultMap） |
| S2.3 | CI 事实校验（version / hash / health 断言） |
| S2.4 | Backlinks + 时间轴 |
| S2.5 | 实体图 v1.1（canonical ID + 真实 createdAt） |
| S2.6 | React Flow 可复现 Bug 修复清单（不做泛化重构） |
| S2.7 | Obsidian 扁平图优化（在现有实体网状图上） |
| S2.8 | 白板底座（Heptabase 定位），3–5 周里程碑 |
| S2.9 | 常驻实例开启（等 Owner 授权） |
| S2.10 | 观测：git_sha、部署断言（Sentry 单独确认） |
| **S2.11** | **PDF 内嵌 Viewer + findController 高亮**（从 U6 拆出） |

---

## 4. 每 PR 必答项

1. `/health` 响应结构是否变化？兼容旧字段吗？
2. 数据/存储迁移是否可回滚？（附回滚 SQL 或 revert 路径）
3. 是否新增第三方依赖？license 与体积是否可接受？（附 `du -sh node_modules/<pkg>`）
4. 是否新增对外网络出口？（涉 SSRF 面）
5. 是否改动鉴权路径？（P0 必须 Owner 双人评审）
6. 是否影响 CLAUDE.md / codex-tasks-v3.md 里的 file:line 引用？如影响，本 PR 同步更新。

---

## 5. Codex 开场 prompt

```text
仓库根目录 docs/codex-tasks-v3.md 是完整任务清单。
请先只读通读整个文档，然后从 P0.0.1 开始，按 §1 "合并顺序" 严格顺序执行。
U1 可与 P0.0 并行；U3 合并进 P3.0.2；U6 合并进 P2.0.3；其它 U 按 §1 顺序。
每次一个 PR，标题 [Pk.m.n] 或 [Uk.n]；每个 PR 只能修改任务书列出的文件。
每 PR 跑完 §0 的 6 条命令并附日志；纯前端 PR 可省略 test:backend:local。
禁改 out/、.next/；禁止输出任何 Authorization/SUPABASE_KEY/DASHSCOPE_KEY 值。
Vitest 是本仓库单测框架；test:backend 已拆 :local / :public，CI 门禁只跑 :local。
P2.0.4 翻译分支必须先提交类型报告 PR，Owner 确认后再实施。
遇到任务书未覆盖的分歧点，先在 PR 描述列出选项和建议，等 Owner 确认后再动手。
```

---

## 附录 A · 从 v2 到 v3 的差异清单

| v2 出错点 | v3 修订 |
|---|---|
| Vitest 空测 `passWithNoTests: false` 会 fail | P0.0.1 显式设 true + 加 smoke test |
| P1 hydrate 被拒时仍 `cache.set(...)`，切回来会读到过期数据 | P1.0.1 引入三层快照：writeServerSnapshot 检查 local revision；被拒时不覆盖但允许存 pending，clearLocalOverlay 前不生效 |
| `mutateGraphLocally` 只 bump revision 不同步 cache | P1.0.2 mutate 内 `writeLocalOverlay` 同步写 cache |
| Store 用 spread 手写不可变更新，边界易漏 | 引入 Immer + `produce`，enableMapSet 支持 `collapsedNodes` |
| U2 用 `graphRevisionByMap > 0` 判 dirty，永久黄 | 新增 P1.4：serverRevision vs localRevision 对比；pendingWrites 单独跟踪；网络状态独立 |
| `apiFetch` 用全局 inflight 计数 | P1.4 拆出 write pending / read in-flight，只 pending 触发 syncing |
| `module.exports.__internal = ...` 会被后续整体覆盖 | P2.0.1 集中在文件末尾一次性组装 module.exports |
| P2.0.4 usedSourceIds 类型假设 | 拆两步：先类型报告 PR，Owner 确认后再实施 |
| U1 挂到 `HelpPanel`（问号快捷键面板） | 挂到 `/guide` 页面；test id 用 `version-timeline`（`guide-timeline` 已占用） |
| U1 用 `?raw` 加载 md 需改 next.config.js | 改为 `node:fs` 构建期读取，Server Component 直接调用；不动 webpack |
| U1 parser 未处理 CRLF | v3 parser 先 `.replace(/\r\n/g, "\n")` |
| U1 用 `whitespace-pre-wrap` 显示 md 原文 | 自写行内 renderer 处理 `**bold**` / `[label](url)` / 列表 |
| U6.2 PDF 高亮塞进 UX | 拆到 S2.11 单独立项；U6 本轮只做三段化 + 引用 chip |
| U7 说给 Canvas 节点设 style.opacity | 改为在 draw loop 内按 hovered 计算 globalAlpha |
| U9 触发条件未防骨架屏期误闪 | 加 `&& !modeLibraryBusy` 判断 |
| U10 会叠一层底部导航 | 改为替换现有顶部 tab，避免双导航 |
| U8 "深色模式" 表述错误 | 改名 "主题切换（新增亮色）"，从"仅深色"→"深/浅双主题" |
| 论文实体解析产出 description 空/关系 label 冗长/识别不准（本次 Owner 反馈） | 新增 P2.1：prompt 加硬性 description + descriptionEvidence + shortLabel + explanation；服务端 verbatim 卡点（description 与 quote 有关键词重叠，关系 quote 需同时命中 source 与 target）；前端过滤空 description 实体；新增实体详情面板；兜底路径也必须给 description；新增质量评测集
