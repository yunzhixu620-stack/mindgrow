import { NextRequest, NextResponse } from "next/server";
import {
  getNodesByMap,
  getEdgesByMap,
  createNode,
  createEdge,
  saveLayout,
  deleteNode,
  updateNode,
  getAllMaps,
  createMap as dbCreateMap,
  deleteMap as dbDeleteMap,
  renameMap as dbRenameMap,
  clearMap as dbClearMap,
  getAllCategories,
  createCategory as dbCreateCategory,
  deleteCategory as dbDeleteCategory,
  renameCategory as dbRenameCategory,
  moveMapToCategory as dbMoveMapToCategory,
} from "@/lib/db/database";
import { evaluateRestructure } from "@/lib/ai/pipeline";
import { KnowledgeNode } from "@/types";

// GET: Fetch maps list or map data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const mapId = searchParams.get("mapId") || "map_default";

    if (action === "maps") {
      const maps = await getAllMaps();
      return NextResponse.json({ maps });
    }

    if (action === "categories") {
      const categories = await getAllCategories();
      return NextResponse.json({ categories });
    }

    // Default: return nodes and edges for a specific map
    const nodes = await getNodesByMap(mapId);
    const edges = await getEdgesByMap(mapId);
    return NextResponse.json({ nodes, edges });
  } catch (error) {
    console.error("Knowledge GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST: Add node, create map, clear map, etc.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // Create new map
    if (action === "createMap") {
      const map = await dbCreateMap(body.name || "新知识库", body.description || "", body.color || "#22d3a7");
      return NextResponse.json({ map });
    }

    // Clear map
    if (action === "clearMap") {
      const mapId = body.mapId || "map_default";
      if (mapId === "map_default") {
        return NextResponse.json({ error: "Cannot clear default map" }, { status: 400 });
      }
      await dbClearMap(mapId);
      return NextResponse.json({ success: true });
    }

    // Rename map
    if (action === "renameMap") {
      const success = await dbRenameMap(body.mapId, body.name);
      return NextResponse.json({ success });
    }

    // Delete map
    if (action === "deleteMap") {
      const mapId = body.mapId;
      if (!mapId || mapId === "map_default") {
        return NextResponse.json({ error: "Cannot delete default map" }, { status: 400 });
      }
      const success = await dbDeleteMap(mapId);
      return NextResponse.json({ success });
    }

    // Create category
    if (action === "createCategory") {
      const category = await dbCreateCategory(body.name || "新文件夹", body.icon || "📁", body.color || "#22d3a7");
      return NextResponse.json({ category });
    }

    // Delete category
    if (action === "deleteCategory") {
      const success = await dbDeleteCategory(body.categoryId);
      return NextResponse.json({ success });
    }

    // Rename category
    if (action === "renameCategory") {
      const success = await dbRenameCategory(body.categoryId, body.name);
      return NextResponse.json({ success });
    }

    // Move map to category
    if (action === "moveMapToCategory") {
      const success = await dbMoveMapToCategory(body.mapId, body.categoryId || null);
      return NextResponse.json({ success });
    }

    // Default: Add node(s) from AI-generated mind map structure
    const { content, type, source, parentId, confidence, completions, position, mapId, mindMap } = body;
    const currentMapId = mapId || "map_default";

    // Handle AI-generated mind map structure
    if (mindMap && mindMap.root) {
      const createdNodes = [];
      const createdEdges = [];

      // Create root topic
      const rootNode = await createNode({
        content: mindMap.root,
        desc: mindMap.rootDesc || "",
        type: "topic",
        status: "active",
        source: source || "manual",
        confidence: confidence || 1.0,
        mapId: currentMapId,
      });

      if (position) {
        await saveLayout({ nodeId: rootNode.id, mapId: currentMapId, positionX: position.x, positionY: position.y });
      }
      createdNodes.push(rootNode);

      // Create children
      for (const child of mindMap.children || []) {
        const childNode = await createNode({
          content: child.topic,
          desc: child.desc || "",
          type: "concept",
          status: "active",
          source: source || "ai_generated",
          confidence: 0.8,
          mapId: currentMapId,
        });

        const childEdge = await createEdge({
          sourceId: rootNode.id,
          targetId: childNode.id,
          relation: "contains",
          weight: 1.0,
          mapId: currentMapId,
        });
        createdNodes.push(childNode);
        createdEdges.push(childEdge);

        // Create items
        for (const item of child.items || []) {
          const itemNode = await createNode({
            content: item,
            type: "detail",
            status: "active",
            source: "ai_generated",
            confidence: 0.6,
            mapId: currentMapId,
          });

          const itemEdge = await createEdge({
            sourceId: childNode.id,
            targetId: itemNode.id,
            relation: "contains",
            weight: 0.8,
            mapId: currentMapId,
          });
          createdNodes.push(itemNode);
          createdEdges.push(itemEdge);
        }
      }

      // If placement was suggested, link root to parent
      if (parentId) {
        const linkEdge = await createEdge({
          sourceId: parentId,
          targetId: rootNode.id,
          relation: "contains",
          weight: 1.0,
          mapId: currentMapId,
        });
        createdEdges.push(linkEdge);
      }

      return NextResponse.json({
        node: rootNode,
        additionalNodes: createdNodes.slice(1),
        additionalEdges: createdEdges,
        totalNodes: createdNodes.length,
        totalEdges: createdEdges.length,
      });
    }

    // Legacy: single node creation
    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const node = await createNode({
      content,
      type: type || "concept",
      status: "active",
      source: source || "manual",
      confidence: confidence || 1.0,
      mapId: currentMapId,
    });

    if (position) {
      await saveLayout({
        nodeId: node.id,
        mapId: currentMapId,
        positionX: position.x,
        positionY: position.y,
        zoomLevel: 1,
      });
    }

    let edge = null;
    if (parentId) {
      edge = await createEdge({
        sourceId: parentId,
        targetId: node.id,
        relation: "contains",
        weight: 1.0,
        mapId: currentMapId,
      });
    }

    const createdCompletions: { node: KnowledgeNode; edge: any }[] = [];
    if (completions && completions.length > 0) {
      for (const comp of completions) {
        const compNode = await createNode({
          content: comp,
          type: "detail",
          status: "active",
          source: "auto_complete",
          confidence: 0.6,
          mapId: currentMapId,
        });

        const compEdge = await createEdge({
          sourceId: node.id,
          targetId: compNode.id,
          relation: "contains",
          weight: 0.8,
          mapId: currentMapId,
        });

        createdCompletions.push({ node: compNode, edge: compEdge });
      }
    }

    const allNodes = await getNodesByMap(currentMapId);
    const restructureActions = await evaluateRestructure(node, allNodes);

    return NextResponse.json({
      node,
      edge,
      completions: createdCompletions,
      restructureActions,
    });
  } catch (error) {
    console.error("Knowledge POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT: Update layout or rename map
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "renameMap") {
      const success = await dbRenameMap(body.mapId, body.name);
      return NextResponse.json({ success });
    }

    // Default: Update layout
    const { nodeId, mapId, positionX, positionY } = body;
    if (!nodeId) {
      return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
    }
    await saveLayout({
      nodeId,
      mapId: mapId || "map_default",
      positionX,
      positionY,
      zoomLevel: 1,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Knowledge PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: Delete a node
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nodeId = searchParams.get("nodeId");
    if (!nodeId) {
      return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
    }
    const success = await deleteNode(nodeId);
    return NextResponse.json({ success });
  } catch (error) {
    console.error("Knowledge DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH: Update node content or type
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { nodeId, content, type, status, desc } = body;
    if (!nodeId) {
      return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
    }
    const updates: any = {};
    if (content !== undefined) updates.content = content;
    if (desc !== undefined) updates.desc = desc;
    if (type !== undefined) updates.type = type;
    if (status !== undefined) updates.status = status;
    const node = await updateNode(nodeId, updates);
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    return NextResponse.json({ node });
  } catch (error) {
    console.error("Knowledge PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
