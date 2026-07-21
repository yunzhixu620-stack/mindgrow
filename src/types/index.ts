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
  relationLabel?: string;
  citations?: Citation[];
  weight: number;
  createdAt: string;
}

export interface GraphEntity {
  id: string;
  canonicalName: string;
  entityType: string;
  aliases: string[];
  description: string;
  confidence: number;
  citations: Citation[];
}

export interface GraphRelation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  label: string;
  status: "asserted" | "historical" | "negated" | "proposed";
  confidence: number;
  citations: Citation[];
}

export interface EntityGraph {
  entities: GraphEntity[];
  relations: GraphRelation[];
}

export interface AIEntityGraphEntity {
  tempId: string;
  name: string;
  type: string;
  aliases?: string[];
  description?: string;
  citationIndexes?: number[];
  confidence?: number;
}

export interface AIEntityGraphRelation {
  source: string;
  target: string;
  type: string;
  label?: string;
  status?: "asserted" | "historical" | "negated" | "proposed";
  citationIndexes?: number[];
  confidence?: number;
}

export interface AIEntityGraph {
  entities: AIEntityGraphEntity[];
  relations: AIEntityGraphRelation[];
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

export interface CitationClaimAuditRow {
  index: number;
  id: string;
  section: string;
  text: string;
  citationIndexes: number[];
  critical: boolean;
  supported: boolean;
  status: "supported" | "unsupported";
}

export interface CitationAudit {
  claimCount: number;
  citedClaimCount: number;
  unsupportedClaimCount: number;
  coverage: number;
  criticalClaimCount: number;
  supportedCriticalClaimCount: number;
  unsupportedCriticalClaimCount: number;
  verifiedQuoteCount: number;
  perClaim: CitationClaimAuditRow[];
  refusalReason: "ALL_KEY_CLAIMS_UNSUPPORTED" | null;
  warnings: string[];
}

export interface AnswerSource {
  id: string;
  title: string;
  index: number;
  quote?: string;
  locator?: string;
  sourceUrl?: string;
}

export interface RetrievalTrace {
  mode: string;
  task?: string;
  seedNodes?: number;
  expandedNodes?: number;
  graphDocuments?: number;
  primaryGraphDocuments?: number;
  candidateChunks?: number;
  entityGraphStatus?: string;
  entitySeeds?: number;
  entityRelations?: number;
  entityEvidence?: number;
  needsDisambiguation?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  suggestions?: AISuggestion[];
  sources?: AnswerSource[];
  retrievalTrace?: RetrievalTrace;
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
