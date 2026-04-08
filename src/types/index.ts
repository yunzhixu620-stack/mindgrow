export interface KnowledgeNode {
  id: string;
  content: string;
  desc?: string;
  type: "topic" | "concept" | "detail" | "question";
  status: "active" | "archived" | "merged";
  source: "manual" | "auto_complete" | "article" | "ai_generated";
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: "contains" | "relates_to" | "contradicts";
  weight: number;
  createdAt: string;
}

export interface NodeLayout {
  nodeId: string;
  positionX: number;
  positionY: number;
  zoomLevel: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  suggestions?: AISuggestion[];
}

export interface AISuggestion {
  type: "placement" | "auto_complete" | "merge" | "restructure";
  content: string;
  parentNodeId?: string;
  parentPath?: string;
  items?: SuggestionItem[];
}

export interface SuggestionItem {
  content: string;
  type: string;
  selected: boolean;
}

// AI-generated mind map structure (from qwen-plus)
export interface AIMindMap {
  root: string;
  rootDesc?: string;
  rootType?: string;
  children: {
    topic: string;
    desc?: string;
    type?: string;
    items: string[];
  }[];
  relatedTopics?: string[];
}

export interface IntentResult {
  type: "knowledge" | "question" | "chitchat" | "command";
  keywords: string[];
  topic?: string;
  summary: string;
}

export interface PlacementSuggestion {
  targetNodeId: string;
  targetPath: string[];
  confidence: number;
  reason: string;
}

export interface AutoCompleteResult {
  parentNodeId: string;
  parentPath: string[];
  completions: string[];
}
