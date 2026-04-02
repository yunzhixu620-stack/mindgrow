import { NextRequest, NextResponse } from "next/server";
import { generateMindMap, suggestPlacement, classifyIntent, setApiKey } from "@/lib/ai/dashscope";
import { getNodesByMap, getChildEdges } from "@/lib/db/database";

// Initialize API key from env
const API_KEY = process.env.DASHSCOPE_API_KEY || '';
if (API_KEY) setApiKey(API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { input, mapId } = await request.json();

    if (!input || typeof input !== "string") {
      return NextResponse.json({ error: "Input is required" }, { status: 400 });
    }

    const currentMapId = mapId || "map_default";

    // Step 1: Classify intent
    const intent = await classifyIntent(input);

    if (intent.type === "chitchat") {
      const responses = [
        "好的，想到什么就输入什么 🌱",
        "我在这里，随时帮你整理知识",
        "有什么灵感就随手记下来吧",
      ];
      return NextResponse.json({
        intent,
        reply: responses[Math.floor(Math.random() * responses.length)],
        type: "chitchat",
      });
    }

    if (intent.type === "command") {
      return NextResponse.json({
        intent,
        reply: "指令功能开发中，敬请期待 🔧",
        type: "command",
      });
    }

    // Step 2: Get existing topics for context
    const allNodes = await getNodesByMap(currentMapId);
    const existingTopics = allNodes
      .filter((n) => n.type === "topic")
      .map((n) => n.content);

    // Step 3: Generate structured mind map using AI
    const mindMap = await generateMindMap(input, existingTopics);

    if (!mindMap) {
      return NextResponse.json({
        intent,
        reply: "😅 我没能理解这段内容，能换个说法试试吗？",
        type: "knowledge",
        placement: null,
        mindMap: null,
      });
    }

    // Step 4: Check if it should be placed under existing topic
    const placement = await suggestPlacement(input, existingTopics);

    // Build reply - show structured mind map preview
    let reply = "";
    if (placement && existingTopics.length > 0) {
      reply = `📌 我建议将这段内容整合到「${placement.targetTopic}」下\n\n`;
    } else {
      reply = `🌱 新的知识结构：\n\n`;
    }

    // Show mind map structure with descriptions
    reply += `🔹 **${mindMap.root}**\n`;
    if (mindMap.rootDesc) {
      reply += `   _${mindMap.rootDesc}_\n`;
    }
    for (const child of mindMap.children) {
      reply += `  ├─ ${child.topic}`;
      if (child.desc) {
        reply += ` — ${child.desc}`;
      }
      reply += `\n`;
      for (const item of child.items) {
        reply += `  │  ├─ ${item}\n`;
      }
    }

    if (mindMap.relatedTopics && mindMap.relatedTopics.length > 0) {
      reply += `\n🔗 可能关联：${mindMap.relatedTopics.join("、")}`;
    }

    reply += `\n\n确认后将自动创建以上所有节点`;

    return NextResponse.json({
      intent,
      reply,
      type: "knowledge",
      placement,
      mindMap,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
