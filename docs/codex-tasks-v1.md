# MindGrow · Codex 任务书 v1（Sprint 1 · PR 级）

本文件是给 Codex 执行的完整实现任务清单。Sprint 1 覆盖 T1/T2/T4/T6/T7/T11 共 6 个主任务，已进一步拆到 17 个 PR。Sprint 2+ 见文末汇总（保留主任务颗粒度，Codex 完成 Sprint 1 后再拆分）。

## 0. 全局约定

- 每个 PR 只做一个子任务；PR 标题 `[Txx.y] <简述>`。
- 每 PR 附：变更文件清单、以下命令的日志：
  ```powershell
  npm run lint
  npm run build
  npm run test:rag
  npm run test:e2e:local
  npm run test:backend
  ```
- 涉及 `fc-proxy/index.js` 的 PR 同步更新 `docs/operations-runbook.md`（若与 API 版本或健康字段相关）。
- 禁止修改 `out/`、`.next/`；提交前 `git status` 必须干净。
- 禁止输出/日志任何 `Authorization` 头、`SUPABASE_KEY`、`DASHSCOPE_KEY`、Supabase 服务角色密钥。
- 遇到任务书未覆盖的分歧点，先在 PR 描述里列出选项和建议，等 Owner 确认后再动手。

## 1. 合并顺序（依赖优先）

```
T1.1 → T1.5 → T1.2 → T1.3 → T7.1 → T1.4 → T2.1
   → T11.1 → T11.2 → T11.3
   → T6.1 → T6.2 → T6.3
   → T4.1 → T4.2 → T4.3
   → T1.6
```

## 2. Sprint 1 · PR 级任务

### T1 · 跨租户前端缓存隔离（P0）

**目标**：消除 `universeCache`、`mapGraphCache`、`prefetchedMapKeysRef`、zustand store 在切工作区/登出后残留另一租户数据的可能。

#### T1.1 新增 `src/lib/tenant-cache.ts`

- **文件**：`src/lib/tenant-cache.ts`（新增，约 60 行）
- **导出**：
  ```ts
  export type TenantScope = { userId: string; workspaceId: string };
  export function tenantKey(scope: TenantScope, mapId: string): string;
  export function getMapGraphCache(): Map<string, CachedMapGraph>;
  export function getUniverseCache(): Map<string, { libraries: LibraryGraph[]; storedAt: number }>;
  export function clearAllTenantCache(): void;
  export function subscribeTenantReset(fn: () => void): () => void;
  ```
- **实现要点**：内部两个 `Map<string, ...>`；`tenantKey` 返回 `` `${userId}::${workspaceId}::${mapId}` ``；`clearAllTenantCache()` 调用后遍历订阅者。宇宙聚合 cache 用 `tenantKey(scope, "__aggregate__")`。
- **验收**：新增 `src/lib/__tests__/tenant-cache.test.ts`：
  1. `tenantKey({userId:'u1',workspaceId:'w1'},'m1') === 'u1::w1::m1'`
  2. `clearAllTenantCache()` 后 `getMapGraphCache().size === 0`
  3. 订阅函数在 `clearAllTenantCache()` 后被调用一次
- 依赖：无

#### T1.5 `mindgrow-store` 新增 `resetTenantState`

- **文件**：`src/store/mindgrow-store.ts`（约 15 行）
- **改动位置**：`src/store/mindgrow-store.ts:120-137` 附近
- **新增方法**：
  ```ts
  resetTenantState: () => set({
    nodes: [],
    edges: [],
    entityGraph: { entities: [], relations: [] },
    maps: [],
    categories: [],
    currentMapId: null,
    currentMode: "knowledge",
    chatHistoryByMap: {},
    activeWorkspaceId: null,
  }),
  ```
  同步扩展 `MindGrowStore` 接口类型。
- **验收**：单测调用后各字段被重置。
- 依赖：无

#### T1.2 `page.tsx` 迁移到 `tenant-cache`

- **文件**：`src/app/page.tsx`（约 30 行改动）、必要时 `src/components/auth/auth-provider.tsx`（导出 `session`）
- **改动**：
  1. 删除 `src/app/page.tsx:25-26` 的模块级 `mapGraphCache` 与 `mapGraphCacheKey`。
  2. 引入：
     ```ts
     import { getMapGraphCache, tenantKey, subscribeTenantReset } from "@/lib/tenant-cache";
     ```
  3. 在使用 cache 的所有位置（原 `346, 371, 406-408, 415, 434-436`）改成通过新 API：
     ```ts
     const mapGraphCache = getMapGraphCache();
     const scope = { userId: session?.user?.id ?? "anon", workspaceId: currentWorkspaceId ?? "local" };
     const cacheKey = tenantKey(scope, currentMapId);
     ```
  4. 在 `src/app/page.tsx:76` 附近新增：
     ```ts
     useEffect(() => subscribeTenantReset(() => prefetchedMapKeysRef.current.clear()), []);
     ```
- **验收**：`npm run lint && npm run build && npm run test:e2e:local`；手工切图 3 次仍能命中 cache。
- 依赖：T1.1

#### T1.3 `universe-view.tsx` 迁移到 `tenant-cache`

- **文件**：`src/components/universe/universe-view.tsx`（约 20 行）
- **改动**：
  1. 删除 `src/components/universe/universe-view.tsx:18-19` 的模块级 `universeCache`。
  2. `345-371` 处的 cache 读写替换为 `getUniverseCache().get(tenantKey(scope, "__aggregate__"))` / `.set(...)`。
  3. `scope` 由 `useAuth()` + `currentWorkspace` 组合得到。
- **验收**：同一账号切工作区宇宙内容变化；回到原工作区 60s 内命中。
- 依赖：T1.1

#### T7.1 Universe effect 清理与取消（并入此阶段，因与 T1.3 相邻）

- **文件**：`src/components/universe/universe-view.tsx`（约 30 行）
- **改动**：将 `345-371` 的 effect 改造成：
  ```ts
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const requestId = ++loadRequestRef.current;

    const cache = getUniverseCache();
    const key = tenantKey(scope, "__aggregate__");
    const cached = cache.get(key);
    const fresh = cached && Date.now() - cached.storedAt < UNIVERSE_CACHE_TTL_MS;

    if (fresh) setLibraries(cached.libraries);
    setLoading(!fresh);
    setError("");
    setWarning("");
    if (!fresh) setLibraries([]);
    setHoveredNode(null);
    setOffset({ x: 0, y: 0 });
    setZoom(0.82);

    void fetchUniverseLibraries(controller.signal)
      .then((graphs) => {
        if (cancelled || requestId !== loadRequestRef.current) return;
        cache.set(key, { libraries: graphs, storedAt: Date.now() });
        setLibraries(graphs);
      })
      .catch((reason) => {
        if (cancelled || requestId !== loadRequestRef.current) return;
        if (reason?.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "知识宇宙加载失败");
      })
      .finally(() => {
        if (cancelled || requestId !== loadRequestRef.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadToken, scope.userId, scope.workspaceId]);
  ```
- **同步**：`fetchUniverseLibraries` 签名改为 `(signal?: AbortSignal)`，把 signal 传入 `fetchUniverseJson`。
- **验收**：宇宙加载中立即返回首页 → 控制台无 React 卸载警告；`scripts/e2e-local.js` 打开 `--fail-on-console-error`（若尚未开启则本 PR 顺带加）。
- 依赖：T1.3

#### T1.4 `auth-provider` 触发 `clearAllTenantCache`

- **文件**：`src/components/auth/auth-provider.tsx`（约 15 行）
- **改动**：
  1. `signOut`（`128-131`）：
     ```ts
     await supabase.auth.signOut();
     window.localStorage.removeItem("mindgrow.workspace.v1");
     clearAllTenantCache();
     useMindGrowStore.getState().resetTenantState();
     ```
  2. `onAuthStateChange`（`83-92`）：
     - `SIGNED_OUT` 分支同上。
     - `SIGNED_IN` 分支若 `event.user.id !== previousUserIdRef.current`，同样清空（防同标签换号）。
- **验收**：DevTools Application → localStorage 观察 signOut 后 `mindgrow.workspace.v1` 被删除；单测断言 `mapGraphCache.size === 0` 且 store 归零。
- 依赖：T1.1、T1.5

#### T1.6 E2E · 多租户隔离

- **文件**：`scripts/e2e-multi-tenant.js`（新增，仿 `scripts/e2e-local.js` 或 `scripts/e2e-public.js`）、`package.json`
- **步骤**：
  1. 登录账号 A（`MINDGROW_TEST_ACCOUNT_A_EMAIL/PASSWORD`）。
  2. 打开知识宇宙，收集 map 名列表 `listA`。
  3. `signOut`。
  4. 登录账号 B（`MINDGROW_TEST_ACCOUNT_B_EMAIL/PASSWORD`）。
  5. 立刻打开知识宇宙，收集 `listB`。
  6. 断言 `listA` 与 `listB` 交集为空。
- 若 env 缺失：`console.warn("skip: multi-tenant creds missing")` 并 exit 0。
- **`package.json`**：`"test:e2e:multi-tenant": "node scripts/e2e-multi-tenant.js"`。
- **验收**：`npm run test:e2e:multi-tenant` 在配双账号时通过；无账号时 skip。
- 依赖：T1.2、T1.3、T1.4

---

### T2 · 匿名分支收窄（P0）

#### T2.1

- **文件**：`fc-proxy/index.js`（约 15 行）、`scripts/backend-smoke.js`（约 25 行）、`docs/operations-runbook.md`（约 10 行）
- **改动**：
  1. `fc-proxy/index.js:184` 改为：
     ```js
     async function authenticateUser(req) {
       if (!AUTH_REQUIRED) {
         const allowAnon = process.env.NODE_ENV !== 'production'
                        && process.env.ALLOW_ANON_LOCAL === 'true';
         if (!allowAnon) {
           throw requestError(500, 'MISCONFIGURED', 'Anonymous mode is disabled in production');
         }
         return { id: 'local_test_user', email: 'local@mindgrow.test' };
       }
       // 原有 Supabase 校验逻辑保持不变
     }
     ```
  2. `/health` 响应体（`fc-proxy/index.js:3888` 附近）追加：
     ```js
     authRequired: Boolean(AUTH_REQUIRED),
     nodeEnv: process.env.NODE_ENV || 'unknown',
     allowAnonLocal: process.env.ALLOW_ANON_LOCAL === 'true',
     ```
  3. `scripts/backend-smoke.js` 新增两条断言：
     - 匿名 `GET /api/knowledge?action=maps` → 401。
     - `GET /health` → `body.authRequired === true`。
  4. `docs/operations-runbook.md` 告警章节新增 `authRequired !== true → P0`。
- **验收**：`npm run test:backend` 由 5/5 增至 7/7；生产模式启动匿名请求得 500。
- 依赖：无

---

### T11 · 后端预热 + 骨架屏（性能）

#### T11.1 新增 `src/lib/warmup.ts`

- **文件**：`src/lib/warmup.ts`（新增，约 25 行）
- **实现**：
  ```ts
  import { API_BASE_URL, apiFetch } from "./client-api";

  const WARMUP_TIMEOUT_MS = 5000;
  let warmedAt = 0;

  export function warmupBackend() {
    if (Date.now() - warmedAt < 30_000) return;
    warmedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
    const done = () => clearTimeout(timer);

    void fetch(`${API_BASE_URL}/health`, { signal: controller.signal })
      .catch(() => {}).finally(done);
    void apiFetch("/api/workspaces", { signal: controller.signal }).catch(() => {});
    void apiFetch("/api/knowledge?action=maps", { signal: controller.signal }).catch(() => {});
  }
  ```
- **验收**：`npm run build`；单测 mock fetch 断言三次调用触发。
- 依赖：无

#### T11.2 预热挂到 auth-provider 与 App 顶层

- **文件**：`src/components/auth/auth-provider.tsx`（约 6 行）、`src/app/layout.tsx` 或对应 provider（约 4 行）
- **改动**：
  - App 挂载后 `useEffect(() => warmupBackend(), [])` 打一次 `/health`（未登录也预热函数实例）。
  - `onAuthStateChange('SIGNED_IN')` 与首次 `session` 就绪时调用 `warmupBackend()`。
- **验收**：Network 面板 App 挂载即见 `/health`；登录后立即见 `/api/workspaces` 与 `/api/knowledge?action=maps`。
- 依赖：T11.1

#### T11.3 骨架屏

- **文件**：
  - `src/app/page.tsx`（约 8 行）
  - `src/components/mindmap/mind-map-panel.tsx`（约 10 行）
  - `src/components/mindmap/mind-map-skeleton.tsx`（新增，约 30 行）
- **改动**：
  1. `src/app/page.tsx:353-355` cache miss 分支：
     ```ts
     setNodes([]);
     setEdges([]);
     setEntityGraph({ entities: [], relations: [] });
     setModeLibraryBusy(true);
     ```
  2. `mind-map-panel.tsx` 顶部：
     ```tsx
     const showSkeleton = busy && nodes.length === 0;
     return (
       <div className="relative">
         {showSkeleton && <MindMapSkeleton />}
         <ReactFlow ... style={{ opacity: showSkeleton ? 0 : 1, transition: "opacity 200ms" }} />
       </div>
     );
     ```
  3. `mind-map-skeleton.tsx`：5 个占位圆节点 + `animate-pulse`；无外部依赖。
- **验收**：Chrome throttling 4G，切图第一帧到骨架屏出现 <100ms；骨架到真实图有 200ms 淡入。
- 依赖：无

---

### T6 · 切图竞态与乐观回滚（P1）

#### T6.1 `mindgrow-store` 新增 `localMutationVersion`

- **文件**：`src/store/mindgrow-store.ts`（约 15 行）
- **改动**：
  ```ts
  localMutationVersion: 0,
  bumpLocalMutation: () => set(s => ({ localMutationVersion: s.localMutationVersion + 1 })),
  ```
  在**外部调用点**（用户交互路径的 `setNodes/setEdges/setEntityGraph` 之前）调用 `bumpLocalMutation()`；服务端回填路径不 bump。
- **验收**：单测 `bumpLocalMutation()` 后 version+1。
- 依赖：无

#### T6.2 `page.tsx` cache 写入受 guard + local mutation 保护

- **文件**：`src/app/page.tsx`（约 25 行）
- **改动**（三处）：
  1. 请求发起前：`const startVersion = useMindGrowStore.getState().localMutationVersion;`
  2. 把 `mapGraphCache.set(cacheKey, graph)`（原 `371`）移到 `if (requestId !== ...) return;` 与 `if (latest.currentMapId !== ...) return;` 两次 guard 通过之后。
  3. 写 store 前再判 `localMutationVersion`：
     ```ts
     const latest = useMindGrowStore.getState();
     if (latest.currentMapId !== currentMapId || latest.currentMode !== requestedMode) return;
     if (latest.localMutationVersion !== startVersion) {
       mapGraphCache.set(cacheKey, graph);   // 仅更新 cache，不覆盖 store
       return;
     }
     mapGraphCache.set(cacheKey, graph);
     setNodes(graph.nodes);
     setEdges(graph.edges);
     setEntityGraph(graph.entityGraph);
     ```
  4. `page.tsx:392` 依赖数组：把 `maps` 换成 `mapsSignature`：
     ```ts
     const mapsSignature = useMemo(() => maps.map(m => m.id).join(","), [maps]);
     // 依赖数组用 mapsSignature 替换 maps
     ```
- **验收**：
  - A. 切图 A→B 途中切回 A：最终画面是 A 且 cache B 有值。
  - B. 切到 A，本地拖动节点，等 revalidation 返回：节点位置保留。
- 依赖：T6.1、T1.2

#### T6.3 移动端分支同步保护

- **文件**：`src/app/page.tsx`（约 20 行）
- **改动**：`src/app/page.tsx:857-871` 移动端模板流的 `apiFetch` 加 `AbortController` 与 `mapLoadRequestRef` 校验，逻辑与桌面端一致；同样引入 `localMutationVersion` 保护。
- **验收**：`test:e2e:local` 增加 `isMobile=true` 用例（切图不闪、不覆盖本地编辑）。
- 依赖：T6.2

---

### T4 · Citation 逐字校验（P1）

#### T4.1 工具函数

- **文件**：`fc-proxy/index.js`（约 30 行）、新增 `scripts/citation-verify.test.js`（约 40 行）
- **改动**：在 `fc-proxy/index.js` 现有工具区新增：
  ```js
  function normalizeForMatch(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s　]+/g, ' ')
      .replace(/[、。，．；：！？""''（）()\[\]{}<>《》「」『』,.;:!?"'`~]+/g, '')
      .trim();
  }
  function verifyQuoteInSource(quote, sourceText) {
    const q = normalizeForMatch(quote);
    const s = normalizeForMatch(sourceText);
    if (!q || !s) return false;
    if (s.includes(q)) return true;
    if (q.length < 8) return false;
    const grams = (str) => {
      const set = new Set();
      for (let i = 0; i + 4 <= str.length; i++) set.add(str.slice(i, i + 4));
      return set;
    };
    const gq = grams(q), gs = grams(s);
    let inter = 0;
    gq.forEach(g => { if (gs.has(g)) inter++; });
    return inter / gq.size >= 0.85;
  }
  module.exports.__internal = Object.assign(module.exports.__internal || {}, { normalizeForMatch, verifyQuoteInSource });
  ```
- **验收**：`scripts/citation-verify.test.js` 6 正 + 4 反用例全通过。
- 依赖：无

#### T4.2 `bestCitationIndexes` 引入 verbatim 卡点

- **文件**：`fc-proxy/index.js`（约 25 行）
- **改动**：`fc-proxy/index.js:2367-2381` 加 verbatim 过滤；`sources` 需从调用方传入（找到全部调用点，估计 3–5 处，逐个补 `sources` 参数）。
  ```js
  function bestCitationIndexes(claim, citations, sources) {
    return citations
      .map((c, i) => ({ i, c }))
      .filter(({ c }) => {
        const src = sources.find(s => s.id === c.sourceId)?.text || '';
        return verifyQuoteInSource(c.quote, src);
      })
      // ...原 token overlap 打分
  }
  ```
- **验收**：`npm run test:rag` 46/46 保持通过；新增用例：注入 quote 与源文不匹配 → citation 被丢弃。
- 依赖：T4.1

#### T4.3 `citationAudit` 降级 & refusal

- **文件**：`fc-proxy/index.js`（约 25 行）、`src/components/modes/article-parser.tsx`（约 8 行）、`src/components/modes/meeting-assistant.tsx`（约 8 行）
- **改动**：
  1. `fc-proxy/index.js:2484-2498`：
     ```js
     function citationAudit(claims, citations, sources) {
       // ...原
       const verbatim = citations.filter(c => {
         const src = sources.find(s => s.id === c.sourceId)?.text || '';
         return verifyQuoteInSource(c.quote, src);
       }).length;
       const verbatimRatio = citations.length ? verbatim / citations.length : 0;
       const shouldRefuse = rows.length >= 3 && verbatimRatio < 0.6;
       return {
         claimCount: rows.length,
         citedClaimCount: cited.length,
         coverage: rows.length ? Number((cited.length / rows.length).toFixed(3)) : 1,
         verifiedQuoteCount: verifiedQuotes,
         verbatimVerifiedCount: verbatim,
         verbatimRatio: Number(verbatimRatio.toFixed(3)),
         shouldRefuse,
         warnings,
       };
     }
     ```
  2. answer 组装处（`fc-proxy/index.js:1424-1457`）：
     ```js
     if (audit.shouldRefuse) {
       return { ...baseAnswer, answer: null, refusalReason: 'INSUFFICIENT_VERBATIM_EVIDENCE', citationAudit: audit };
     }
     ```
  3. 前端显示 `refusalReason === 'INSUFFICIENT_VERBATIM_EVIDENCE'` 时用友好文案："模型未能从原文找到足够逐字证据，请补充材料或换个问法。"
- **验收**：`npm run test:rag` 新增 2 组用例：正常问答不降级、错配 quote 触发降级。
- 依赖：T4.2

---

## 3. Sprint 2+ 主任务保留（Codex 完成 Sprint 1 后再拆分）

- **T3** SSRF DNS 重绑定加固 · `fc-proxy/index.js:1648-1745`
- **T5** 翻译分支 usedIds 破例修正 · `fc-proxy/index.js:1439-1441`
- **T8** maps.mode 列迁移 · `fc-proxy/index.js`、`src/lib/mode-libraries.ts`、`modes/*`
- **T9** 会议"确认后落库" · `meeting-assistant.tsx`、后端会议接口
- **T10** 实体 canonical id + 真实 createdAt · `src/lib/entity-graph.ts`
- **T12** SWR / react-query 化 · `src/app/page.tsx`、`universe-view.tsx`、`client-api.ts`
- **T13** `/api/bootstrap` 首屏合并 · `fc-proxy/index.js`、`auth-provider`
- **T14** React Flow / 实体图渲染稳定化
- **T15** 常驻实例开启（等 Owner 授权）
- **T16** Heptabase 白板底座（1–2 周单独里程碑）
- **T17** mem 式 Backlinks + 时间轴
- **T18** Obsidian 式扁平图谱视图
- **T19** CI 事实校验（防 CLAUDE.md 漂移）
- **T20** 观测：`/health` git_sha、Sentry、部署断言

## 4. 每 PR 必答项

1. 变更是否影响 `/health` 响应结构兼容性？
2. 数据迁移是否可回滚？（如涉及，附回滚 SQL）
3. 是否引入新的第三方依赖？license 是否兼容？
4. 是否新增对外网络出口？（关系到 SSRF 面）
5. 是否修改鉴权路径？（P0 必须 Owner 双人评审）

## 5. Codex 开场 prompt 模板

```text
仓库根目录 docs/codex-tasks-v1.md 是完整任务清单。
请先只读通读整个文档，然后从 T1.1 开始，按 §1 "合并顺序" 严格顺序执行。
每次开一个 PR，PR 标题 [Txx.y] <简述>；每个 PR 只能修改任务书列出的文件，其它文件保持不变。
每 PR 跑完 §0 的 5 条命令并把日志附到 PR 描述里。
遇到任务书未覆盖的分歧点，先在 PR 描述列出选项和你的建议，等 Owner 确认后再动手。
禁止修改 out/、.next/；禁止输出任何 Authorization/SUPABASE_KEY/DASHSCOPE_KEY 值。
```
