import {
  IntentResult,
  PlacementSuggestion,
  AutoCompleteResult,
  KnowledgeNode,
} from "@/types";

/**
 * AI Pipeline Layer
 * Currently uses heuristic/rule-based logic.
 * Replace internals with OpenAI API calls when ready.
 */

// ============================================================
// Step 1: Intent Classification
// ============================================================
export async function classifyIntent(input: string): Promise<IntentResult> {
  const trimmed = input.trim();

  // Simple heuristic rules (replace with LLM later)
  const isQuestion = /[？?]$/.test(trimmed) || /^(what|how|why|什么时候|怎么|为什么|是什么|有哪些)/i.test(trimmed);
  const isCommand = /^(删除|移除|撤销|合并|搜索|find|delete|merge)/i.test(trimmed);
  const isChitchat = /^(你好|谢谢|嗯|好的|ok|哈哈|困了|累了|再见|hello|hi|thanks)/i.test(trimmed);

  if (isCommand) {
    return { type: "command", keywords: [trimmed], summary: "用户执行操作指令" };
  }

  if (isChitchat) {
    return { type: "chitchat", keywords: [], summary: "日常对话" };
  }

  if (isQuestion) {
    const keywords = extractKeywords(trimmed);
    return { type: "question", keywords, topic: keywords[0], summary: `用户提问: ${trimmed}` };
  }

  // Default: knowledge point
  const keywords = extractKeywords(trimmed);

  // Filter out very short or likely meaningless inputs
  if (keywords.length === 0 || (keywords.length === 1 && keywords[0].length <= 1)) {
    return {
      type: "chitchat",
      keywords: [],
      summary: "输入太短，请多输入一些内容",
    };
  }

  return {
    type: "knowledge",
    keywords,
    topic: keywords[0],
    summary: `知识点: ${trimmed}`,
  };
}

// ============================================================
// Step 2: Semantic Matching (Placement Suggestion)
// ============================================================
export async function suggestPlacement(
  input: string,
  nodes: KnowledgeNode[]
): Promise<PlacementSuggestion[]> {
  if (nodes.length === 0) {
    return [];
  }

  const inputKeywords = extractKeywords(input).map((k) => k.toLowerCase());

  // Calculate similarity scores
  const scores = nodes.map((node) => {
    const nodeKeywords = extractKeywords(node.content).map((k) => k.toLowerCase());
    let score = 0;

    // Direct keyword match
    for (const ik of inputKeywords) {
      for (const nk of nodeKeywords) {
        if (ik === nk) score += 3;
        else if (ik.includes(nk) || nk.includes(ik)) score += 2;
        else if (levenshteinDistance(ik, nk) <= 2) score += 1;
      }
    }

    // Topic nodes get a slight boost for new knowledge
    if (node.type === "topic") score += 0.5;

    // Concept nodes match more specifically
    if (node.type === "concept" && score > 0) score += 0.3;

    return { node, score };
  });

  // Sort by score and take top suggestions
  scores.sort((a, b) => b.score - a.score);

  // Build path for top matches
  const suggestions: PlacementSuggestion[] = [];
  for (const { node, score } of scores.slice(0, 3)) {
    if (score > 0) {
      const path = getNodePath(node, nodes);
      suggestions.push({
        targetNodeId: node.id,
        targetPath: path,
        confidence: Math.min(score / 10, 1),
        reason: generateReason(input, node.content, score),
      });
    }
  }

  return suggestions;
}

// ============================================================
// Step 3: Auto Complete (suggest child nodes)
// ============================================================
export async function autoComplete(
  input: string,
  parentId: string,
  existingChildren: string[]
): Promise<string[]> {
  // Mock auto-completion based on common knowledge patterns
  // Replace with LLM call later
  const completions = getMockCompletions(input, existingChildren);
  return completions;
}

// ============================================================
// Step 5: Restructure Evaluation
// ============================================================
export interface RestructureAction {
  type: "merge" | "group" | "relate" | "upgrade";
  nodeIds: string[];
  description: string;
}

export async function evaluateRestructure(
  newNode: KnowledgeNode,
  allNodes: KnowledgeNode[]
): Promise<RestructureAction[]> {
  const actions: RestructureAction[] = [];

  // Check for potential merges (similar nodes)
  for (const node of allNodes) {
    if (node.id === newNode.id) continue;
    const similarity = calculateSimilarity(newNode.content, node.content);
    if (similarity > 0.8) {
      actions.push({
        type: "merge",
        nodeIds: [newNode.id, node.id],
        description: `发现相似概念「${newNode.content}」和「${node.content}」，是否合并？`,
      });
    }
  }

  return actions;
}

// ============================================================
// Helpers
// ============================================================

function extractKeywords(text: string): string[] {
  // Simple keyword extraction: split on punctuation and common stop words
  const stopWords = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
    "没有", "看", "好", "自己", "这", "那", "她", "他", "它", "们",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
    "about", "this", "that", "these", "those", "it", "its",
  ]);

  return text
    .split(/[\s,，。.！!？?、；;：:""''（）()【】\[\]{}]+/)
    .filter((word) => word.length > 0 && !stopWords.has(word))
    .slice(0, 10);
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function calculateSimilarity(a: string, b: string): number {
  const keywordsA = new Set(extractKeywords(a).map((k) => k.toLowerCase()));
  const keywordsB = new Set(extractKeywords(b).map((k) => k.toLowerCase()));
  const intersection = new Set(Array.from(keywordsA).filter((x) => keywordsB.has(x)));
  const union = new Set(Array.from(keywordsA).concat(Array.from(keywordsB)));
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function getNodePath(node: KnowledgeNode, allNodes: KnowledgeNode[]): string[] {
  // For now, just return the node itself and its direct content
  // In a full implementation, traverse edges to build the full path
  return [node.content];
}

function generateReason(input: string, targetContent: string, score: number): string {
  const inputKw = extractKeywords(input).slice(0, 2).join("、");
  const targetKw = extractKeywords(targetContent).slice(0, 2).join("、");
  if (score > 5) return `「${inputKw}」与「${targetKw}」高度相关`;
  if (score > 3) return `「${inputKw}」与「${targetKw}」有关联`;
  return `可能与「${targetKw}」相关`;
}

function getMockCompletions(input: string, existing: string[]): string[] {
  // Richer mock completions database
  const completions: Record<string, string[]> = {
    "注意力机制": ["自注意力", "交叉注意力", "多头注意力", "注意力权重", "Softmax归一化"],
    "深度学习": ["神经网络", "反向传播", "梯度下降", "激活函数", "损失函数", "优化器"],
    "产品经理": ["用户研究", "需求分析", "原型设计", "数据驱动", "竞品分析", "用户画像"],
    "设计": ["UI设计", "UX设计", "交互设计", "视觉设计", "设计系统", "设计规范"],
    "编程": ["前端开发", "后端开发", "数据库", "API设计", "算法", "数据结构"],
    "ai": ["机器学习", "深度学习", "自然语言处理", "计算机视觉", "强化学习", "生成式AI"],
    "transformer": ["Self-Attention", "Encoder-Decoder", "位置编码", "多头注意力", "Feed Forward Network"],
    "大模型": ["GPT系列", "Claude", "LLaMA", "训练方法", "推理优化", "对齐技术"],
    "机器学习": ["监督学习", "无监督学习", "强化学习", "特征工程", "模型评估", "过拟合"],
    "神经网络": ["感知机", "CNN", "RNN", "LSTM", "激活函数", "反向传播"],
    "自然语言处理": ["分词", "词嵌入", "BERT", "GPT", "机器翻译", "情感分析"],
    "计算机视觉": ["图像分类", "目标检测", "语义分割", "图像生成", "OCR"],
    "react": ["组件化", "Hooks", "状态管理", "虚拟DOM", "SSR", "Next.js"],
    "python": ["数据类型", "函数", "类与对象", "装饰器", "异步编程", "包管理"],
    "经济学": ["微观经济学", "宏观经济学", "供需关系", "市场结构", "货币政策"],
    "心理学": ["认知心理学", "行为心理学", "发展心理学", "社会心理学", "情绪管理"],
    "用户体验": ["用户旅程", "可用性测试", "A/B测试", "信息架构", "交互设计"],
    "市场营销": ["品牌定位", "内容营销", "社交媒体", "SEO", "数据分析"],
    "项目管理": ["敏捷开发", "Scrum", "需求优先级", "风险管理", "甘特图"],
    "数据": ["数据采集", "数据清洗", "数据分析", "数据可视化", "SQL", "Python"],
    "创业": ["商业模式", "MVP", "市场验证", "融资", "团队组建"],
    "写作": ["结构化写作", "标题技巧", "故事框架", "读者心理", "排版"],
    "英语": ["语法", "词汇", "听力", "口语", "阅读", "写作"],
    "数学": ["线性代数", "概率统计", "微积分", "离散数学", "优化理论"],
    "rlhf": ["人类反馈", "奖励模型", "PPO算法", "对齐训练", "偏好学习"],
    "prompt": ["Prompt Engineering", "Few-shot Learning", "Chain-of-Thought", "角色设定", "上下文学习"],
    "提示词": ["Prompt Engineering", "Few-shot Learning", "Chain-of-Thought", "角色设定", "模板设计"],
  };

  const lowerInput = input.toLowerCase().trim();
  let bestMatch: string[] | null = null;
  let bestScore = 0;

  for (const [key, value] of Object.entries(completions)) {
    if (lowerInput === key.toLowerCase()) {
      bestMatch = value;
      bestScore = 100;
      break;
    }
    if (lowerInput.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerInput)) {
      const score = key.length; // prefer longer matches
      if (score > bestScore) {
        bestScore = score;
        bestMatch = value;
      }
    }
  }

  if (bestMatch) {
    return bestMatch.filter((c) => !existing.some((e) => e.toLowerCase() === c.toLowerCase()));
  }

  // Instead of generic fallback, don't suggest anything if we don't have good completions
  return [];
}
