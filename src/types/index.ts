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
  relationId?: string;
  relationStatus?: "asserted" | "historical" | "negated" | "proposed";
  relationExplanation?: string;
  citations?: Citation[];
  weight: number;
  createdAt: string;
}

export type EntityGroundingStatus = "grounded" | "legacy";

export interface GraphEntity {
  id: string;
  canonicalName: string;
  entityType: string;
  aliases: string[];
  description: string;
  /** Missing on historical payloads; derive it from the v4 evidence fields before rendering. */
  groundingStatus?: EntityGroundingStatus;
  confidence: number;
  /** Backend first-seen time for a canonical entity; absent only on rolling-upgrade or legacy payloads. */
  createdAt?: string;
  /** Last canonical metadata update time; absent only on rolling-upgrade or legacy payloads. */
  updatedAt?: string;
  citations: Citation[];
  descriptionCitations: Citation[];
}

export interface GraphRelation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  shortLabel: string;
  label: string;
  explanation: string;
  status: "asserted" | "historical" | "negated" | "proposed";
  confidence: number;
  createdAt?: string;
  updatedAt?: string;
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
  /** Dedicated evidence for the contextual description; never infer this from citationIndexes. */
  descriptionEvidence?: number[];
  /** Evidence that the entity occurs in the source or supports its extracted facts. */
  citationIndexes?: number[];
  confidence?: number;
}

export interface AIEntityGraphRelation {
  source: string;
  target: string;
  type: string;
  /** Primary human-readable relation label for newly generated graphs. */
  shortLabel?: string;
  /** Source-grounded explanation of the relation direction and meaning. */
  explanation?: string;
  /** Legacy compatibility only; new output should use shortLabel. */
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

export type MapMode = "knowledge" | "meeting" | "article";

export interface MindMap {
  id: string;
  name: string;
  description: string;
  mode: MapMode;
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

export interface NodeBacklink {
  node: KnowledgeNode;
  kinds: ("incoming_edge" | "shared_source")[];
  relation: KnowledgeEdge["relation"] | null;
  relationCreatedAt: string | null;
  sharedCitations: Citation[];
}

export interface NodeRevision {
  id: string;
  eventType: "created" | "updated";
  content: string;
  desc: string;
  changedFields: string[];
  createdAt: string;
}

export interface NodeContext {
  node: KnowledgeNode;
  sources: Citation[];
  backlinks: NodeBacklink[];
  timeline: NodeRevision[];
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
