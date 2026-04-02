# MindGrow — 思维生长的知识有机体

## 产品设计文档 v1.0
> 日期：2026-03-30

---

## 1. 产品定位

### 一句话定位
> 「你只管想，我来长」—— 一个会自己长大的思维导图知识库

### 核心差异化
市面上所有产品都是「一次性生成」导图 → MindGrow 做的是「持续生长」的知识有机体

### 与竞品的根本区别

| | 传统导图工具 | 知识管理工具 | AI 生成工具 | MindGrow |
|---|---|---|---|---|
| 核心动作 | 手动画图 | 手动笔记 | 输入→生成一次 | 输入→持续生长 |
| 知识状态 | 静态 | 静态（需手动整理） | 一次性输出 | 活的、自动演进的 |
| 用户心智 | 「我在做一张图」 | 「我在记笔记」 | 「我在用AI生成」 | 「我在和一个懂我的人对话」 |
| 关联发现 | 无 | 靠手动双链 | 无 | AI自动发现 + 自动建立 |

### 从友商汲取的精华
- mindlib：对话式创建导图的理念 → 更深（自动重构）
- Xmind：视觉打磨的极致 → 同级别导图渲染体验
- Obsidian：双链知识图谱的概念 → 自动化，不用手动建链
- Mapify：多源输入（文章/视频/会议）→ 全阶段规划覆盖
- Meeting.ai：语音转导图 → 加「发散碰撞」，从记录升级为思考

### ENFP 专属设计哲学
1. 零阻力输入：想什么打什么，不打断思维流
2. 视觉成就感：每次输入后看到知识图谱长出新枝节
3. 温和收束：适时提示归类建议，帮助聚焦
4. 低认知负担：不需要学教程，打开就能用

---

## 2. 核心交互设计

### 页面布局
- 左侧对话区（35%）：灵感输入 + AI 交互
- 右侧导图区（65%）：React Flow 思维导图
- 底部输入条：始终可见，随时输入
- 对话与导图联动：AI 建议归属时导图对应分支高亮

### 特殊视图：「知识宇宙」全景模式
- 类似 Obsidian 图谱视图但更美
- 节点大小 = 内容丰富度
- 颜色深浅 = 最近更新时间
- 虚线 = AI 发现的跨领域关联

### 输入能力
- 支持碎片化词汇和完整句子
- AI 快速识别用户在说什么
- 自动判断挂载位置，用户只做大类决策
- 区分「知识点」「疑问」「闲聊」「指令」

---

## 3. AI 处理管线

### Step 1: 意图分类 (GPT-4o-mini)
判断输入类型：知识点 / 疑问 / 闲聊 / 指令

### Step 2: 语义匹配 (Embedding + pgvector)
与知识库所有节点做语义相似度，找最相关的 1-3 个已有节点

### Step 3: 结构建议 (GPT-4o-mini)
综合匹配结果，给出归属建议 + 自动补全子节点

### Step 4: 用户确认
只展示大类决策：挂到 X 下 / 换位置 / 手动指定

### Step 5: 写入 + 自动重构
- 新节点写入数据库
- 触发重构评估：合并/分组/关联发现
- 更新导图视图

### 自动重构规则
| 触发条件 | 重构动作 |
|---|---|
| 语义相似度 > 0.9 | 提议合并相似概念 |
| 分支节点 > 7 个 | 自动按子主题分组，生成中间层级 |
| 跨分支语义关联 | 创建 relates_to 虚线链接 |
| 主题内容丰富 | 视觉升级节点（颜色/大小变化） |
| 用户手动拖拽 | 记住调整，后续重构时尊重偏好 |

---

## 4. 数据模型

```sql
-- 节点表
nodes (
  id          uuid PRIMARY KEY,
  content     text,
  type        text,           -- topic | concept | detail | question
  status      text DEFAULT 'active',
  source      text,           -- manual | auto_complete | article
  confidence  float,          -- AI 确信度 0-1
  created_at  timestamptz,
  updated_at  timestamptz
)

-- 边表
edges (
  id          uuid PRIMARY KEY,
  source_id   uuid REFERENCES nodes,
  target_id   uuid REFERENCES nodes,
  relation    text,           -- contains | relates_to | contradicts
  weight      float DEFAULT 1.0,
  created_at  timestamptz
)

-- 布局表（保存用户手动调整）
node_layouts (
  node_id     uuid REFERENCES nodes PRIMARY KEY,
  position_x  float,
  position_y  float,
  zoom_level  float
)
```

---

## 5. 技术架构

### 技术栈
| 层 | 选型 |
|---|---|
| 前端 | Next.js (App Router) + React + TypeScript |
| 导图 | React Flow |
| 状态管理 | Zustand |
| UI 组件 | Tailwind CSS + shadcn/ui |
| 数据库 | Supabase (PostgreSQL + pgvector) |
| AI 模型 | GPT-4o-mini（意图/结构）+ text-embedding-3-small（匹配） |
| 部署 | Vercel |

### Token 消耗估算
每次输入约 750 input + 170 output tokens ≈ $0.00016
每天 50 条 ≈ ¥0.06/天 ≈ ¥1.8/月

---

## 6. 分期开发路线图

### Phase 1 — MVP（4-6 周）
碎片灵感 → 自动生长的思维导图

| 周次 | 内容 |
|---|---|
| W1 | 项目初始化 + 数据库设计 + 基础 UI 骨架 |
| W2 | 对话输入 + 意图识别 + 语义匹配 |
| W3 | 导图渲染（React Flow）+ 自动节点生成 |
| W4 | 自动补全 + 用户确认流程 |
| W5 | 自动重构（合并/分组/关联发现） |
| W6 | 打磨 + 知识宇宙视图 + Bug 修复 |

### Phase 2 — 内容投喂（+4 周）
| 周次 | 内容 |
|---|---|
| W7 | 文章/网页 URL → 自动提取 → 生成导图 |
| W8 | 多导图知识关联 + 自动分类归档 |
| W9 | 同类知识库合并 + 知识点升级 |
| W10 | 自动搜索补充（设上限，与用户确认） |

### Phase 3 — 会议场景（+4 周）
| 周次 | 内容 |
|---|---|
| W11 | 语音识别（Whisper API）→ 实时转文字 |
| W12 | 实时生成会议导图 |
| W13 | 会议类型识别 + 发散型实时碰撞 |
| W14 | 任务目标输入 → 会议框架生成 + 实时协同 |

---

## 7. 成本估算

| 项目 | 月费用 |
|---|---|
| 基础设施 | 免费（Vercel + Supabase 免费额度） |
| LLM API | ¥5-35/月 |
| 合计 | **约 ¥5-35/月** |

后期加会议语音识别约再增加 ¥10-20/月。
