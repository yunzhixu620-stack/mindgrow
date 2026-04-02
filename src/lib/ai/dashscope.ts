// Alibaba DashScope API integration
// Uses qwen-turbo for intent classification and qwen-plus for mind map generation
const https = require('https');

const API_HOST = 'dashscope.aliyuncs.com';
const API_PATH = '/compatible-mode/v1/chat/completions';

// API key will be set externally
let apiKey = process.env.DASHSCOPE_API_KEY || '';

export function setApiKey(key: string) {
  apiKey = key;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  content: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function chat(messages: ChatMessage[], model = 'qwen-turbo', maxTokens = 500, temperature = 0.3): Promise<ChatResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    });

    const req = https.request({
      hostname: API_HOST,
      path: API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
    }, (res: any) => {
      let body = '';
      res.on('data', (c: string) => (body += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.error) {
            reject(new Error(json.error.message || 'API error'));
            return;
          }
          resolve({
            content: json.choices?.[0]?.message?.content || '',
            model: json.model,
            usage: json.usage || {},
          });
        } catch (e) {
          reject(new Error('Failed to parse API response'));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ============================================================
// Step 1: Intent Classification (lightweight, fast)
// ============================================================
export async function classifyIntent(input: string): Promise<{
  type: 'knowledge' | 'question' | 'chitchat' | 'command';
  keywords: string[];
  summary: string;
  topic?: string;
}> {
  const trimmed = input.trim();

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `判断用户输入的意图类型，只返回一个 JSON 对象：
- knowledge: 输入包含知识点、概念、事实、学习内容
- question: 输入是一个问题
- chitchat: 闲聊、问候、情绪表达
- command: 操作指令（删除、搜索、清空等）

返回格式：{"type":"knowledge|question|chitchat|command","keywords":["关键词1","关键词2"],"summary":"一句话概括"}`,
    },
    { role: 'user', content: trimmed },
  ];

  try {
    const resp = await chat(messages, 'qwen-turbo', 100, 0.1);
    return JSON.parse(resp.content);
  } catch {
    // Fallback to simple heuristic
    if (/[？?]$/.test(trimmed) || /^(what|how|why|什么时候|怎么|为什么|是什么)/i.test(trimmed)) {
      return { type: 'question', keywords: [], summary: '用户提问' };
    }
    if (/^(你好|谢谢|嗯|好的|ok|哈哈|困了|累了|再见|hello|hi|thanks)/i.test(trimmed)) {
      return { type: 'chitchat', keywords: [], summary: '日常对话' };
    }
    if (/^(删除|移除|撤销|合并|搜索|find|delete|merge|清空)/i.test(trimmed)) {
      return { type: 'command', keywords: [], summary: '操作指令' };
    }
    return { type: 'knowledge', keywords: extractKeywords(trimmed), summary: `知识点: ${trimmed}` };
  }
}

// ============================================================
// Step 2: Generate Mind Map Structure (AI-powered)
// This is the core improvement: instead of word matching, use LLM
// ============================================================
export interface MindMapSuggestion {
  root: string;
  rootDesc: string;
  rootType: 'topic' | 'concept';
  children: {
    topic: string;
    desc: string;
    type: 'concept' | 'detail';
    items: string[];
  }[];
  relatedTopics?: string[];
}

export async function generateMindMap(input: string, existingTopics: string[]): Promise<MindMapSuggestion | null> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是一个知识图谱构建助手。用户会输入碎片化的知识内容（可能是一段很长的文字），你需要将其整理成结构化的思维导图。

严格规则：
1. 提取最核心的主题作为根节点（不超过10个字），并附一句简短的定义说明（10-25字）
2. 根节点下分 **3-5 个子主题**（不要超过5个），每个子主题下 **2-3 个具体概念**（不要超过3个）
3. 总节点数控制在 **10-18 个**之间（含根节点），宁可精简也不要堆砌
4. 每个子主题和概念都必须附一句简短说明（desc字段，10-25字），说明其含义或与其他节点的关系
5. 将内容按**思维逻辑**组织（因果、并列、递进、对比等关系），desc 中体现节点间的关系
6. 每个节点内容必须是**简洁的概念短语**（3-10字），严禁直接复制原文的长句子
7. 只分2层（根→子主题→概念），不要超过3层
8. 不要出现"相关概念"、"待补充"等占位符
9. 如果输入太短（只有几个字），子节点可以是合理的延伸

已有知识库中的主题：${existingTopics.join('、') || '（空）'}

只返回 JSON，格式如下，不要任何其他文字或代码块标记：
{"root":"核心主题","rootDesc":"一句话定义或概括","children":[{"topic":"子主题","desc":"这个子主题是什么/与其他部分的关系","items":["概念A","概念B"]}]}`,
    },
    { role: 'user', content: input },
  ];

  try {
    const resp = await chat(messages, 'qwen-plus', 1500, 0.3);
    // Try to extract JSON from the response
    let jsonStr = resp.content.trim();
    // Remove markdown code blocks if present
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }
    return JSON.parse(jsonStr) as MindMapSuggestion;
  } catch {
    return null;
  }
}

// ============================================================
// Step 3: Placement Suggestion (find best parent)
// ============================================================
export async function suggestPlacement(input: string, existingTopics: string[]): Promise<{
  targetTopic: string;
  confidence: number;
  reason: string;
} | null> {
  if (existingTopics.length === 0) return null;

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `用户输入了一段知识内容，请判断它最适合归类到以下已有知识主题中的哪一个。

已有主题：${existingTopics.join('、')}

只返回一个 JSON 对象：
{"target":"最匹配的主题名","confidence":0.0到1.0的置信度,"reason":"一句话说明"}

如果都不匹配，返回：{"target":null,"confidence":0,"reason":"不匹配已有主题"}`,
    },
    { role: 'user', content: input },
  ];

  try {
    const resp = await chat(messages, 'qwen-turbo', 200, 0.2);
    const result = JSON.parse(resp.content);
    if (!result.target) return null;
    return {
      targetTopic: result.target,
      confidence: result.confidence,
      reason: result.reason,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Helper: Extract keywords for fallback
// ============================================================
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
    '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
    '没有', '看', '好', '自己', '这', '那', '它', '们',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into',
  ]);
  return text
    .split(/[\s,，。.！!？?、；;：:""''（）()【】\[\]{}]+/)
    .filter((w: string) => w.length > 1 && !stopWords.has(w))
    .slice(0, 8);
}

// Initialize API key
if (process.env.DASHSCOPE_API_KEY) {
  setApiKey(process.env.DASHSCOPE_API_KEY);
}
