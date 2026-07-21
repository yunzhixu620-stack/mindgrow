# MindGrow · Codex 任务书 v2

**v2 相对 v1 的关键修订**（见 §附录 A"从 v1 到 v2 的差异清单"）：

1. 新增 P0.0 测试基础设施（Vitest + `test:backend` 拆分为 `:local` / `:public` + runbook 版本修正）。
2. 完全重写租户状态清理（v1 的字段名与类型均错），并抽取 `resetTenantContext()` 幂等函数。
3. 用 `nextSession` 判断登录/换号；`signOut` 与 `SIGNED_OUT` 各走一次幂等清理，不重复。
4. Store 用 `hydrateGraphFromServer` / `mutateGraphLocally` 双通道，废弃 v1 的全局 `localMutationVersion` + 手工 bump。
5. 后端预热收敛为"未登录只 warm `/health`；登录数据由 `/api/bootstrap` 一次拿完"，废弃 v1 的三接口散射预热。
6. Citation 审计改名为"Citation 来源真实性 + Claim 支持度审计"：Citation 与 `documentChunks.content` 精确归一化匹配（**不使用** n-gram/阈值）；Claim 支持度逐条判断，不用 `verbatimRatio` 掩盖单条错误。
7. **SSRF 前置到 Sprint 1**（P0.2）：解析后固定已验证 IPv4；重定向逐跳重新校验。
8. **runbook 版本漂移** 前置修复：`10.2.9` → 由 CI 从 `API_VERSION` 常量注入。
9. 移动端不再自建 loader，删除后统一走桌面路径。
10. 双账号 E2E 缺 env 时 exit 0 并标 `skipped`，不算发布通过。

## 0. 全局约定

- 每 PR 一个子任务，标题 `[Pk.m.n] <简述>`（k=阶段，m=大任务，n=子 PR）。
- 每 PR 必跑并附日志：
  ```powershell
  npm run lint
  npm run build
  npm run test:unit          # P0.0 起
  npm run test:rag
  npm run test:e2e:local
  npm run test:backend:local # P0.0 起；纯前端 PR 可省略
  ```
- 严禁修改 `out/`、`.next/`；提交前 `git status` 干净。
- 严禁输出/日志任何 `Authorization` 头、`SUPABASE_KEY`、`DASHSCOPE_KEY`。
- 任何未覆盖的分歧，先在 PR 描述里列选项与建议，等 Owner 确认。

## 1. 9 步 PR 顺序（依赖已排好）

```
P0.0 测试基础设施 + runbook 修正
P0.1 鉴权 fail-closed + /health 配置断言
P0.2 SSRF：固定已验证 IP + 逐跳重校
P1.0 租户缓存底座 + Store 双通道 + 完整 resetTenantContext
P1.1 page / Universe 缓存迁移 + 取消请求 + 切工作区清屏
P1.2 双账号隔离 E2E
P1.3 桌面/移动端统一 loader（删除移动端第二套加载器）
P2.0 Citation 来源真实性 + Claim 支持度审计 + 翻译 usedIds 修复
P3.0 骨架屏与加载/错误态
```

之后进入 Sprint 2（保留粗颗粒度）：`maps.mode` → `/api/bootstrap` → CI/部署断言 → Backlinks/时间轴 → 实体图优化 → 白板底座。

---

## 2. Sprint 1 · PR 级任务

### P0.0 · 测试基础设施 + runbook 修正

**目标**：让 `test:unit` 真正跑；`test:backend` 不再对着生产假通过；`runbook` 版本与 `API_VERSION` 单一真源。

#### P0.0.1 引入 Vitest

- **改动文件**：`package.json`、新增 `vitest.config.ts`
- **依赖**：`npm i -D vitest@^2 @vitest/coverage-v8@^2`
- **`package.json` scripts** 新增：
  ```json
  "test:unit": "vitest run --reporter=default",
  "test:unit:watch": "vitest"
  ```
- **`vitest.config.ts`**：
  ```ts
  import { defineConfig } from "vitest/config";
  import path from "node:path";
  export default defineConfig({
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      globals: false,
    },
  });
  ```
- **`.gitignore`** 追加：`coverage/`。
- **验收**：`npm run test:unit` 运行成功（此时无用例，输出 "No test files"），退出码 0。

#### P0.0.2 拆分 `test:backend` 为 `:local` / `:public`

- **改动文件**：`package.json`、`scripts/backend-smoke.js`
- **改动**：
  - `scripts/backend-smoke.js` 内 base URL 改成读环境变量：
    ```js
    const BASE = process.env.MINDGROW_API_BASE || "https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run";
    ```
  - `package.json` scripts：
    ```json
    "test:backend:local": "cross-env MINDGROW_API_BASE=http://127.0.0.1:9000 node scripts/backend-smoke.js",
    "test:backend:public": "node scripts/backend-smoke.js",
    "test:backend": "npm run test:backend:public"
    ```
    保留 `test:backend` 作为老兼容命令，但 CI 门禁与 PR 走 `:local`。
  - 新增 devDep `cross-env`：`npm i -D cross-env`。
  - 新增 `scripts/run-backend-local.js`：启动 `node fc-proxy/index.js`，健康 200 后打印 "ready"；供 CI 或本地 `& npm run test:backend:local` 使用。
- **验收**：本地 `node fc-proxy/index.js` 起后 `npm run test:backend:local` 通过；`npm run test:backend:public` 依然指向生产。

#### P0.0.3 修 runbook 版本漂移

- **改动文件**：`docs/operations-runbook.md`、`fc-proxy/index.js`
- **改动**：
  1. `docs/operations-runbook.md:24` 的 `version=10.2.9` 改为动态：
     ```
     每 5 分钟：`GET /health`，要求 HTTP 200、`version` 与 `docs/api-version.txt`（由 CI 从 `fc-proxy/index.js` 的 `API_VERSION` 常量注入）一致
     ```
  2. 新增 `docs/api-version.txt`（一行内容 `10.5.2`）。
  3. `fc-proxy/index.js` 的 `API_VERSION` 常量作为唯一真源，未来变更同步该文件。
  4. 新增 `scripts/check-api-version.js`：读 `fc-proxy/index.js` 中 `API_VERSION = 'x.y.z'` 与 `docs/api-version.txt` 比对，不一致 exit 1。
  5. `package.json` scripts 加 `"check:api-version": "node scripts/check-api-version.js"`；在 `lint` 前依赖：不改 `lint` 语义，Codex 每 PR 独立跑 `npm run check:api-version`。
- **验收**：`npm run check:api-version` 0 退出；把 `api-version.txt` 改错测一次 exit 1 后还原。

---

### P0.1 · 鉴权 fail-closed + /health 配置断言（v1 的 T2 修订）

**目标**：生产禁用匿名回退；`/health` 暴露关键开关，让监控能一眼验证。

- **改动文件**：`fc-proxy/index.js`、`scripts/backend-smoke.js`、`docs/operations-runbook.md`
- **改动**：
  1. `fc-proxy/index.js:184` `authenticateUser` 首行改为：
     ```js
     if (!AUTH_REQUIRED) {
       const allowAnon = process.env.NODE_ENV !== 'production'
                      && process.env.ALLOW_ANON_LOCAL === 'true';
       if (!allowAnon) {
         throw requestError(500, 'MISCONFIGURED', 'Anonymous mode is disabled');
       }
       return { id: 'local_test_user', email: 'local@mindgrow.test' };
     }
     ```
  2. `/health` 响应体（`fc-proxy/index.js:3888` 附近）追加：
     ```js
     authRequired: Boolean(AUTH_REQUIRED),
     nodeEnv: process.env.NODE_ENV || 'unknown',
     allowAnonLocal: process.env.ALLOW_ANON_LOCAL === 'true',
     ```
     字段位置放在现有 `version`、`knowledgeStore` 之后。
  3. `scripts/backend-smoke.js` 增两条：匿名 `GET /api/knowledge?action=maps` → 401；`/health.authRequired === true`。
  4. `docs/operations-runbook.md` §3 加告警：`authRequired !== true` 视为 SEV0。
- **验收**：`test:backend:local` 从 5 增至 7；生产模式启动匿名请求 500。
- 依赖：P0.0.2（`test:backend:local` 存在）

---

### P0.2 · SSRF：固定已验证 IP + 逐跳重校（v1 T3 前置）

**目标**：关闭 `assertPublicUrl` → `fetchArticleText` 之间的 DNS TOCTOU 窗口。

- **改动文件**：`fc-proxy/index.js`（`1648-1745`）、`scripts/ssrf-cases.test.js`（新增）、`package.json`（新增 `ipaddr.js` 依赖）
- **依赖**：`npm i ipaddr.js@^2`
- **改动**：
  1. 重写 `isPrivateAddress` 用 `ipaddr.js`：
     ```js
     const ipaddr = require('ipaddr.js');
     function isPrivateAddress(address) {
       if (!address) return true;
       try {
         let addr = ipaddr.parse(address);
         if (addr.kind() === 'ipv6') {
           if (addr.isIPv4MappedAddress()) addr = addr.toIPv4Address();
         }
         if (addr.kind() === 'ipv4') {
           const range = addr.range();
           return ['private','loopback','linkLocal','carrierGradeNat','reserved','broadcast','multicast','unspecified'].includes(range);
         }
         const range6 = addr.range();
         return ['loopback','linkLocal','uniqueLocal','multicast','reserved','unspecified','ipv4Mapped','rfc6145','rfc6052','6to4','teredo'].includes(range6);
       } catch { return true; }
     }
     ```
  2. `assertPublicUrl` 返回 `{ parsed, resolvedAddresses }`：过滤后仅保留公网 IPv4；无公网记录抛 400。
  3. `fetchArticleText` 用返回的第一个 IPv4 直连：
     ```js
     const { parsed, resolvedAddresses } = await assertPublicUrl(targetUrl);
     const chosenIp = resolvedAddresses[0];
     const request = transport.request({
       host: chosenIp,
       port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
       path: `${parsed.pathname}${parsed.search}`,
       method: 'GET',
       servername: parsed.hostname,           // 保留 HTTPS SNI/证书校验
       headers: { Host: parsed.host, /* 其它现有 headers */ },
     }, ...);
     ```
  4. Redirect 分支：`const next = new URL(response.headers.location, parsed).toString();` 后直接递归调用 `fetchArticleText(next, redirects+1)`，即"每跳重新走 `assertPublicUrl`"。
  5. 新增 `scripts/ssrf-cases.test.js`（Vitest 或 node 独立脚本；建议 Vitest）：
     - 20+ 边界地址（`::ffff:127.0.0.1`、`2002:7f00:1::`、`64:ff9b::7f00:1`、`169.254.169.254`、`100.64.0.1`、`198.18.0.1`、`192.0.2.1` 等）逐个断言 `isPrivateAddress === true`。
     - 至少 3 个公网 IPv4/IPv6（如 `1.1.1.1`、`8.8.8.8`、`2606:4700:4700::1111`）断言 `false`。
- **验收**：`npm run test:unit` 全部通过；`test:rag` 46/46 保持。
- 依赖：P0.0.1

---

### P1.0 · 租户缓存底座 + Store 双通道 + 完整 resetTenantContext

**目标**：一次性把租户隔离所需的三块底座建好，后续迁移只是替换调用点。

#### P1.0.1 新增 `src/lib/tenant-cache.ts`

- **改动文件**：新建 `src/lib/tenant-cache.ts`（约 70 行）、新建 `src/lib/__tests__/tenant-cache.test.ts`
- **导出**：
  ```ts
  export type TenantScope = { userId: string; workspaceId: string };
  export interface CachedMapGraph { nodes: unknown[]; edges: unknown[]; entityGraph: unknown; storedAt: number; }
  export interface CachedUniverse { libraries: unknown[]; storedAt: number; }
  export function tenantKey(scope: TenantScope, mapId: string): string;
  export function getMapGraphCache(): Map<string, CachedMapGraph>;
  export function getUniverseCache(): Map<string, CachedUniverse>;
  export function clearAllTenantCache(): void;
  export function subscribeTenantReset(fn: () => void): () => void;
  ```
- **实现要点**：模块级两个 Map + 订阅者数组；`clearAllTenantCache()` 幂等，先 `map.clear()` 再遍历订阅。`tenantKey` 用 `${userId}::${workspaceId}::${mapId}`。`unknown[]` 类型只作签名，调用点用真实类型 assert。
- **测试**（Vitest）：
  1. `tenantKey({userId:'u1',workspaceId:'w1'},'m1') === 'u1::w1::m1'`
  2. 写入 → `clearAllTenantCache()` → `size === 0`
  3. 订阅 → clear → callback 触发 1 次；unsubscribe 后再 clear 不触发
- 依赖：P0.0.1

#### P1.0.2 Store 引入双通道 + `resetTenantContext`

- **改动文件**：`src/store/mindgrow-store.ts`
- **新增字段**（在 `MindGrowState` 接口末尾添加）：
  ```ts
  // graph hydration channel
  graphRevisionByMap: Record<string, number>;
  hydrateGraphFromServer: (mapId: string, payload: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; entityGraph: EntityGraph }, expectedRevision: number) => boolean;
  mutateGraphLocally: (mapId: string, mutator: (draft: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; entityGraph: EntityGraph }) => void) => void;
  getGraphRevision: (mapId: string) => number;
  // tenant reset
  resetTenantContext: () => void;
  ```
- **实现要点**：
  1. `graphRevisionByMap` 默认 `{}`。
  2. `getGraphRevision(mapId)` 返回 `graphRevisionByMap[mapId] ?? 0`。
  3. `mutateGraphLocally(mapId, mutator)`：仅当 `currentMapId === mapId` 才生效；用 `mutator` 生成新 nodes/edges/entityGraph 后 `set`，并 `graphRevisionByMap[mapId] = current + 1`。
  4. `hydrateGraphFromServer(mapId, payload, expectedRevision)`：返回 boolean：
     - 若 `currentMapId !== mapId`：返回 false（切走了，别覆盖）。
     - 若 `graphRevisionByMap[mapId] ?? 0` !== `expectedRevision`：返回 false（有本地修改，别覆盖）；仍允许调用方把 payload 写进 cache 供下次使用。
     - 否则写入 nodes/edges/entityGraph，返回 true。
  5. `resetTenantContext()` 幂等且完整清理：
     ```ts
     resetTenantContext: () => set({
       currentMapId: "map_default",
       nodes: [],
       edges: [],
       entityGraph: { entities: [], relations: [] },
       maps: [],
       categories: [],
       history: [],
       historyIndex: -1,
       messages: [],
       chatHistory: {},
       messageMapId: null,
       isProcessing: false,
       pendingSuggestion: null,
       pendingMindMap: null,
       pendingPlacement: null,
       searchQuery: "",
       searchResults: [],
       editingNodeId: null,
       contextMenu: null,
       highlightedNodeId: null,
       collapsedNodes: new Set<string>(),
       graphRevisionByMap: {},
       currentMode: "knowledge",
     }),
     ```
     不重置 `sidebarOpen / layoutDirection / showHelp`（UI 偏好非租户数据）。
- **测试** `src/store/__tests__/mindgrow-store.test.ts`：
  1. `mutateGraphLocally` 后 `getGraphRevision` +1；再 `hydrateGraphFromServer(mapId, payload, 0)` 返回 false，nodes 不被覆盖。
  2. `hydrateGraphFromServer(mapId, payload, currentRevision)` 返回 true，nodes 被覆盖。
  3. `resetTenantContext()` 后所有租户字段归零；再次调用不 throw、结果一致。
- 依赖：P0.0.1

#### P1.0.3 `auth-provider` 触发 `resetTenantContext` + `clearAllTenantCache`

- **改动文件**：`src/components/auth/auth-provider.tsx`
- **关键点**：`onAuthStateChange((event, nextSession) => ...)` 中已用 `nextSession`；不要引入 `event.user.id`。
- **改动**：
  1. 顶部 import：
     ```ts
     import { clearAllTenantCache } from "@/lib/tenant-cache";
     import { useMindGrowStore } from "@/store/mindgrow-store";
     ```
  2. 顶部加 ref：`const lastUserIdRef = useRef<string | null>(null);`
  3. 抽出幂等函数：
     ```ts
     const resetTenant = useCallback(() => {
       clearAllTenantCache();
       useMindGrowStore.getState().resetTenantContext();
       window.localStorage.removeItem("mindgrow.workspace.v1");
       setActiveWorkspaceId(null);
       setWorkspaces([]);
       setCurrentWorkspace(null);
     }, []);
     ```
  4. `signOut`：
     ```ts
     const signOut = useCallback(async () => {
       await supabase.auth.signOut();
       resetTenant();
       lastUserIdRef.current = null;
     }, [resetTenant]);
     ```
  5. `onAuthStateChange` 分支：
     ```ts
     const nextUserId = nextSession?.user.id ?? null;
     if (!nextSession) {
       if (lastUserIdRef.current !== null) resetTenant();
       lastUserIdRef.current = null;
     } else {
       if (lastUserIdRef.current && lastUserIdRef.current !== nextUserId) {
         resetTenant();          // 同标签换号
       }
       lastUserIdRef.current = nextUserId;
       window.setTimeout(() => void refreshWorkspaces().catch(...));
     }
     ```
- **验收**：Chrome DevTools 观察 `signOut` 后 `mindgrow.workspace.v1` 已删；Zustand devtools 或 `window.__DEBUG_STORE__` 观察 store 完成 reset。手工登录 A → signOut → 登录 B，控制台无 stale 数据日志。
- 依赖：P1.0.1、P1.0.2

---

### P1.1 · page / Universe 缓存迁移 + 取消请求 + 切工作区清屏

**目标**：把 v1 里散在 `page.tsx` 三个 effect 与 `universe-view.tsx` 一个 effect 里的模块级 Map、AbortController、guard 全部迁移到 P1.0 底座之上，并修复过期响应污染 cache 的 bug。

#### P1.1.1 `page.tsx` 迁移 + 竞态保护

- **改动文件**：`src/app/page.tsx`
- **改动**：
  1. 顶部 import 补：
     ```ts
     import { getMapGraphCache, tenantKey, subscribeTenantReset } from "@/lib/tenant-cache";
     ```
  2. 删除 `src/app/page.tsx:25-26` 的模块级 `mapGraphCache` / `mapGraphCacheKey`。
  3. 从 `useAuth()` 拿 `user`；组件内：
     ```ts
     const scope = useMemo(
       () => ({ userId: user?.id ?? "anon", workspaceId: currentWorkspaceId ?? "local" }),
       [user?.id, currentWorkspaceId]
     );
     ```
  4. 主 load effect（原 `340-392`）改造要点：
     - 记录 `const expectedRevision = useMindGrowStore.getState().getGraphRevision(currentMapId);`
     - `cacheKey = tenantKey(scope, currentMapId);`
     - `cache = getMapGraphCache();`
     - 响应回来后 **guards 全部通过再写 cache**：
       ```ts
       if (requestId !== mapLoadRequestRef.current) return;
       const latest = useMindGrowStore.getState();
       if (latest.currentMapId !== currentMapId || latest.currentMode !== requestedMode) return;
       cache.set(cacheKey, graph);
       const applied = useMindGrowStore
         .getState()
         .hydrateGraphFromServer(currentMapId, {
           nodes: graph.nodes,
           edges: graph.edges,
           entityGraph: graph.entityGraph,
         }, expectedRevision);
       if (!applied) setModeLibraryBusy(false);   // 本地已改，别覆盖
       ```
     - 依赖数组把 `maps` 换成 `mapsSignature`：
       ```ts
       const mapsSignature = useMemo(() => maps.map(m => m.id).join(","), [maps]);
       ```
       effect 依赖 `[currentMapId, currentMode, scope.userId, scope.workspaceId, mapsSignature, mapCatalogReady, loadChatHistory]`。
  5. 原"本地编辑同步到 cache" effect（`430-437`）删除——由 `mutateGraphLocally` 一次性维护 revision 已足够；避免与 `hydrateGraphFromServer` 双写竞争。
  6. Prefetch effect（`396-426`）内所有 `mapGraphCache.set` 加 revision 判断：只在 `cache.get(cacheKey) === undefined` 才写入。
  7. `useEffect(() => subscribeTenantReset(() => prefetchedMapKeysRef.current.clear()), []);`
- **验收**：
  - 单测新增 `src/app/__tests__/page-race.test.tsx`（用 `@testing-library/react` 或纯 render；若引入 RTL，注意 devDep 追加）：模拟连续两次切图第二次先返回，断言 cache 只包含第二次结果；模拟本地 `mutateGraphLocally` 后 revalidation 返回，断言 nodes 不被覆盖。
  - 手工：连切 5 张图，无闪回；本地拖节点期间 revalidation 不覆盖。
- 依赖：P1.0.1、P1.0.2、P1.0.3

#### P1.1.2 `universe-view.tsx` 迁移 + effect 清理

- **改动文件**：`src/components/universe/universe-view.tsx`
- **改动**：
  1. 删除 `src/components/universe/universe-view.tsx:18-19` 的模块级 `universeCache`。
  2. 新 effect（原 `345-371`）：
     ```ts
     useEffect(() => {
       let cancelled = false;
       const controller = new AbortController();
       const requestId = ++loadRequestRef.current;
       const scope = { userId: user?.id ?? "anon", workspaceId: currentWorkspace?.id ?? "local" };
       const cache = getUniverseCache();
       const key = tenantKey(scope, "__aggregate__");
       const cached = cache.get(key);
       const fresh = cached && Date.now() - cached.storedAt < UNIVERSE_CACHE_TTL_MS;
       if (fresh) setLibraries(cached.libraries as LibraryGraph[]);
       setLoading(!fresh);
       setError("");
       setWarning("");
       if (!fresh) setLibraries([]);
       setHoveredNode(null);
       setOffset({ x: 0, y: 0 });
       setZoom(0.82);
       fetchUniverseLibraries(controller.signal)
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
       return () => { cancelled = true; controller.abort(); };
     }, [reloadToken, user?.id, currentWorkspace?.id]);
     ```
  3. `fetchUniverseLibraries` 签名改 `(signal?: AbortSignal)`；`fetchUniverseJson` 的 `AbortController` 与父 signal 组合：父 abort 时子也 abort（一个 helper `linkAbortSignals(parent, child)`）。
  4. `useAuth()` 取 `user, currentWorkspace`；把 scope 作为依赖以便切工作区自动重载。
- **验收**：
  - 宇宙加载中立刻导航离开 → 无 React 卸载警告。
  - `scripts/e2e-local.js` 增加检测：若 puppeteer 页面在 5s 内出现 `Warning: Can't perform a React state update on an unmounted` 字样，测试 fail。
- 依赖：P1.0.1

---

### P1.2 · 双账号隔离 E2E

- **改动文件**：新建 `scripts/e2e-multi-tenant.js`、`package.json`
- **策略**：
  1. 用 puppeteer（已在 devDependencies）复用 `scripts/e2e-local.js` 的启动 pattern，但目标网址是 `NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"`。
  2. env：`MINDGROW_TEST_A_EMAIL/PASSWORD`、`MINDGROW_TEST_B_EMAIL/PASSWORD`、`MINDGROW_TEST_APP_URL`。任一缺失 → `console.warn("skip: multi-tenant creds missing"); process.exit(0);` **并且**在退出前打印 `TEST_SKIPPED=true`，供 CI 分类。
  3. 步骤：
     - 登录 A → 打开知识宇宙 → 截图 + 收集所有 map name 到 `listA`。
     - 点侧栏"退出登录" → 等待跳到登录页。
     - 登录 B → 立即打开知识宇宙 → 收集 `listB`。
     - `assert(intersection(listA, listB).length === 0)`。
     - 断言 `window.localStorage.getItem("mindgrow.workspace.v1")` 不是 A 的 id。
  4. `package.json`：
     ```json
     "test:e2e:multi-tenant": "node scripts/e2e-multi-tenant.js"
     ```
- **验收**：本地手工跑通；CI 无 env 时 skip 且退出 0。
- 依赖：P1.0.3、P1.1.1、P1.1.2

---

### P1.3 · 桌面/移动端统一 loader

**目标**：`src/app/page.tsx:857-871` 移动端模板流的 `apiFetch` 缺 signal、无 request-id 保护、复制了另一套加载逻辑——删掉，改成移动端和桌面走同一个 loader（P1.1.1 的 effect）。

- **改动文件**：`src/app/page.tsx`
- **改动**：
  1. 定位 `857-871` 的 mobile 模板流分支；把里面的 `apiFetch(\`/api/knowledge?mapId=${map.id}\`)` 逐字复制掉，改为触发一次 `setCurrentMapId(map.id)`——让 P1.1.1 的主 effect 负责加载。
  2. 若移动端确实需要额外行为（如切完自动关抽屉），把这些副作用在 `handleSwitchMap` 内部统一处理。
  3. 若移动端有独有的 UX（例如切完显示 toast），保留 UX，但数据加载走主 loader。
  4. 若 `handleSwitchMap` 不存在，新建一个 helper：
     ```ts
     const handleSwitchMap = useCallback((mapId: string) => {
       setCurrentMapId(mapId);
       if (isMobile) setDrawerOpen(false);
     }, [isMobile, setCurrentMapId]);
     ```
- **验收**：
  - `test:e2e:local` 增 `isMobile=true` 用例，连续切图无闪、无双请求（Network 面板同一 mapId 只发一次）。
  - Chrome DevTools mobile emulation 手工回归首图/切图/收起抽屉。
- 依赖：P1.1.1

---

### P2.0 · Citation 来源真实性 + Claim 支持度审计 + 翻译 usedIds 修复

**目标**：兑现 CLAUDE.md §6 "quote 必须逐字来自源"；同时逐条 Claim 判断有没有真的被引用支持；顺手修翻译分支的 usedIds 破例。

**背景**（v1 出错的点）：
- `Citation` 类型无 `sourceId`。真正的锚点是 `Citation.index`（chunk 序号）+ `documentChunks[index-1].content`（`fc-proxy/index.js:2355-2364`）。
- 已有 `buildDocumentChunks` 保证 quote 来自 chunk 切片；漏洞在于**模型生成的自由引用可能修改了 quote 或引用了错误 index**。
- 因此 verify 的目标是"Citation.quote 与 `documentChunks[index-1].content` 精确匹配"（不使用 n-gram 阈值），"Claim 被 citationIndexes 支持"（每条 Claim 单独判断）。

#### P2.0.1 精确归一化匹配工具 + 单测

- **改动文件**：`fc-proxy/index.js`、新建 `src/lib/__tests__/citation-verify.test.ts`（若工具函数最终放 fc-proxy，测试用 vitest 直接 require CJS）
- **改动**：在 `fc-proxy/index.js` 现有工具区新增：
  ```js
  function normalizeForExactMatch(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .replace(/[‘’“”""'']/g, '"')
      .trim();
  }
  // 精确匹配：quote 是否是 chunk.content 的连续子串（归一化后）
  function isVerbatimQuote(quote, chunkContent) {
    const q = normalizeForExactMatch(quote);
    const s = normalizeForExactMatch(chunkContent);
    return q.length >= 4 && s.includes(q);
  }
  module.exports.__citationInternal = { normalizeForExactMatch, isVerbatimQuote };
  ```
  - 只做归一化 + `includes`；不做 4-gram/85% 阈值。
- **测试**：
  - 正例：`quote` 是 `content` 的子串（连原样、连大小写、连全半角引号）→ true。
  - 反例：模型修改一个字/漏一个字 → false。
- 依赖：P0.0.1

#### P2.0.2 Citation 写入前的来源真实性卡点

- **改动文件**：`fc-proxy/index.js`（Citation 装配处，`buildDocumentChunks` 下游的 answer 组装/落库路径）
- **改动**：定位模型返回 citations 后的组装点（即 `verifiedIndexes` 附近，`2383-2387`），改造为：
  ```js
  function verifiedIndexes(value, allowedIndexes, claim, citations, sourceChunks) {
    const provided = normalizeCitationIndexes(value, allowedIndexes);
    const survives = (provided.length ? provided : bestCitationIndexes(claim, citations, 2))
      .filter((idx) => {
        const cit = citations.find(c => c.index === idx);
        const chunk = sourceChunks.find(ch => ch.index === idx);
        if (!cit || !chunk) return false;
        return isVerbatimQuote(cit.quote, chunk.content);
      });
    return survives;
  }
  ```
  找到所有 `verifiedIndexes` 的调用点，把 `sourceChunks`（`buildDocumentChunks` 的返回值或等价数组）传下去。
- **验收**：
  - 新增 `test:rag` 用例：注入 quote 与 chunk.content 不一致 → 该 citation 被剔除，claim 若失去所有 citation → 走 refusal。
  - 现有 46/46 保持通过。
- 依赖：P2.0.1

#### P2.0.3 Claim 支持度审计（逐条）

- **改动文件**：`fc-proxy/index.js`（`citationAudit`，`2484-2498`）
- **改动**：把 audit 改成逐条判断：
  ```js
  function citationAudit(claims, citations, sourceChunks) {
    const rows = claims.filter((item) => item && normalizeSpaces(item.text));
    const warnings = [];
    const perClaim = rows.map((item, i) => {
      const indexes = Array.isArray(item.citationIndexes) ? item.citationIndexes : [];
      const supporting = indexes.filter(idx => {
        const cit = citations.find(c => c.index === idx);
        const chunk = sourceChunks.find(ch => ch.index === idx);
        if (!cit || !chunk) return false;
        if (!isVerbatimQuote(cit.quote, chunk.content)) return false;
        // 关键词重叠 ≥1，防止"合法 citation 编号但配无关结论"
        const claimTerms = tokenize(normalizeForExactMatch(item.text)).filter(t => t.length > 1);
        const chunkText = normalizeForExactMatch(chunk.content);
        return claimTerms.some(t => chunkText.includes(t));
      });
      const supported = supporting.length > 0;
      if (!supported && indexes.length > 0) warnings.push(`第 ${i+1} 条结论的引用未通过来源比对，已降级为提示`);
      return { text: item.text, citationIndexes: supporting, supported };
    });
    const cited = perClaim.filter(x => x.supported);
    return {
      claimCount: rows.length,
      citedClaimCount: cited.length,
      coverage: rows.length ? Number((cited.length / rows.length).toFixed(3)) : 1,
      perClaim,
      warnings,
    };
  }
  ```
- **答案组装**（`1424-1457` 附近）：对每条 Claim 走 `perClaim` 的结果——`supported=false` 的 claim 在最终答案里改成 warning 标签，而不是删掉全篇 answer。整体降级只有在 `rows.length >= 3 && cited.length === 0` 才发生（即所有 Claim 都没有支持时）。
- **前端呈现**（`src/components/modes/article-parser.tsx`、`src/components/modes/meeting-assistant.tsx`）：
  - `refusalReason === 'INSUFFICIENT_VERBATIM_EVIDENCE'` → 全篇 refusal 文案。
  - `citationAudit.perClaim[i].supported === false` → 该条前加 ⚠ 图标 + tooltip "模型未能从原文找到证据"。
- **验收**：
  - `test:rag` 新增：3 条 Claim，中间那条的 citation 与 chunk 完全无重叠 → 断言该条 `supported=false` 且前端标 warning；其它两条正常。
- 依赖：P2.0.2

#### P2.0.4 翻译分支 usedIds 修复

- **改动文件**：`fc-proxy/index.js:1439-1441`
- **改动**：
  ```js
  if (articleRequest.task === 'translate') {
    // 与其它任务一致：走模型返回的 usedSourceIds；模型未报则用 bestCitationIndexes fallback
    const provided = normalizeCitationIndexes(modelResult.usedSourceIds, allowedIds);
    usedIds = provided.length ? provided : bestCitationIndexes(userQuery, citations, 3);
  } else {
    // 原有逻辑
  }
  ```
- **验收**：`test:rag` 新增翻译用例：3 段 evidence，模型只显式引 1 段 → `usedIds.length ≤ 1`。
- 依赖：P2.0.2

---

### P3.0 · 骨架屏与加载/错误态

**目标**：切图第一帧 <100ms 可见骨架；无网络时明确降级；这一条独立于 P2，风险最低，可与 P2 并行。

**注意**：不做 v1 的登录后 `warmupBackend` 三接口散射预热。仅保留"未登录/App 启动 warm `/health`"这一条；登录后由 Sprint 2 的 `/api/bootstrap` 合并请求承担。

#### P3.0.1 单次 `/health` 预热

- **改动文件**：新建 `src/lib/warmup.ts`、`src/app/layout.tsx` 或顶层 Provider
- **实现**：
  ```ts
  import { API_BASE_URL } from "@/lib/config";   // 若未导出，本 PR 顺手导出
  let warmedAt = 0;
  export function warmupHealth() {
    if (Date.now() - warmedAt < 30_000) return;
    warmedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    fetch(`${API_BASE_URL}/health`, { signal: controller.signal })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  }
  ```
- **接入**：顶层 client component `useEffect(() => warmupHealth(), [])`。
- **验收**：Network 面板 App 挂载即见一次 `/health`；30s 内重复挂载不重复请求（HMR 场景）。

#### P3.0.2 骨架屏

- **改动文件**：`src/app/page.tsx`、`src/components/mindmap/mind-map-panel.tsx`、新建 `src/components/mindmap/mind-map-skeleton.tsx`
- **改动**：
  - `page.tsx:353-355` cache miss 分支：
    ```ts
    // 依赖 P1.0.2：hydrate 前直接清空 store，避免与旧图混渲
    useMindGrowStore.setState({ nodes: [], edges: [], entityGraph: { entities: [], relations: [] } });
    setModeLibraryBusy(true);
    ```
  - `mind-map-panel.tsx` 顶部：
    ```tsx
    const showSkeleton = busy && nodes.length === 0;
    return (
      <div className="relative h-full w-full">
        {showSkeleton && <MindMapSkeleton />}
        <div style={{ opacity: showSkeleton ? 0 : 1, transition: "opacity 200ms" }}>
          <ReactFlow ... />
        </div>
      </div>
    );
    ```
  - `mind-map-skeleton.tsx`：5 个占位圆节点 + 4 条虚线连线 + `animate-pulse`；仅 tailwind，无外部依赖。
- **验收**：Chrome throttling 4G，切图第一帧到骨架 <100ms；骨架到真实图 200ms 淡入。
- 依赖：P1.1.1

---

## 3. Sprint 2+ 大任务（保留粗颗粒，等 Sprint 1 完成再拆）

| # | 任务 | 备注 |
|---|---|---|
| S2.1 | `maps.mode` 字段迁移 | 依赖迁移脚本；模块归属长期不再靠 description marker |
| S2.2 | `/api/bootstrap` 合并首屏 | 顺手承担 v1 的登录后预热职责 |
| S2.3 | CI 事实校验（版本、hash、health 断言） | runbook 与 `api-version.txt` 已在 P0.0.3 建好底子 |
| S2.4 | Backlinks + 时间轴 | 依赖 `maps.mode` 稳定与 canonical ID |
| S2.5 | 实体图 v1.1（canonical ID + 真实 createdAt） | 后端 canonical 已有，仅优化前端预览时间 |
| S2.6 | React Flow 可复现 Bug 修复清单 | 不做泛化重构 |
| S2.7 | Obsidian 扁平图优化（在现有实体网状图上） | |
| S2.8 | 白板底座（Heptabase 定位） | 独立里程碑，3–5 周 |
| S2.9 | 常驻实例开启（等 Owner 授权） | |
| S2.10 | 观测：`git_sha`、部署断言（Sentry 单独确认） | |

---

## 4. 每 PR 必答项

1. `/health` 响应结构是否变化？兼容旧字段吗？
2. 数据/存储迁移是否可回滚？（附回滚 SQL 或 revert 路径）
3. 是否新增第三方依赖？license 与体积是否可接受？（附 `du -sh node_modules/<pkg>`）
4. 是否新增对外网络出口？（涉 SSRF 面）
5. 是否改动鉴权路径？（P0 必须 Owner 双人评审）
6. 是否影响 CLAUDE.md 里的 file:line 引用？如影响，本 PR 同步更新。

---

## 5. Codex 开场 prompt

```text
仓库根目录 docs/codex-tasks-v2.md 是完整任务清单。
请先只读通读整个文档，然后从 P0.0.1 开始，按 §1 "9 步 PR 顺序" 严格顺序执行。
每次一个 PR，标题 [Pk.m.n] <简述>；每个 PR 只能修改任务书列出的文件，其它保持不变。
每 PR 跑完 §0 的 6 条命令并把日志附到 PR 描述里；纯前端 PR 可省略 test:backend:local。
遇到任务书未覆盖的分歧点，先在 PR 描述列出选项和你的建议，等 Owner 确认后再动手。
禁止修改 out/、.next/；禁止输出任何 Authorization/SUPABASE_KEY/DASHSCOPE_KEY 值。
Vitest 是本仓库的单测框架，node --test / jest 均不接受。
test:backend 已拆分为 test:backend:local（PR 门禁）与 test:backend:public（部署后）。
```

---

## 附录 A · 从 v1 到 v2 的差异清单（Codex 参考，不必执行）

| v1 计划 | v1 出错的具体点 | v2 修订 |
|---|---|---|
| T1.5 `chatHistoryByMap:{}` | 实际字段 `chatHistory`；类型不匹配 | 用 `resetTenantContext()` 完整字段清单，含 `chatHistory / history / historyIndex / messages / messageMapId / isProcessing / pendingSuggestion / pendingMindMap / pendingPlacement / searchQuery / searchResults / editingNodeId / contextMenu / highlightedNodeId / collapsedNodes / graphRevisionByMap / currentMode / maps / categories / currentMapId(→"map_default") / nodes / edges / entityGraph` |
| T1.5 `currentMapId: null` | 类型是 string，赋 null 编译失败 | 回退到 `"map_default"` |
| T1.5 未清 `activeWorkspaceId` | 该变量在 `client-api.ts` 模块 | 用 `setActiveWorkspaceId(null)` 显式清 |
| T1.4 `event.user.id` | onAuthStateChange 回调是 `(event, nextSession)`，`event` 是字符串 | 用 `nextSession?.user.id`，配 `lastUserIdRef` 判断换号；`signOut` 与 `SIGNED_OUT` 通过 `lastUserIdRef` 幂等 |
| 新增 `*.test.ts` 无框架 | 无 Jest/Vitest、无 `test:unit` 脚本 | P0.0.1 引入 Vitest |
| `test:backend` 每 PR 都跑 | 打的是生产 URL，假通过 | 拆 `:local`/`:public`；PR 门禁只 `:local` |
| T11 `warmupBackend` 三接口 | `API_BASE_URL` 未导出；未登录三接口 401；单一 controller 干扰 | 只保留 `/health` warm；登录数据由 `/api/bootstrap` 承担（Sprint 2） |
| T11 30s 冷却 | 与登录后立刻预热冲突 | 未登录 warm `/health`，登录后走 bootstrap，无 30s 冲突 |
| T4 4-gram + 85% | 允许被修改的文本蒙混通过；`Citation.sourceId` 不存在 | 改用 `Citation.index → documentChunks[i].content` 精确归一化匹配（`normalizeForExactMatch` + `includes`）；逐条 Claim 支持度审计，替代全局 `verbatimRatio` |
| T6 全局 `localMutationVersion` | 需手工在所有外部调用点 bump，易漏 | Store 双通道 `hydrateGraphFromServer` / `mutateGraphLocally`；revision 由 Store 内部按 mapId 维护 |
| T6.3 移动端修复 | 会保留第二套 loader，加重维护 | 直接删掉移动端 loader，统一到主 effect |
| T3 SSRF 排在 Sprint 2 | DNS TOCTOU 是 P0 | 前置到 P0.2，用 `ipaddr.js` + 固定 IP + 每跳重校 |
| runbook `10.2.9` | 与生产 `10.5.2` 漂移 | P0.0.3 引入 `docs/api-version.txt` 单一真源 + `check:api-version` 脚本 |
| T9 会议确认后落库 | 现状已经是"点击才保存"，任务表述有误 | Sprint 2 只做文案与审批状态强化，不重做流程 |
| T10 canonical ID 全新 | 后端已有稳定实体 ID，仅前端预览用 `1970-01-01` | Sprint 2 收窄为"前端预览时间字段接真实值" |
