export interface KnowledgeNode {
  id: string;
  content: string;
  desc?: string;
  type: "topic" | "concept" | "detail" | "question";
  status: "active" | "archived" | "merged";
  source: "manual" | "auto_complete" | "article" | "meeting" | "ai_generated" | "template";
  confidence: number;
  createdAt: string;
  updatedAt: string;
  citations?: Citation[];
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

// Category / Folder for organizing knowledge maps
export interface Category {
  id: string;
  name: string;
  icon: string;       // emoji icon
  color: string;
  sortOrder: number;
  createdAt: string;
}

export interface MindMap {
  id: string;
  name: string;
  description: string;
  color: string;
  isDefault: boolean;
  categoryId: string | null;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  index: number;
  quote: string;
  locator?: string;
  documentId?: string;
  title?: string;
  sourceUrl?: string;
  fileName?: string;
  sourceType?: "url" | "pdf" | "text" | "meeting";
}

export interface AnswerSource {
  id: string;
  title: string;
  index: number;
  quote?: string;
  locator?: string;
  sourceUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  suggestions?: AISuggestion[];
  sources?: AnswerSource[];
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
  rootCitationIndexes?: number[];
  children: {
    topic: string;
    desc?: string;
    type?: string;
    items: string[];
    citationIndexes?: number[];
    itemCitationIndexes?: number[][];
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
