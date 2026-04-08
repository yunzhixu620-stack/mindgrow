// Official templates for MindGrow
// Each template has pre-defined node/edge structures

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  // Pre-built mind map structure
  mindMap: {
    root: string;
    rootDesc?: string;
    children: {
      topic: string;
      desc?: string;
      items: string[];
    }[];
  };
}

export const OFFICIAL_TEMPLATES: Template[] = [
  {
    id: "tpl_project_mgmt",
    name: "项目管理",
    description: "从目标拆解到执行追踪的全流程管理框架",
    icon: "📋",
    category: "工作",
    tags: ["项目管理", "OKR", "任务拆解"],
    mindMap: {
      root: "项目名称",
      rootDesc: "项目核心目标与背景",
      children: [
        { topic: "目标与范围", desc: "项目要达成的目标", items: ["核心目标", "关键指标", "时间节点", "资源预算"] },
        { topic: "团队分工", desc: "团队成员与职责", items: ["角色划分", "负责人", "协作方式", "沟通机制"] },
        { topic: "里程碑", desc: "关键交付节点", items: ["第一阶段", "第二阶段", "第三阶段", "验收标准"] },
        { topic: "风险与应对", desc: "潜在风险及预案", items: ["技术风险", "进度风险", "资源风险", "应急预案"] },
        { topic: "复盘总结", desc: "项目完成后回顾", items: ["做得好的", "待改进的", "经验沉淀", "下一步行动"] },
      ],
    },
  },
  {
    id: "tpl_reading_notes",
    name: "读书笔记",
    description: "结构化阅读笔记，提炼核心观点与金句",
    icon: "📖",
    category: "学习",
    tags: ["阅读", "笔记", "知识管理"],
    mindMap: {
      root: "书名 / 文章标题",
      rootDesc: "作者 · 出版信息",
      children: [
        { topic: "核心观点", desc: "书中最重要的 3-5 个观点", items: ["观点一", "观点二", "观点三"] },
        { topic: "金句摘录", desc: "值得反复品味的句子", items: ["金句一", "金句二", "金句三"] },
        { topic: "框架模型", desc: "书中提出的思维框架", items: ["框架名称", "核心要素", "适用场景"] },
        { topic: "实践应用", desc: "如何将书中内容应用到实际", items: ["可落地的行动", "相关项目", "延伸阅读"] },
        { topic: "个人思考", desc: "自己的理解与联想", items: ["认同的部分", "质疑的部分", "新的启发"] },
      ],
    },
  },
  {
    id: "tpl_study_plan",
    name: "学习规划",
    description: "从目标到执行的系统化学习路径设计",
    icon: "🎯",
    category: "学习",
    tags: ["学习计划", "自我提升", "课程"],
    mindMap: {
      root: "学习主题",
      rootDesc: "学习目标与时间规划",
      children: [
        { topic: "学习目标", desc: "具体可衡量的目标", items: ["知识目标", "技能目标", "认证目标", "时间规划"] },
        { topic: "知识体系", desc: "需要掌握的知识模块", items: ["基础知识", "核心概念", "进阶内容", "实战应用"] },
        { topic: "学习资源", desc: "推荐的学习材料", items: ["书籍/文档", "视频课程", "练习平台", "社区资源"] },
        { topic: "每日计划", desc: "日常学习安排", items: ["时间段分配", "每日任务量", "复习节奏", "笔记方式"] },
        { topic: "检验标准", desc: "如何判断学到位了", items: ["自测题目", "项目实战", "教学输出", "进度回顾"] },
      ],
    },
  },
  {
    id: "tpl_brainstorm",
    name: "头脑风暴",
    description: "发散思考、收集创意、收敛决策的结构化流程",
    icon: "💡",
    category: "创意",
    tags: ["创意", "头脑风暴", "决策"],
    mindMap: {
      root: "核心问题",
      rootDesc: "我们要解决什么问题？",
      children: [
        { topic: "发散阶段", desc: "尽可能多地收集想法", items: ["想法 A", "想法 B", "想法 C", "想法 D"] },
        { topic: "分类整理", desc: "将想法归类", items: ["技术方向", "产品方向", "运营方向", "其他"] },
        { topic: "可行性评估", desc: "评估每个方向的可行性", items: ["技术难度", "资源需求", "时间成本", "预期收益"] },
        { topic: "决策方案", desc: "最终选择的方案", items: ["选定方向", "核心理由", "关键假设", "验证方式"] },
        { topic: "下一步行动", desc: "拆解为可执行的任务", items: ["任务 1", "任务 2", "任务 3", "截止时间"] },
      ],
    },
  },
  {
    id: "tpl_product_design",
    name: "产品设计",
    description: "从用户需求到功能设计的产品思维框架",
    icon: "🎨",
    category: "工作",
    tags: ["产品设计", "需求分析", "用户体验"],
    mindMap: {
      root: "产品名称",
      rootDesc: "一句话描述产品价值",
      children: [
        { topic: "用户画像", desc: "目标用户是谁", items: ["核心用户", "用户痛点", "使用场景", "用户目标"] },
        { topic: "需求分析", desc: "要解决的核心问题", items: ["核心需求", "次要需求", "隐藏需求", "伪需求排查"] },
        { topic: "功能设计", desc: "核心功能与交互", items: ["功能清单", "优先级排序", "交互流程", "页面结构"] },
        { topic: "竞品分析", desc: "市面上有哪些类似产品", items: ["直接竞品", "间接竞品", "差异化点", "可借鉴处"] },
        { topic: "数据指标", desc: "如何衡量产品效果", items: ["北极星指标", "过程指标", "留存指标", "增长指标"] },
      ],
    },
  },
  {
    id: "tpl_weekly_review",
    name: "周复盘",
    description: "每周回顾、总结反思、规划下周的复盘框架",
    icon: "📊",
    category: "效率",
    tags: ["复盘", "周报", "自我管理"],
    mindMap: {
      root: "本周复盘",
      rootDesc: "第 N 周 · 日期范围",
      children: [
        { topic: "本周完成", desc: "做了哪些事情", items: ["任务 1", "任务 2", "任务 3", "额外成果"] },
        { topic: "遇到问题", desc: "遇到了什么困难和卡点", items: ["问题描述", "原因分析", "解决方案", "是否解决"] },
        { topic: "经验收获", desc: "学到了什么", items: ["技术成长", "方法优化", "沟通协作", "认知提升"] },
        { topic: "待改进项", desc: "下周要注意什么", items: ["效率优化", "时间管理", "优先级调整", "习惯养成"] },
        { topic: "下周计划", desc: "下周要完成什么", items: ["目标 1", "目标 2", "目标 3", "关键里程碑"] },
      ],
    },
  },
  {
    id: "tpl_tech_learning",
    name: "技术学习",
    description: "系统化学习一门技术的路线图模板",
    icon: "💻",
    category: "学习",
    tags: ["编程", "技术栈", "路线图"],
    mindMap: {
      root: "技术名称",
      rootDesc: "学习该技术的目的",
      children: [
        { topic: "基础概念", desc: "核心基础必须掌握", items: ["核心概念 A", "核心概念 B", "核心概念 C", "术语表"] },
        { topic: "环境搭建", desc: "开发环境配置", items: ["安装方式", "IDE 配置", "调试工具", "常用命令"] },
        { topic: "核心能力", desc: "必须熟练掌握的能力", items: ["能力 A", "能力 B", "能力 C", "实战项目"] },
        { topic: "进阶内容", desc: "深入学习方向", items: ["高级特性", "性能优化", "设计模式", "源码阅读"] },
        { topic: "生态工具", desc: "相关工具和框架", items: ["常用库", "配套工具", "社区资源", "最佳实践"] },
      ],
    },
  },
  {
    id: "tpl_meeting_notes",
    name: "会议记录",
    description: "结构化记录会议要点、决议和待办事项",
    icon: "📝",
    category: "工作",
    tags: ["会议", "记录", "待办"],
    mindMap: {
      root: "会议主题",
      rootDesc: "日期 · 参与人 · 会议类型",
      children: [
        { topic: "会议背景", desc: "为什么开这个会", items: ["议题一", "议题二", "议题三", "目标"] },
        { topic: "讨论要点", desc: "各方观点和关键讨论", items: ["观点 A", "观点 B", "争议点", "共识"] },
        { topic: "会议决议", desc: "达成的决定", items: ["决议一", "决议二", "决议三", "责任人"] },
        { topic: "待办事项", desc: "后续需要跟进的事", items: ["行动项 1", "行动项 2", "行动项 3", "截止日期"] },
        { topic: "下次会议", desc: "后续安排", items: ["跟进事项", "下次议题", "时间安排", "参会人"] },
      ],
    },
  },
];

export const TEMPLATE_CATEGORIES = ["全部", "工作", "学习", "创意", "效率"];

export function getTemplatesByCategory(category: string): Template[] {
  if (category === "全部") return OFFICIAL_TEMPLATES;
  return OFFICIAL_TEMPLATES.filter((t) => t.category === category);
}
