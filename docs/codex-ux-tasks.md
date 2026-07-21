# MindGrow · UI/UX 任务书（补充 v2）

本文件是 `docs/codex-tasks-v2.md` 的产品体验补充。执行前请先读 v2 §0 全局约定。

**与 v2 的关系**：
- v2 = 安全/正确性/性能底座（P0.0–P3.0）
- 本文件 = 底座落定后的用户可感知改动
- **建议顺序**：v2 P1.0（租户隔离）完成即可开工 U1；v2 全部完成后再动 U2 以后。

**执行原则**：
- 每 PR 一个子任务，标题 `[Uk.n] <简述>`。
- 每 PR 跑 v2 §0 的 6 条命令，附日志。
- 禁改 `out/`、`.next/`。
- Timeline 数据源为 md，不接后端；本文件所有条目**不新增网络请求**（除 U6 明确标注）。

## 0. 优先级与建议排期

| # | 任务 | 工程量 | 建议时机 | 依赖 |
|---|---|---|---|---|
| U1 | 使用指南 · Timeline（静态里程碑版） | 0.5 天 | 与 v2 P3.0 骨架屏并行 | 无 |
| U2 | 顶部同步状态灯（绿/黄/红） | 0.5 天 | v2 P1.1 后 | v2 P1.0 |
| U3 | 骨架屏慢加载兜底文案 | 0.5 天 | 并入 v2 P3.0 或紧随其后 | v2 P3.0 |
| U4 | 面包屑"工作区 › 库 › 图" | 1 天 | v2 P1.1 后 | v2 P1.0 |
| U5 | `Cmd+K` 命令面板 | 1–2 天 | Sprint 2 早期 | 无 |
| U6 | 答案卡三段化 + 引用 chip | 2–3 天 | Sprint 2 中期 | v2 P2.0 |
| U7 | 图谱 hover 呼吸感（一阶邻居高亮） | 0.5 天 | 独立可插 | 无 |
| U8 | 深色模式 | 1 天 | 独立可插 | 无 |
| U9 | 空状态三张模板卡 | 1 天 | 独立可插 | 无 |
| U10 | 移动端底部固定导航 | 1 天 | v2 P1.3 后 | v2 P1.3 |

---

## 1. U1 · 使用指南 · Timeline（静态里程碑版）

**目标**：在使用指南里加一个"MindGrow 从 0 到今天"的时间线，让新用户 30 秒了解产品在往哪长；让老用户看到最近发生了什么。

**技术形态**：纯静态、编译期读 md、无网络请求、无后端接口。

### U1.1 数据格式

**改动文件**：新建 `docs/changelog.md`（唯一数据源）

**格式**：md 二级标题 + YAML frontmatter：

```markdown
---
date: 2026-07-21
version: 10.5.2
tag: performance
title: 知识库切换零白屏
---

- 工作区/知识库/知识宇宙都加入本地缓存，切换 <200ms
- 后台静默刷新，你看到的永远是最新数据
- 取消过期请求，避免旧内容闪回

---
date: 2026-07-15
version: 10.4.0
tag: feature
title: GraphRAG 上线
---

- 实体关系图作为答案的证据来源
- 支持"某某与某某的关系"这类图查询
- 引用不足时自动降级为拒答，避免瞎编

---
date: 2026-07-01
version: 10.0.0
tag: milestone
title: 会议助手正式版
---

- 音频/文本转结构化纪要
- 决议、行动项、风险自动分类
- 确认后才进入长期知识库
```

**`tag` 白名单**：`milestone`、`feature`、`performance`、`fix`、`security`。前端按 tag 上色，未来加新 tag 时同步扩色板。

### U1.2 编译期加载

**改动文件**：新建 `src/lib/changelog.ts`

**实现**：

```ts
// 编译期读 md，避免运行时 fetch 与 fs
import raw from "../../docs/changelog.md?raw";

export interface TimelineEntry {
  date: string;
  version: string;
  tag: "milestone" | "feature" | "performance" | "fix" | "security";
  title: string;
  body: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*?)(?=\n---\n|$)/gm;

export function parseChangelog(md: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = FRONTMATTER.exec(md))) {
    const meta = Object.fromEntries(
      match[1].split("\n").map((l) => {
        const idx = l.indexOf(":");
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      })
    );
    entries.push({
      date: meta.date,
      version: meta.version,
      tag: (meta.tag as TimelineEntry["tag"]) || "feature",
      title: meta.title,
      body: match[2].trim(),
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export const CHANGELOG_ENTRIES = parseChangelog(raw);
```

**Next.js 配置**：`next.config.js` 加 raw md 加载器（Next 15 已内置 `?raw` 支持，若报错则加 webpack loader `raw-loader`；先试内置）。

### U1.3 组件

**改动文件**：新建 `src/components/help/timeline.tsx`、修改现有帮助面板

**JSX 骨架**：

```tsx
"use client";
import { CHANGELOG_ENTRIES, type TimelineEntry } from "@/lib/changelog";

const TAG_STYLE: Record<TimelineEntry["tag"], string> = {
  milestone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  feature: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  performance: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  fix: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  security: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

const TAG_LABEL: Record<TimelineEntry["tag"], string> = {
  milestone: "里程碑", feature: "新功能", performance: "性能",
  fix: "修复", security: "安全",
};

export function GuideTimeline() {
  return (
    <ol className="relative border-l-2 border-slate-200 dark:border-slate-700 pl-6 space-y-8">
      {CHANGELOG_ENTRIES.map((e) => (
        <li key={`${e.date}-${e.version}`} className="relative">
          <span className="absolute -left-[33px] top-1 h-4 w-4 rounded-full bg-white dark:bg-slate-900 border-2 border-emerald-500" />
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-xs text-slate-500 tabular-nums">{e.date}</span>
            <span className="text-xs text-slate-400">v{e.version}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${TAG_STYLE[e.tag]}`}>
              {TAG_LABEL[e.tag]}
            </span>
          </div>
          <h3 className="text-base font-semibold mb-2">{e.title}</h3>
          <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
            {e.body}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

### U1.4 挂载位置

**首选位置**：现有帮助抽屉里加 tab（`showHelp` state 已存在于 `src/store/mindgrow-store.ts:109`）。

**改动**：
- 在帮助抽屉组件内新增 Tab 切换（"快速开始 / 时间线 / 快捷键"）。
- Timeline tab 直接渲染 `<GuideTimeline />`。
- 若帮助抽屉当前无 tab 结构，本 PR 顺手加最简 tab 组件（3 个按钮 + 内容切换）。

### U1.5 单测

**改动文件**：新建 `src/lib/__tests__/changelog.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseChangelog } from "../changelog";

describe("parseChangelog", () => {
  it("parses multiple entries and sorts desc by date", () => {
    const md = `---
date: 2026-01-01
version: 1.0.0
tag: milestone
title: A
---
body A

---
date: 2026-07-01
version: 2.0.0
tag: feature
title: B
---
body B`;
    const list = parseChangelog(md);
    expect(list).toHaveLength(2);
    expect(list[0].date).toBe("2026-07-01");
    expect(list[1].title).toBe("A");
  });
});
```

**验收**：`npm run test:unit` 全绿；DevTools 打开帮助抽屉 → 切到 Timeline tab → 看到条目按时间倒序、tag chip 上色正确、深色模式无对比度问题。

---

## 2. U2 · 顶部同步状态灯

**目标**：让用户始终知道"我刚才的操作云端记住了没"。

**改动文件**：新建 `src/components/ui/sync-indicator.tsx`、修改顶栏容器（大概率是 `src/app/page.tsx` 的顶部区域）

**状态定义**（内部 4 态，UI 显示 3 色）：

| 内部态 | 显示 | 触发 |
|---|---|---|
| `idle` | 绿 · "已同步" | 无 in-flight 请求且上次成功 |
| `syncing` | 黄 · "同步中…" | in-flight 请求存在 |
| `offline` | 红 · "离线，改动仅在本地" | 连续 2 次请求失败 |
| `stale` | 黄 · "有未提交改动"（虚线圆点） | `graphRevisionByMap` 有值但服务端未 ack |

**实现要点**：
- 订阅 `useMindGrowStore`（v2 P1.0.2 引入的 `graphRevisionByMap`）。
- 拦截 `apiFetch` 的 pending/done/error，暴露一个 `useSyncStatus()` hook。做法：`src/lib/client-api.ts` 加一个模块级计数器 + 事件发射器：
  ```ts
  let inflight = 0;
  const listeners = new Set<(s: SyncState) => void>();
  export function onSyncChange(fn: (s: SyncState) => void) { ... }
  // apiFetch 内 inflight++ / try/finally inflight--；error 递增失败计数
  ```
- 组件用 `useSyncEffect` 转成 state。
- 状态灯位置：顶栏右侧、账号头像左边。tooltip 展示上次成功时间 `HH:mm:ss`。

**验收**：断网切图 → 变红；恢复网络 → 变黄 → 变绿；本地拖节点未落库 → 虚线黄。

---

## 3. U3 · 骨架屏慢加载兜底

**目标**：v2 P3.0 骨架屏之上加"1.5s 未填充就换文案"，专治阿里云冷启动。

**改动文件**：`src/components/mindmap/mind-map-skeleton.tsx`（P3.0 新建的组件）

**实现**：

```tsx
const [slowHint, setSlowHint] = useState(false);
useEffect(() => {
  const t = setTimeout(() => setSlowHint(true), 1500);
  return () => clearTimeout(t);
}, []);

return (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
    {/* 现有 5 圆 + shimmer */}
    {slowHint && (
      <p className="text-sm text-slate-500 animate-fade-in">
        网络较慢，正在唤醒服务…通常需要 3–5 秒
      </p>
    )}
  </div>
);
```

**验收**：Chrome throttling "Slow 3G" → 首屏 1.5s 后出现文案；正常网络下文案不出现。

---

## 4. U4 · 面包屑

**目标**：折叠左侧栏后依然知道自己在哪张图。

**改动文件**：新建 `src/components/ui/breadcrumb.tsx`，挂到顶栏

**内容**：`工作区名 › 库名 › 图名`。图名点击弹当前库下的图列表；库名点击展开该库。

**实现要点**：
- 全部从 `useAuth().currentWorkspace` 与 `useMindGrowStore` 现有数据取；无新请求。
- 移动端只显示图名（省空间）。

**验收**：切图/切库/切工作区面包屑同步；点图名弹出快速切换列表。

---

## 5. U5 · `Cmd+K` 命令面板

**目标**：键盘用户 3 秒内找到任何 map/节点/最近引用。

**改动文件**：新建 `src/components/ui/command-palette.tsx`，全局注册键盘监听

**依赖**：可选 `cmdk`（约 8KB gzip）；若不想加依赖，用自写 modal + `<input>` + 过滤。

**索引来源**（全部本地，无请求）：
- `maps`（`useMindGrowStore.getState().maps`）
- 当前 map 的 `nodes.content`
- `entityGraph.entities.canonicalName`
- 最近 10 条 chat message

**交互**：
- `Cmd+K` / `Ctrl+K` 打开。
- ↑↓ 选择，Enter 跳转，Esc 关闭。
- 按类型分区，每区 top 5。
- 匹配用简单 `includes` + 权重（title > content > aliases），不引入 fuzzy 库。

**验收**：命令面板 3 秒内可达任何 map；对 500 节点图搜索响应 <30ms。

---

## 6. U6 · 答案卡三段化 + 引用 chip

**目标**：把"结论 / 证据 / AI 延伸"三段视觉分离；引用从数字 `[1]` 变成可 hover 的 chip。

**依赖**：v2 P2.0 已完成（`citationAudit.perClaim` 结构可用）。

**改动文件**：`src/components/modes/article-parser.tsx`、`src/components/modes/meeting-assistant.tsx`，或抽取共用组件 `src/components/answer/answer-card.tsx`

**三段布局**：

```
┌─────────────────────────────────────────┐
│ 结论（顶部，粗体、深色）                 │
├─────────────────────────────────────────┤
│ 证据（白底）                             │
│ - claim 1  [chip①] [chip②]              │
│ - claim 2  [chip③]                       │
│ - claim 3  ⚠ 未找到直接证据              │
├─────────────────────────────────────────┤
│ ⓘ AI 延伸（浅灰底）                     │
│ 这里的分析未直接引用原文…               │
└─────────────────────────────────────────┘
```

**引用 chip**：
- 从数字 `[1]` 改为 pill：来源图标 + quote 前 15 字 + 省略号。
- Hover 300ms 展开完整 quote 与 locator。
- 点击滚动到原文并 3s 高亮（若 PDF，配合 U6.2）。

**U6.2（可选）PDF 高亮**：`pdfjs-dist` 的 `findController.executeCommand('findagain', {query, highlightAll: true})`。

**验收**：三段视觉分离清晰；chip hover/click 均生效；无支持的 claim 显示 ⚠。

---

## 7. U7 · 图谱 hover 呼吸感

**目标**：`universe-view.tsx` 与主 map 视图 hover 节点时，一阶邻居保持 100% 透明度，其余降到 25%。

**改动文件**：`src/components/universe/universe-view.tsx`、`src/components/mindmap/mind-map-panel.tsx`

**实现**：
- hover 时计算邻居集合 `neighbors = new Set([id, ...edges.filter(...).map(...)])`。
- 每个节点/边加 `style={{ opacity: hovered && !neighbors.has(id) ? 0.25 : 1, transition: 'opacity 200ms' }}`。
- 无 hover 时保持默认。

**验收**：60fps 流畅；无 hover 时表现与现在一致。

---

## 8. U8 · 深色模式

**目标**：夜间用户体验。

**改动**：
- Tailwind 已配置；确认 `tailwind.config.js` 有 `darkMode: 'class'`。
- 顶栏加 toggle：`document.documentElement.classList.toggle('dark')`，`localStorage` 持久化。
- 逐组件补 `dark:` 前缀：优先高频面（顶栏、侧栏、卡片、图谱背景、按钮、输入框）。
- 图谱边线深色下用浅灰。

**验收**：无 flash of wrong theme（首屏读 localStorage 前 blocking `<script>` 设 class）；所有主要面对比度 AA。

---

## 9. U9 · 空状态三张模板卡

**目标**：新用户不看到"空白 + 输入框"。

**改动文件**：`src/app/page.tsx` 或专门 `src/components/empty-state.tsx`

**触发条件**：`maps.length <= 1 && nodes.length === 0`（只有 default map 且空）。

**三张卡**：
1. **个人笔记**：预设一张 map，含 3 个种子节点（学习目标 / 想法 / 待办）
2. **论文速读**：跳到文章解析 tab，focus 输入框
3. **会议纪要**：跳到会议助手 tab

**验收**：新账号首次进入看到三张卡，点击后正确进入对应流；老账号（`maps.length > 1`）不显示。

---

## 10. U10 · 移动端底部导航

**目标**：三个模块常驻底部，不需要滑抽屉。

**改动文件**：新建 `src/components/mobile/bottom-nav.tsx`，仅在 `isMobile` 时渲染。

**布局**：三 tab（💡 碎片 / 📄 文章 / 🎯 会议）+ 中间"新建"按钮浮起。

**注意**：v2 P1.3 完成后，移动端切图已走主 loader；本组件只调 `setCurrentMode` 即可。

**验收**：iPhone SE 视口下三 tab 可见、切换流畅、内容区不被遮挡。

---

## 附录 A · 依赖与体积

| 任务 | 新依赖 | gzip 增量 | 备注 |
|---|---|---|---|
| U1 | 无 | 0 | md 编译期解析 |
| U2 | 无 | 0 | Store 事件 |
| U5 | `cmdk`（可选） | ~8KB | 可用自写 modal 代替 |
| U6 | 无 | 0 | 复用 `pdfjs-dist` |
| U8 | 无 | 0 | Tailwind 内置 |

**总控**：若全部完成且用 `cmdk`，bundle 增量 <15KB gzip。

## 附录 B · 与 CLAUDE.md 的对齐

- CLAUDE.md P3 "答案层级：结论优先、章节/表格可用、证据与 AI 延伸分离" → U6 直接兑现。
- CLAUDE.md §8.6 "PDF 引用 UX：click-to-open-and-highlight" → U6.2 兑现。
- CLAUDE.md P3 "Mobile overflow, empty/loading/error/retry" → U3、U9、U10 三条覆盖。

## 附录 C · Codex 开场 prompt

```text
docs/codex-ux-tasks.md 是 UI/UX 补充任务清单。
执行前请先读 docs/codex-tasks-v2.md 的 §0 全局约定。
建议先完成 v2 的 P1.0 再开始 U1；v2 完成后再动其它 U 系列任务。
每次一个 PR，标题 [Uk.n] <简述>；每个 PR 只能修改任务书列出的文件。
每 PR 跑完 v2 §0 的 6 条命令并附日志。
禁改 out/、.next/；禁止输出任何密钥。
若某 U 任务与 v2 未完成的任务依赖冲突，在 PR 描述里说明并等 Owner 决定顺序。
```
