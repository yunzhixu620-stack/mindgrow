const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const { jsPDF } = require("jspdf");

const BASE_URL = process.env.MINDGROW_BASE_URL || "http://localhost:3000";
const BASE_PATH = new URL(BASE_URL).pathname.replace(/\/$/, "");
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const E2E_FILTER = String(process.env.MINDGROW_E2E_FILTER || "").trim().toLocaleLowerCase();
const artifactDir = path.join(__dirname, "..", "artifacts");
fs.mkdirSync(artifactDir, { recursive: true });
const pdfPath = path.join(artifactDir, "mindgrow-citation-sample.pdf");
const realPaperPath = path.join(__dirname, "..", "tests", "fixtures", "papers", "layoutlmv3-2204.08387.pdf");
const pdf = new jsPDF();
pdf.text("Retrieval augmented generation must find relevant evidence before producing an answer.", 12, 20, { maxWidth: 180 });
pdf.text("Every conclusion should keep a source citation so users can verify the original material.", 12, 40, { maxWidth: 180 });
pdf.addPage();
pdf.text("When evidence is missing, the assistant should clearly abstain instead of inventing details.", 12, 20, { maxWidth: 180 });
pdf.text("A fixed evaluation set should measure retrieval recall and citation accuracy as data grows.", 12, 40, { maxWidth: 180 });
fs.writeFileSync(pdfPath, Buffer.from(pdf.output("arraybuffer")));

const results = [];
let meetingLibraryId = "";
let articleLibraryId = "";
const check = async (name, task) => {
  if (E2E_FILTER && !name.toLocaleLowerCase().includes(E2E_FILTER)) return;
  try {
    await task();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    if (E2E_FILTER && error.stack) console.error(error.stack);
  }
};

const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (elements, label) => {
    const target = elements.find((element) => element.textContent.trim().includes(label));
    if (!target) return false;
    target.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Cannot find ${selector} containing ${text}`);
};

const revealAllStoredNodes = async (page) => {
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => /^全部 \d+$/.test(button.textContent.trim())));
  const total = await page.$$eval("button", (buttons) => {
    const allButton = buttons.find((button) => /^全部 \d+$/.test(button.textContent.trim()));
    return Number(allButton?.textContent.match(/\d+/)?.[0] || 0);
  });
  if (!total) throw new Error("Stored node total is missing");
  await clickByText(page, "button", "全部");
  await page.waitForFunction((expected) => {
    const storedNodes = Array.from(document.querySelectorAll(".react-flow__node"))
      .filter((node) => !node.querySelector('[data-display-overview="true"]'));
    return storedNodes.length === expected;
  }, {}, total);
  return total;
};

const expandOneVisibleLevel = async (page, previousCount) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const clicked = await page.$$eval('button[aria-label^="展开下一层 "]', (buttons) => {
      const target = buttons[0];
      if (!target) return false;
      target.click();
      return true;
    });
    if (!clicked) break;
    try {
      await page.waitForFunction(
        (previous) => document.querySelectorAll(".react-flow__node").length > previous,
        { timeout: 3500 },
        previousCount,
      );
      return await page.$$eval(".react-flow__node", (nodes) => nodes.length);
    } catch {
      // The attempted branch may already have all of its children visible.
      // Its expand control disappears, so retry the next collapsed branch.
    }
  }
  throw new Error("No collapsed branch revealed another visible level");
};

(async () => {
  const browser = await puppeteer.launch({ headless: "new", pipe: true, executablePath, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    if (!sessionStorage.getItem("mindgrow.e2e.initialized")) {
      localStorage.removeItem("mindgrow.local.v2");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("mindgrow.feedback.")) localStorage.removeItem(key);
      }
      sessionStorage.setItem("mindgrow.e2e.initialized", "true");
    }
  });

  await page.setViewport({ width: 1440, height: 900 });
  // Next dev keeps a live HMR connection, so DOM readiness plus the explicit
  // feature waits below is a more stable gate than global network idleness.
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  await check("seed knowledge map renders", async () => {
    const count = await revealAllStoredNodes(page);
    if (count !== 13) throw new Error(`Expected 13 stored seed nodes, got ${count}`);
  });

  await check("whiteboard view persists card positions and returns to the mind map", async () => {
    // Reproduce the real race: the mind-map "show all" action schedules a
    // viewport refit immediately before the user switches to whiteboard.
    await revealAllStoredNodes(page);
    await page.waitForSelector('[data-testid="canvas-view-whiteboard"]', { timeout: 30000 });
    const activeMapId = await page.$eval('[data-testid="knowledge-workspace"]', (element) => element.getAttribute("data-current-map-id"));
    if (!activeMapId) throw new Error("Active map id is missing");
    await page.click('[data-testid="canvas-view-whiteboard"]');
    await page.waitForFunction((mapId) => {
      const workspace = document.querySelector('[data-testid="knowledge-graph-workspace"]');
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return workspace?.getAttribute("data-canvas-view") === "whiteboard"
        && state.maps.find((map) => map.id === mapId)?.canvasView === "whiteboard";
    }, {}, activeMapId);
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('[data-whiteboard-card="true"]');
      return cards.length === 13 && !document.querySelector('[data-display-overview="true"]');
    });
    await page.waitForFunction(() => document.querySelector(".react-flow__viewport")?.style.transform.includes("scale(0.88)"));

    const firstNode = await page.$('.react-flow__node:has([data-whiteboard-card="true"])');
    if (!firstNode) throw new Error("Whiteboard reading card is missing");
    const nodeId = await firstNode.evaluate((element) => element.getAttribute("data-id"));
    const before = await firstNode.boundingBox();
    if (!nodeId || !before) throw new Error("Whiteboard card cannot be dragged");
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 96, before.y + before.height / 2 + 64, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction((id, mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      const layout = state.layouts?.[id];
      return layout?.mapId === mapId && Math.abs(layout.positionX - 80) > 40;
    }, {}, nodeId, activeMapId);
    const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).layouts[id], nodeId);
    await page.screenshot({ path: path.join(artifactDir, "desktop-whiteboard.png"), fullPage: true });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction((id, x, y) => {
      const workspace = document.querySelector('[data-testid="knowledge-graph-workspace"]');
      const card = document.querySelector(`.react-flow__node[data-id="${id}"] [data-whiteboard-persisted="true"]`);
      const layout = JSON.parse(localStorage.getItem("mindgrow.local.v2")).layouts?.[id];
      return workspace?.getAttribute("data-canvas-view") === "whiteboard"
        && Boolean(card)
        && layout?.positionX === x
        && layout?.positionY === y;
    }, {}, nodeId, saved.positionX, saved.positionY);

    await page.click('[data-testid="create-whiteboard-group"]');
    await page.waitForSelector('[data-testid="whiteboard-group-editor"]');
    await page.click('[data-testid="whiteboard-group-name"]', { clickCount: 3 });
    await page.type('[data-testid="whiteboard-group-name"]', "检索方法");
    await page.click('[data-testid="save-whiteboard-group"]');
    await page.waitForFunction((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return document.querySelectorAll('[data-testid="whiteboard-group"]').length === 1
        && (state.whiteboardGroups?.[mapId] || []).length === 1;
    }, {}, activeMapId);
    // Group creation recenters the viewport with a short animation. Wait for it
    // to settle before deriving pointer coordinates for the following drag.
    await page.evaluate(() => new Promise((resolve) => window.setTimeout(resolve, 500)));
    const groupId = await page.$eval('[data-testid="whiteboard-group"]', (element) => element.getAttribute("data-whiteboard-group-id"));
    if (!groupId) throw new Error("Created whiteboard group has no stable id");

    const groupNode = await page.$(`.react-flow__node[data-id="__mindgrow_whiteboard_group__${groupId}"]`);
    const candidateCards = await page.$$('.react-flow__node:has([data-whiteboard-card="true"])');
    const groupBox = await groupNode?.boundingBox();
    let groupedCard = null;
    let groupedCardBox = null;
    for (const candidate of candidateCards) {
      const box = await candidate.boundingBox();
      if (box && box.x + box.width > 0 && box.y + box.height > 90 && box.x < 1440 && box.y < 900) {
        groupedCard = candidate;
        groupedCardBox = box;
        break;
      }
    }
    if (!groupNode || !groupBox || !groupedCard || !groupedCardBox) throw new Error("Whiteboard group or visible card cannot be dragged");
    const groupedCardId = await groupedCard.evaluate((element) => element.getAttribute("data-id"));
    if (!groupedCardId) throw new Error("Grouped card id is missing");
    await page.mouse.move(groupedCardBox.x + groupedCardBox.width / 2, groupedCardBox.y + groupedCardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(groupBox.x + Math.min(220, groupBox.width / 2), groupBox.y + Math.min(190, groupBox.height / 2), { steps: 10 });
    await page.mouse.up();
    try {
      await page.waitForFunction((id, mapId, expectedGroupId) => {
        const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
        const layout = state.layouts?.[id];
        return layout?.mapId === mapId && layout.groupId === expectedGroupId;
      }, { timeout: 8000 }, groupedCardId, activeMapId, groupId);
    } catch {
      const debug = await page.evaluate((id, mapId, expectedGroupId) => {
        const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
        const card = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect();
        const group = document.querySelector(`[data-whiteboard-group-id="${expectedGroupId}"]`)?.closest(".react-flow__node")?.getBoundingClientRect();
        return { layout: state.layouts?.[id], group: (state.whiteboardGroups?.[mapId] || []).find((item) => item.id === expectedGroupId), card: card && { x: card.x, y: card.y, width: card.width, height: card.height }, groupBox: group && { x: group.x, y: group.y, width: group.width, height: group.height } };
      }, groupedCardId, activeMapId, groupId);
      throw new Error(`Card did not enter the whiteboard group: ${JSON.stringify(debug)}`);
    }
    const relativeLayout = await page.evaluate((id) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).layouts[id], groupedCardId);

    await page.click(`button[aria-label="重命名分组 检索方法"]`);
    await page.waitForSelector('[data-testid="whiteboard-group-editor"]');
    await page.click('[data-testid="whiteboard-group-name"]', { clickCount: 3 });
    await page.type('[data-testid="whiteboard-group-name"]', "检索与 RAG");
    await page.click('[data-testid="save-whiteboard-group"]');
    await page.waitForFunction((mapId, expectedGroupId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return (state.whiteboardGroups?.[mapId] || []).find((group) => group.id === expectedGroupId)?.name === "检索与 RAG";
    }, {}, activeMapId, groupId);

    await page.waitForSelector(`button[aria-label="放大分组 检索与 RAG"]:not([disabled])`);
    await page.$eval(`button[aria-label="放大分组 检索与 RAG"]`, (button) => button.click());
    await page.waitForFunction((mapId, expectedGroupId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      const group = (state.whiteboardGroups?.[mapId] || []).find((item) => item.id === expectedGroupId);
      return group?.width > 720 && group?.height > 480;
    }, {}, activeMapId, groupId);

    await page.waitForSelector(`button[aria-label="折叠分组 检索与 RAG"]:not([disabled])`);
    await page.$eval(`button[aria-label="折叠分组 检索与 RAG"]`, (button) => button.click());
    await page.waitForFunction((mapId, expectedGroupId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      const group = (state.whiteboardGroups?.[mapId] || []).find((item) => item.id === expectedGroupId);
      return group?.collapsed === true;
    }, {}, activeMapId, groupId);
    await page.waitForFunction((cardId) => !document.querySelector(`.react-flow__node[data-id="${cardId}"]`), {}, groupedCardId);
    await page.waitForSelector(`button[aria-label="展开分组 检索与 RAG"]:not([disabled])`);
    await page.$eval(`button[aria-label="展开分组 检索与 RAG"]`, (button) => button.click());
    await page.waitForFunction((mapId, expectedGroupId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      const group = (state.whiteboardGroups?.[mapId] || []).find((item) => item.id === expectedGroupId);
      return group?.collapsed === false;
    }, {}, activeMapId, groupId);
    await page.waitForSelector(`.react-flow__node[data-id="${groupedCardId}"]`, { timeout: 10000 });
    await page.waitForSelector(`button[aria-label="折叠分组 检索与 RAG"]:not([disabled])`);

    const groupBeforeMove = await page.evaluate((mapId, expectedGroupId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return (state.whiteboardGroups?.[mapId] || []).find((item) => item.id === expectedGroupId);
    }, activeMapId, groupId);
    const dragHandle = await page.$('[data-testid="whiteboard-group-drag-handle"]');
    const dragHandleBox = await dragHandle?.boundingBox();
    if (!dragHandleBox) throw new Error("Whiteboard group drag handle is missing");
    await page.mouse.move(dragHandleBox.x + 90, dragHandleBox.y + dragHandleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragHandleBox.x + 180, dragHandleBox.y + dragHandleBox.height / 2 + 64, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction((mapId, expectedGroupId, x, y) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      const group = (state.whiteboardGroups?.[mapId] || []).find((item) => item.id === expectedGroupId);
      return group && (Math.abs(group.positionX - x) > 40 || Math.abs(group.positionY - y) > 40);
    }, {}, activeMapId, groupId, groupBeforeMove.positionX, groupBeforeMove.positionY);
    await page.waitForSelector(`button[aria-label="折叠分组 检索与 RAG"]:not([disabled])`);
    const layoutAfterGroupMove = await page.evaluate((id) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).layouts[id], groupedCardId);
    if (layoutAfterGroupMove.positionX !== relativeLayout.positionX || layoutAfterGroupMove.positionY !== relativeLayout.positionY) {
      throw new Error("Moving a group rewrote its card's relative position");
    }

    await page.$eval(`.react-flow__node[data-id="${groupedCardId}"] [data-testid="leave-whiteboard-group"]`, (button) => button.click());
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).layouts[id]?.groupId === null, {}, groupedCardId);

    const outsideCard = await page.$(`.react-flow__node[data-id="${groupedCardId}"]`);
    const outsideCardBox = await outsideCard?.boundingBox();
    const groupForReturn = await page.$eval(`.react-flow__node[data-id="__mindgrow_whiteboard_group__${groupId}"]`, (element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    if (!outsideCardBox || !groupForReturn) throw new Error("Ungrouped card cannot be moved back into the group");
    await page.mouse.move(outsideCardBox.x + outsideCardBox.width / 2, outsideCardBox.y + outsideCardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(groupForReturn.x + Math.min(230, groupForReturn.width / 2), groupForReturn.y + Math.min(190, groupForReturn.height / 2), { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction((id, expectedGroupId) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).layouts[id]?.groupId === expectedGroupId, {}, groupedCardId, groupId);

    await page.click(`button[aria-label="删除分组 检索与 RAG"]`);
    await page.waitForSelector('[data-testid="whiteboard-group-delete-confirm"]');
    await page.click('[data-testid="confirm-delete-whiteboard-group"]');
    await page.waitForFunction((mapId, id) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return (state.whiteboardGroups?.[mapId] || []).length === 0
        && state.layouts?.[id]?.groupId === null
        && Boolean(document.querySelector(`.react-flow__node[data-id="${id}"]`));
    }, {}, activeMapId, groupedCardId);

    const ungroupedAfterDelete = await page.evaluate((id) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).layouts[id], groupedCardId);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction((mapId, id, x, y) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return document.querySelector('[data-testid="knowledge-graph-workspace"]')?.getAttribute("data-canvas-view") === "whiteboard"
        && (state.whiteboardGroups?.[mapId] || []).length === 0
        && state.layouts?.[id]?.positionX === x
        && state.layouts?.[id]?.positionY === y
        && Boolean(document.querySelector(`.react-flow__node[data-id="${id}"]`));
    }, {}, activeMapId, groupedCardId, ungroupedAfterDelete.positionX, ungroupedAfterDelete.positionY);

    await page.click('[data-testid="canvas-view-mindmap"]');
    await page.waitForFunction((mapId) => {
      const workspace = document.querySelector('[data-testid="knowledge-graph-workspace"]');
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return workspace?.getAttribute("data-canvas-view") === "mindmap"
        && state.maps.find((map) => map.id === mapId)?.canvasView === "mindmap";
    }, {}, activeMapId);
    await revealAllStoredNodes(page);
  });

  await check("500-card whiteboard keeps pan zoom keyboard and mobile controls usable", async () => {
    const primaryStorageBefore = await page.evaluate(() => localStorage.getItem("mindgrow.local.v2"));
    const largeContext = await browser.createBrowserContext();
    const largePage = await largeContext.newPage();
    const createdAt = new Date().toISOString();
    const largeMapId = "map_whiteboard_500";
    const largeNodes = Array.from({ length: 500 }, (_, index) => ({
      id: `scale_node_${index}`,
      content: `规模测试知识点 ${index + 1}`,
      desc: `用于验证五百张阅读卡在平移、缩放与渐进展示下仍可交互，原始摘要 ${index + 1} 保持完整。`,
      type: index % 20 === 0 ? "topic" : index % 4 === 0 ? "concept" : "detail",
      status: "active",
      source: "ai_generated",
      confidence: 1,
      citations: [{ index: 1, title: "规模测试固定样本", locator: `段落 ${index + 1}`, quote: `规模测试证据 ${index + 1}` }],
      createdAt,
      updatedAt: createdAt,
    }));
    const largeState = {
      version: 2,
      maps: [{
        id: largeMapId,
        name: "500 卡白板性能样本",
        description: "固定大图交互样本",
        mode: "knowledge",
        canvasView: "whiteboard",
        color: "#22d3a7",
        isDefault: true,
        categoryId: null,
        nodeCount: 500,
        createdAt,
        updatedAt: createdAt,
      }],
      categories: [],
      nodes: { [largeMapId]: largeNodes },
      edges: { [largeMapId]: [] },
      entityGraphs: { [largeMapId]: { entities: [], relations: [] } },
      layouts: {},
      whiteboardGroups: { [largeMapId]: [] },
    };
    for (let index = 0; index < largeNodes.length; index += 1) {
      const node = largeNodes[index];
      largeState.layouts[node.id] = {
        nodeId: node.id,
        mapId: largeMapId,
        positionX: 80 + (index % 20) * 344,
        positionY: 96 + Math.floor(index / 20) * 232,
        zoomLevel: 1,
        groupId: null,
        cardWidth: 280,
        cardHeight: 168,
        updatedAt: createdAt,
      };
    }
    await largePage.evaluateOnNewDocument((state) => {
      localStorage.setItem("mindgrow.local.v2", JSON.stringify(state));
      sessionStorage.setItem("mindgrow.e2e.initialized", "true");
    }, largeState);
    try {
      await largePage.setViewport({ width: 1440, height: 900 });
      const startedAt = Date.now();
      await largePage.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      try {
        await largePage.waitForSelector('[data-testid="knowledge-graph-workspace"][data-canvas-view="whiteboard"][data-whiteboard-viewport-culling="true"]', { timeout: 30000 });
      } catch (error) {
        const diagnostics = await largePage.evaluate(() => ({
          body: document.body.innerText.slice(0, 600),
          storedMaps: JSON.parse(localStorage.getItem("mindgrow.local.v2") || "null")?.maps?.map((map) => ({ id: map.id, canvasView: map.canvasView, nodeCount: map.nodeCount })),
          workspace: document.querySelector('[data-testid="knowledge-graph-workspace"]')?.outerHTML.slice(0, 500) || null,
        }));
        throw new Error(`Large whiteboard did not initialize: ${JSON.stringify(diagnostics)} (${error.message})`);
      }
      await largePage.waitForFunction(() => document.querySelector('[data-testid="knowledge-graph-workspace"]')?.getAttribute("data-whiteboard-detail-level") === "summary");
      const renderedCardCount = await largePage.$$eval('[data-whiteboard-card="true"]', (cards) => cards.length);
      if (renderedCardCount <= 0 || renderedCardCount >= 150) throw new Error(`Viewport culling rendered ${renderedCardCount}/500 cards`);
      if (Date.now() - startedAt > 10000) throw new Error("500-card whiteboard took over 10 seconds to become interactive");

      await largePage.keyboard.press("g");
      await largePage.waitForSelector('[data-testid="whiteboard-group-editor"]');
      await largePage.keyboard.press("Escape");
      await largePage.waitForFunction(() => !document.querySelector('[data-testid="whiteboard-group-editor"]'));
      const beforeTransform = await largePage.$eval(".react-flow__viewport", (element) => element.style.transform);
      const interactionStartedAt = Date.now();
      await largePage.mouse.move(720, 450);
      await largePage.mouse.wheel({ deltaY: -520 });
      await largePage.waitForFunction((previous) => document.querySelector(".react-flow__viewport")?.style.transform !== previous, { timeout: 2000 }, beforeTransform);
      if (Date.now() - interactionStartedAt > 2000) throw new Error("500-card whiteboard zoom exceeded the 2 second interaction budget");
      await largePage.waitForFunction(() => document.querySelector('[data-testid="knowledge-graph-workspace"]')?.getAttribute("data-whiteboard-detail-level") === "full");
      await largePage.waitForSelector('[data-whiteboard-card="true"] [aria-label="节点引用"]');
      await largePage.keyboard.press("0");

      await largePage.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
      await largePage.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await largePage.waitForSelector('[data-testid="mobile-view-toolbar"] button[aria-label="查看知识图谱"]');
      await largePage.click('[data-testid="mobile-view-toolbar"] button[aria-label="查看知识图谱"]');
      await largePage.waitForSelector('[data-testid="knowledge-graph-workspace"][data-whiteboard-viewport-culling="true"]');
      await largePage.waitForSelector('[data-testid="mobile-create-whiteboard-group"]');
      await largePage.waitForFunction(() => document.querySelector('[data-testid="knowledge-graph-workspace"]')?.getAttribute("data-whiteboard-detail-level") === "title");
      await largePage.click('[data-whiteboard-card="true"]');
      await largePage.waitForSelector('[data-whiteboard-card="true"][data-whiteboard-detail-level="full"] [aria-label="节点引用"]');
      await largePage.click('[data-testid="mobile-create-whiteboard-group"]');
      await largePage.waitForSelector('[data-testid="whiteboard-group-editor"]');
      await largePage.keyboard.press("Escape");
      const mobileOverflow = await largePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (mobileOverflow) throw new Error("Large whiteboard overflows the mobile viewport");
      await largePage.screenshot({ path: path.join(artifactDir, "whiteboard-500-mobile.png"), fullPage: true });
    } finally {
      await largeContext.close();
    }
    const primaryStorageAfter = await page.evaluate(() => localStorage.getItem("mindgrow.local.v2"));
    if (primaryStorageBefore && primaryStorageAfter !== primaryStorageBefore) throw new Error("500-card fixture leaked into the primary test workspace");
  });

  await check("theme toggle persists and updates the graph palette without a wrong-theme flash", async () => {
    const before = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      canvasDot: getComputedStyle(document.documentElement).getPropertyValue("--canvas-dot").trim(),
      canvasBackground: getComputedStyle(document.querySelector(".react-flow__background")).backgroundColor,
    }));
    if (!before.theme || !before.canvasDot) throw new Error(`Initial theme was not applied before the app rendered: ${JSON.stringify(before)}`);
    await page.waitForFunction((expected) => {
      const toggle = document.querySelector('[data-testid="theme-toggle"]');
      return toggle?.getAttribute("data-theme") === expected && toggle.getAttribute("data-theme-ready") === "true";
    }, {}, before.theme);
    await page.click('[data-testid="theme-toggle"]');
    await page.waitForFunction((previous) => document.documentElement.dataset.theme !== previous, {}, before.theme);
    const toggled = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      saved: localStorage.getItem("mindgrow.theme.v1"),
      canvasDot: getComputedStyle(document.documentElement).getPropertyValue("--canvas-dot").trim(),
      canvasBackground: getComputedStyle(document.querySelector(".react-flow__background")).backgroundColor,
    }));
    if (toggled.saved !== toggled.theme) throw new Error("Theme preference was not persisted");
    if (toggled.canvasDot === before.canvasDot || toggled.canvasBackground === before.canvasBackground) throw new Error("Graph canvas did not follow the selected theme");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="theme-toggle"]');
    await page.waitForFunction((expected) => {
      const toggle = document.querySelector('[data-testid="theme-toggle"]');
      return toggle?.getAttribute("data-theme") === expected && toggle.getAttribute("data-theme-ready") === "true";
    }, {}, toggled.theme);
    const afterReload = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, saved: localStorage.getItem("mindgrow.theme.v1") }));
    if (afterReload.theme !== toggled.theme || afterReload.saved !== toggled.theme) throw new Error("Saved theme flashed or reset during reload");
    await page.click('[data-testid="theme-toggle"]');
    await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, {}, before.theme);
    await revealAllStoredNodes(page);
  });

  await check("pre-v12 local maps upgrade to explicit mode without losing descriptions", async () => {
    const legacyId = "map_e2e_legacy_mode";
    await page.evaluate((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      const source = state.maps[0];
      const legacy = { ...source, id: mapId, name: "Legacy article map", description: "[MindGrow:article] 原始说明", isDefault: false, nodeCount: 0 };
      delete legacy.mode;
      state.maps.push(legacy);
      state.nodes[mapId] = [];
      state.edges[mapId] = [];
      state.entityGraphs[mapId] = { entities: [], relations: [] };
      localStorage.setItem("mindgrow.local.v2", JSON.stringify(state));
    }, legacyId);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="knowledge-workspace"]');
    await page.waitForFunction((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return state.maps.find((map) => map.id === mapId)?.mode === "article";
    }, {}, legacyId);
    const upgraded = await page.evaluate((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return state.maps.find((map) => map.id === mapId);
    }, legacyId);
    if (upgraded?.mode !== "article" || upgraded.description !== "[MindGrow:article] 原始说明") throw new Error(`Legacy map migration was lossy: ${JSON.stringify(upgraded)}`);
    await page.evaluate((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      state.maps = state.maps.filter((map) => map.id !== mapId);
      delete state.nodes[mapId]; delete state.edges[mapId]; delete state.entityGraphs[mapId];
      localStorage.setItem("mindgrow.local.v2", JSON.stringify(state));
    }, legacyId);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await revealAllStoredNodes(page);
  });

  await check("sync indicator reports current-map network state without cross-map leakage", async () => {
    const indicator = await page.waitForSelector('[data-testid="sync-indicator"]');
    const initial = await indicator.evaluate((element) => ({ state: element.getAttribute("data-sync-state"), mapId: element.getAttribute("data-sync-map-id") }));
    if (initial.state !== "idle" || !initial.mapId) throw new Error(`Initial sync status is invalid: ${JSON.stringify(initial)}`);
    await page.setOfflineMode(true);
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-indicator"]')?.getAttribute("data-sync-state") === "offline");
    const offlineLabel = await page.$eval('[data-testid="sync-indicator"]', (element) => element.getAttribute("aria-label"));
    if (offlineLabel !== "离线，改动仅在本地") throw new Error(`Offline sync label is misleading: ${offlineLabel}`);
    await page.setOfflineMode(false);
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-indicator"]')?.getAttribute("data-sync-state") !== "offline");
    const recoveredMapId = await page.$eval('[data-testid="sync-indicator"]', (element) => element.getAttribute("data-sync-map-id"));
    if (recoveredMapId !== initial.mapId) throw new Error("Network recovery leaked sync state into another map");
  });

  await check("graph hover keeps one-hop neighbors readable and dims unrelated nodes", async () => {
    const nodeCount = await page.$$eval(".react-flow__node", (nodes) => nodes.length);
    if (nodeCount < 3) throw new Error("Hover focus fixture needs at least three visible nodes");
    await page.hover(".react-flow__node");
    await page.waitForFunction(() => Array.from(document.querySelectorAll(".react-flow__node")).some((node) => Number(node.style.opacity) === 0.25));
    const focusStyles = await page.$$eval(".react-flow__node", (nodes) => nodes.map((node) => ({ opacity: node.style.opacity, transition: node.style.transition })));
    if (!focusStyles.some((style) => Number(style.opacity) === 1)) throw new Error("Hovered node and one-hop neighbors were not kept at full opacity");
    if (!focusStyles.every((style) => style.transition.includes("opacity"))) throw new Error("Graph nodes do not use the 200ms opacity transition");
    await page.hover("header");
    await page.waitForFunction(() => Array.from(document.querySelectorAll(".react-flow__node")).every((node) => node.style.opacity !== "0.25"));
  });

  await check("usage guide button opens the guide from the application", async () => {
    try {
      const guide = await page.$('[data-testid="guide-link"]');
      if (!guide) throw new Error("Usage guide link is missing");
      await guide.click();
      await page.waitForFunction(
        () => window.location.pathname.endsWith("/guide") || window.location.pathname.endsWith("/guide/"),
        { timeout: 60000 },
      );
      await page.waitForSelector("h1");
      const heading = await page.$eval("h1", (element) => element.textContent.trim());
      if (!heading.includes("可追溯的知识网络")) throw new Error("Usage guide did not render after clicking");
      const timeline = await page.$('[data-testid="guide-timeline"]');
      if (!timeline) throw new Error("Visual usage timeline is missing");
      await page.waitForFunction(() => {
        const element = document.querySelector('[data-guide-scroll]');
        return element && element.scrollHeight > element.clientHeight;
      }, { timeout: 10000 });
      await page.$eval('[data-guide-scroll]', (element) => { element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) * 0.55); element.dispatchEvent(new Event("scroll")); });
      await page.waitForFunction(() => parseFloat(document.querySelector('[data-testid="guide-progress"]')?.style.width || "0") > 25);
    } finally {
      // Always restore the dependent scenario chain to the application. A
      // guide assertion must not make the remaining checks run on /guide.
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await revealAllStoredNodes(page);
    }
  });

  await check("Ctrl+K searches loaded content locally with keyboard navigation", async () => {
    const commandStep = async (label, task) => {
      try { return await task(); } catch (error) { throw new Error(`${label}: ${error.message}`); }
    };
    await page.evaluate(() => {
      window.__mindgrowCommandSearchRequests = [];
      window.__mindgrowCommandSearchCapture = (event) => window.__mindgrowCommandSearchRequests.push(event.detail?.path || "");
      window.addEventListener("mindgrow:local-api-request", window.__mindgrowCommandSearchCapture);
    });
    try {
      await page.keyboard.down("Control");
      await page.keyboard.press("k");
      await page.keyboard.up("Control");
      await commandStep("Ctrl+K did not open the palette", () => page.waitForSelector('[data-testid="command-palette"] input', { timeout: 5000 }));
      const search = await page.$('[data-testid="command-palette"] input');
      if (!search) throw new Error("Command search input missing");
      await page.$eval('[data-testid="command-palette"] input', (input) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "AI");
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "AI" }));
      });
      await commandStep("Controlled query did not update", () => page.waitForFunction(() => document.querySelector('[data-testid="command-palette"] input')?.value === "AI", { timeout: 5000 }));
      await commandStep("Current-node result did not render", () => page.waitForSelector('[data-result-group="nodes"] [data-result-kind="node"]', { timeout: 5000 }));
      const resultText = await page.$eval('[data-result-group="nodes"] [data-result-kind="node"]', (element) => element.textContent);
      if (!resultText.includes("AI")) throw new Error("Current-node match is not visible in the command palette");
      const remoteSearchRequests = await page.evaluate(() => window.__mindgrowCommandSearchRequests.filter((path) => path.includes("action=search")));
      if (remoteSearchRequests.length > 0) throw new Error("Cmd/Ctrl+K search issued a backend request");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await commandStep("Enter did not close the palette", () => page.waitForFunction(() => !document.querySelector('[data-testid="command-palette"]'), { timeout: 5000 }));
      await page.keyboard.down("Control");
      await page.keyboard.press("k");
      await page.keyboard.up("Control");
      await commandStep("Second Ctrl+K did not reopen the palette", () => page.waitForSelector('[data-testid="command-palette"]', { timeout: 5000 }));
      await page.keyboard.press("Escape");
      await commandStep("Escape did not close the palette", () => page.waitForFunction(() => !document.querySelector('[data-testid="command-palette"]'), { timeout: 5000 }));
      await page.click('[data-testid="command-palette-open"]');
      await commandStep("Sidebar launcher did not open the palette", () => page.waitForSelector('[data-testid="command-palette"]', { timeout: 5000 }));
      const scopeText = await page.$eval('[data-testid="command-palette"] footer', (element) => element.textContent);
      if (!scopeText.includes("仅搜索已加载知识库") || scopeText.includes("所有知识库")) throw new Error("Command search scope copy is misleading");
      await page.screenshot({ path: path.join(artifactDir, "desktop-command-palette.png") });
      await page.keyboard.press("Escape");
    } finally {
      if (await page.$('[data-testid="command-palette"]')) {
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector('[data-testid="command-palette"]'), { timeout: 5000 }).catch(() => {});
      }
      await page.evaluate(() => {
        window.removeEventListener("mindgrow:local-api-request", window.__mindgrowCommandSearchCapture);
        delete window.__mindgrowCommandSearchCapture;
        delete window.__mindgrowCommandSearchRequests;
      });
    }
  });

  await check("capability shortcut returns a concise fixed answer", async () => {
    const input = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    await input.type("AI 知识助手包含哪些能力？");
    await page.click('button[aria-label="发送"]');
    await page.waitForSelector('[data-testid="capability-answer"]');
    const answer = await page.$eval('[data-testid="capability-answer"]', (element) => element.textContent.trim());
    if (!answer.includes("收集") || !answer.includes("整理") || !answer.includes("检索") || !answer.includes("追溯")) throw new Error("Fixed capability answer is incomplete");
    if (answer.length > 180) throw new Error(`Fixed capability answer is too long: ${answer.length}`);
  });

  await check("grounded retrieval returns cited evidence", async () => {
    const input = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    await input.type("RAG 回答需要满足哪些引用要求？");
    await page.click('button[aria-label="发送"]');
    await page.waitForFunction(() => document.body.innerText.includes("根据当前知识库，找到"));
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.includes("[1]") || !text.includes("仅基于当前知识库节点")) throw new Error("Missing citations or grounded-answer notice");
  });

  await check("answer feedback is recorded", async () => {
    const buttons = await page.$$('button[aria-label="回答有帮助"]');
    const latest = buttons.at(-1);
    if (!latest) throw new Error("Helpful feedback control is missing");
    await latest.click();
    await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.startsWith("mindgrow.feedback.")));
  });

  await page.screenshot({ path: path.join(artifactDir, "desktop-grounded-answer.png"), fullPage: true });

  await check("knowledge input creates editable node structure", async () => {
    const input = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    await input.type("RAG 回答需要引用可追溯来源，并在证据不足时明确说明知识缺口");
    await page.click('button[aria-label="发送"]');
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent.includes("添加") && button.textContent.includes("节点")));
    await clickByText(page, "button", "添加");
    await page.waitForFunction(() => document.body.innerText.includes("思维导图已更新"));
    await page.waitForFunction(() => {
      const allButton = Array.from(document.querySelectorAll("button")).find((button) => /^全部 \d+$/.test(button.textContent.trim()));
      if (!allButton) return false;
      const total = Number(allButton.textContent.match(/\d+/)?.[0] || 0);
      return total >= 14 && document.querySelectorAll(".react-flow__node").length < total;
    });
  });

  await check("a related second keyword reuses the existing topic", async () => {
    const before = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      const entry = Object.entries(state.nodes).find(([, nodes]) => nodes.some((node) => node.content.includes("RAG 回答需要引用")));
      if (!entry) return null;
      return { mapId: entry[0], topicCount: entry[1].filter((node) => node.type === "topic").length };
    });
    if (!before) throw new Error("Cannot locate the first generated topic");
    const input = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    await input.type("RAG 检索回答同样需要引用可核对来源，并避免证据不足时编造内容");
    await page.click('button[aria-label="发送"]');
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent.includes("添加") && button.textContent.includes("节点")));
    await clickByText(page, "button", "添加");
    await page.waitForFunction(() => document.body.innerText.includes("自动耦合到现有主题"));
    const after = await page.evaluate((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return {
        topicCount: state.nodes[mapId].filter((node) => node.type === "topic").length,
        duplicateEdges: state.edges[mapId].length - new Set(state.edges[mapId].map((edge) => `${edge.sourceId}:${edge.targetId}`)).size,
      };
    }, before.mapId);
    if (after.topicCount !== before.topicCount) throw new Error(`Related input created a duplicate root (${before.topicCount} -> ${after.topicCount})`);
    if (after.duplicateEdges !== 0) throw new Error("Coupling created duplicate edges");
  });

  await check("mind-map connections are continuous curves", async () => {
    await page.waitForSelector(".react-flow__edge-path");
    const curved = await page.$$eval(".react-flow__edge-path", (paths) => paths.every((path) => (path.getAttribute("d") || "").includes("C")));
    if (!curved) throw new Error("One or more map edges still use multi-turn elbow paths");
    const overlapCount = await page.$$eval(".react-flow__node", (nodes) => {
      const rects = nodes.map((node) => node.getBoundingClientRect());
      let overlaps = 0;
      for (let left = 0; left < rects.length; left += 1) {
        for (let right = left + 1; right < rects.length; right += 1) {
          const x = Math.min(rects[left].right, rects[right].right) - Math.max(rects[left].left, rects[right].left);
          const y = Math.min(rects[left].bottom, rects[right].bottom) - Math.max(rects[left].top, rects[right].top);
          if (x > 2 && y > 2) overlaps += 1;
        }
      }
      return overlaps;
    });
    if (overlapCount) throw new Error(`${overlapCount} node cards overlap after automatic layout`);
  });

  await check("large map uses progressive disclosure", async () => {
    const before = await page.$$eval(".react-flow__node", (nodes) => nodes.length);
    await page.screenshot({ path: path.join(artifactDir, "desktop-large-map-outline.png"), fullPage: true });
    await page.waitForSelector('button[aria-label^="展开下一层 "]');
    const afterFirstLevel = await expandOneVisibleLevel(page, before);
    const total = await page.$$eval("button", (buttons) => Number(buttons.find((button) => /^全部 \d+$/.test(button.textContent.trim()))?.textContent.match(/\d+/)?.[0] || 0));
    const nextLevel = await page.$('button[aria-label^="展开下一层 "]');
    if (nextLevel && afterFirstLevel >= total) throw new Error("First expansion revealed the full descendant tree instead of one level");
    if (nextLevel) {
      await expandOneVisibleLevel(page, afterFirstLevel);
    }

    await revealAllStoredNodes(page);
  });

  await check("large map restores its outline after a full-page return", async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="knowledge-workspace"]');
    await page.waitForFunction(() => {
      const workspace = document.querySelector('[data-testid="knowledge-graph-workspace"]');
      const totalButton = Array.from(document.querySelectorAll("button"))
        .find((button) => /^全部 \d+$/.test(button.textContent.trim()));
      const total = Number(totalButton?.textContent.match(/\d+/)?.[0] || 0);
      const visible = Number(workspace?.getAttribute("data-visible-node-count") || total);
      return workspace?.getAttribute("data-graph-view-mode") === "outline"
        && total >= 14
        && visible > 0
        && visible < total;
    }, { timeout: 10000 });
  });

  await check("graph display settings switch between title density and reading cards", async () => {
    await page.click('button[title="显示与间距"]');
    await page.waitForSelector('[data-testid="graph-display-settings"]');
    await clickByText(page, '[data-testid="graph-display-settings"] button', "阅读卡");
    const readingMode = await page.$eval('[data-testid="graph-display-settings"]', (panel) => panel.textContent.includes("阅读卡"));
    if (!readingMode) throw new Error("Reading-card density control is missing");
    await clickByText(page, '[data-testid="graph-display-settings"] button', "仅标题");
    await page.click('button[title="显示与间距"]');
  });

  await check("node title and detailed explanation are editable", async () => {
    const node = await page.$(".react-flow__node");
    if (!node) throw new Error("No editable node found");
    const nodeId = await node.evaluate((element) => element.getAttribute("data-id"));
    await node.evaluate((element) => element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
    await page.waitForSelector("#node-description-editor");
    await page.click("#node-description-editor");
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.$eval("#node-description-editor", (element) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(element, "这是经过验证、可继续修改的详细解释内容。");
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "这是经过验证、可继续修改的详细解释内容。" }));
    });
    const modalSaved = await page.evaluate(() => {
      const editor = document.querySelector("#node-description-editor");
      const modal = editor?.closest(".fixed");
      const save = Array.from(modal?.querySelectorAll("button") || []).find((button) => button.textContent.trim() === "保存");
      if (!save) return false;
      save.click();
      return true;
    });
    if (!modalSaved) throw new Error("Node edit save action is missing");
    await page.waitForFunction(() => !document.querySelector("#node-description-editor"));
    const saved = await page.evaluate((id) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return Object.values(state.nodes).flat().find((item) => item.id === id)?.desc || "";
    }, nodeId);
    if (!saved.includes("经过验证")) throw new Error(`Detailed explanation was not persisted for ${nodeId}: ${saved}`);
  });

  await check("node context exposes source backlinks and a readable timeline", async () => {
    const node = await page.$(".react-flow__node");
    if (!node) throw new Error("No node is available for traceability inspection");
    await node.evaluate((element) => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 420, clientY: 260 })));
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent.includes("引用与时间轴")));
    await clickByText(page, "button", "引用与时间轴");
    await page.waitForSelector('[data-testid="node-context-panel"]');
    const panelText = await page.$eval('[data-testid="node-context-panel"]', (element) => element.textContent);
    if (!panelText.includes("原文来源") || !panelText.includes("谁指向或复用了它") || !panelText.includes("变更时间轴")) {
      throw new Error("Node traceability sections are incomplete");
    }
    if (!await page.$('[data-testid="node-timeline-event"]')) throw new Error("Node timeline has no events");
    await page.click('button[aria-label="关闭节点引用与时间轴"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="node-context-panel"]'));
  });

  await check("new map persists after reload", async () => {
    await page.click('button[title="新建知识库"]');
    await page.waitForSelector('input[placeholder="知识库名称..."]');
    await page.type('input[placeholder="知识库名称..."]', "检索评测空间");
    await clickByText(page, "button", "创建");
    await page.waitForFunction(() => document.body.innerText.includes("检索评测空间"));
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("检索评测空间"));
  });

  await check("product breadcrumb tracks hierarchy and uses the shared map loader", async () => {
    const breadcrumbState = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      const activeId = document.querySelector('[data-testid="knowledge-workspace"]')?.getAttribute("data-current-map-id") || "";
      const active = state.maps.find((map) => map.id === activeId);
      const target = state.maps.find((map) => map.id !== activeId && map.mode === "knowledge");
      return { activeId, activeName: active?.name || "", targetId: target?.id || "", targetName: target?.name || "" };
    });
    if (!breadcrumbState.activeId || !breadcrumbState.activeName || !breadcrumbState.targetId) throw new Error(`Breadcrumb fixture is incomplete: ${JSON.stringify(breadcrumbState)}`);
    const breadcrumbText = await page.$eval('[data-testid="product-breadcrumb"]', (element) => element.textContent.replace(/\s+/g, " ").trim());
    if (!breadcrumbText.includes("本地工作区") || !breadcrumbText.includes("知识碎片") || !breadcrumbText.includes(breadcrumbState.activeName)) throw new Error(`Breadcrumb hierarchy is incomplete: ${breadcrumbText}`);
    if (breadcrumbText.includes(" › 图 › ") || breadcrumbText.endsWith(" › 图")) throw new Error("Breadcrumb invented a graph level");
    await page.evaluate(() => {
      window.__breadcrumbGraphRequests = [];
      window.__breadcrumbGraphCapture = (event) => {
        const detail = event.detail || {};
        const url = new URL(detail.path || "", window.location.origin);
        const mapId = url.searchParams.get("mapId");
        if (detail.method === "GET" && url.pathname.endsWith("/api/knowledge") && mapId) window.__breadcrumbGraphRequests.push(mapId);
      };
      window.addEventListener("mindgrow:local-api-request", window.__breadcrumbGraphCapture);
    });
    try {
      await page.click('[data-testid="product-breadcrumb"] button[aria-label^="当前知识库"]');
      await page.waitForSelector('[data-testid="breadcrumb-map-menu"]');
      await page.click(`[data-testid="breadcrumb-map-menu"] button[data-map-id="${breadcrumbState.targetId}"]`);
      await page.waitForFunction((targetId) => document.querySelector('[data-testid="knowledge-workspace"]')?.getAttribute("data-current-map-id") === targetId, {}, breadcrumbState.targetId);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const requestCount = await page.evaluate((targetId) => window.__breadcrumbGraphRequests.filter((mapId) => mapId === targetId).length, breadcrumbState.targetId);
      if (requestCount > 1) throw new Error(`Breadcrumb duplicated the shared loader: ${requestCount} graph requests`);

      await page.click('[data-testid="product-breadcrumb"] button[aria-label^="当前知识库"]');
      await page.waitForSelector('[data-testid="breadcrumb-map-menu"]');
      await page.click(`[data-testid="breadcrumb-map-menu"] button[data-map-id="${breadcrumbState.activeId}"]`);
      await page.waitForFunction((activeId) => document.querySelector('[data-testid="knowledge-workspace"]')?.getAttribute("data-current-map-id") === activeId, {}, breadcrumbState.activeId);
    } finally {
      await page.evaluate(() => {
        window.removeEventListener("mindgrow:local-api-request", window.__breadcrumbGraphCapture);
        delete window.__breadcrumbGraphCapture;
        delete window.__breadcrumbGraphRequests;
      });
    }
  });

  await check("meeting assistant generates and saves structured minutes", async () => {
    await clickByText(page, "button", "会议助手");
    await page.waitForSelector('[data-testid="meeting-workspace"]');
    await page.waitForSelector('textarea[placeholder*="会议记录"]');
    const meetingGraph = await page.$('[data-testid="knowledge-graph-workspace"][data-graph-mode="meeting"]');
    if (!meetingGraph) throw new Error("Meeting knowledge graph workspace is missing");
    meetingLibraryId = await page.$eval("[data-mode-library-id]", (element) => element.getAttribute("data-mode-library-id"));
    const meetingLibrary = await page.evaluate((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return state.maps.find((map) => map.id === mapId);
    }, meetingLibraryId);
    if (meetingLibrary?.mode !== "meeting") throw new Error("Meeting board did not enter its own explicit-mode knowledge library");
    const persistedMeetingNodesBefore = await page.evaluate((mapId) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).nodes[mapId]?.length || 0, meetingLibraryId);
    await page.type('textarea[placeholder*="会议记录"]', "今天讨论知识助手发布计划。决定本周完成登录测试。小王负责回归验证，周五前完成。风险是文章解析接口可能超时。");
    await clickByText(page, "button", "生成结构化会议纪要");
    await page.waitForSelector('[data-testid="answer-card"]');
    const draftPersisted = await page.$eval('[data-testid="meeting-draft-status"]', (element) => element.getAttribute("data-persisted"));
    if (draftPersisted !== "false") throw new Error("Meeting analysis entered long-term knowledge before confirmation");
    const persistedMeetingNodesAfterAnalysis = await page.evaluate((mapId) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).nodes[mapId]?.length || 0, meetingLibraryId);
    if (persistedMeetingNodesAfterAnalysis !== persistedMeetingNodesBefore) throw new Error("Meeting analysis mutated persistent knowledge before confirmation");
    const meetingAnswerSections = await page.$$eval('[data-testid="answer-card"] > section', (sections) => sections.map((section) => section.textContent.trim()));
    if (!["结论", "证据", "AI 延伸"].every((label) => meetingAnswerSections.some((section) => section.includes(label)))) throw new Error("Meeting answer is not separated into conclusion, evidence, and AI extension");
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 3);
    await clickByText(page, "button", "确认并加入长期知识库");
    await page.waitForFunction(() => document.body.innerText.includes("会议知识节点"));
    const confirmedPersisted = await page.$eval('[data-testid="meeting-draft-status"]', (element) => element.getAttribute("data-persisted"));
    if (confirmedPersisted !== "true") throw new Error("Meeting confirmation did not update the long-term knowledge state");
    const savedMeetingNodes = await page.evaluate((mapId) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).nodes[mapId]?.length || 0, meetingLibraryId);
    if (savedMeetingNodes === 0) throw new Error("Meeting result was saved outside the meeting library");
    const microphone = await page.$('button[aria-label="开始语音输入"]');
    if (!microphone) throw new Error("Meeting microphone control missing");
  });

  await check("article parser extracts and saves a knowledge map", async () => {
    await clickByText(page, "button", "文章解析");
    await page.waitForSelector('[data-testid="article-workspace"]');
    const articleGraph = await page.$('[data-testid="knowledge-graph-workspace"][data-graph-mode="article"]');
    if (!articleGraph) throw new Error("Article knowledge graph workspace is missing");
    articleLibraryId = await page.$eval("[data-mode-library-id]", (element) => element.getAttribute("data-mode-library-id"));
    if (!articleLibraryId || articleLibraryId === meetingLibraryId) throw new Error("Article and meeting boards share the same knowledge library");
    const articleLibrary = await page.evaluate((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return { map: state.maps.find((map) => map.id === mapId), nodes: state.nodes[mapId] || [] };
    }, articleLibraryId);
    if (articleLibrary?.map?.mode !== "article") throw new Error("Article board did not enter its own explicit-mode knowledge library");
    if (articleLibrary.nodes.some((node) => node.content.includes("知识助手发布计划"))) throw new Error("Meeting content leaked into the article library");
    const fileInput = await page.waitForSelector('input[type="file"][accept*="pdf"]');
    await fileInput.uploadFile(pdfPath);
    await page.waitForFunction(() => document.body.innerText.includes("已读取 2 页"));
    await clickByText(page, "button", "解析文章");
    await page.waitForSelector('[data-testid="answer-card"]');
    await page.waitForSelector('[data-testid="article-source-status"][data-source-type="pdf"]');
    const sourceStatus = await page.$eval('[data-testid="article-source-status"]', (element) => element.textContent);
    if (!sourceStatus.includes("PDF 文字已提取") || !sourceStatus.includes("可定位证据块")) throw new Error(`Article source verification is unclear: ${sourceStatus}`);
    await page.waitForSelector('[data-testid="answer-card"] [data-testid="citation-chip"]');
    const answerSections = await page.$$eval('[data-testid="answer-card"] > section', (sections) => sections.map((section) => section.getAttribute("data-testid")));
    if (!["answer-conclusion", "answer-evidence", "answer-extension"].every((section) => answerSections.includes(section))) throw new Error(`Article answer sections are incomplete: ${answerSections.join(", ")}`);
    const claimToggleCount = await page.$$eval('[data-testid="answer-card"] [data-testid="answer-claims-toggle"]', (toggles) => toggles.length);
    if (claimToggleCount !== 1) throw new Error(`Expected one progressive conclusion toggle, got ${claimToggleCount}`);
    const collapsedClaimCount = await page.$$eval('[data-testid="answer-card"] [data-claim-status]', (claims) => claims.length);
    await page.click('[data-testid="answer-card"] [data-testid="answer-claims-toggle"]');
    await page.waitForFunction((previous) => document.querySelectorAll('[data-testid="answer-card"] [data-claim-status]').length > previous, {}, collapsedClaimCount);
    await page.hover('[data-testid="answer-card"] [data-testid="citation-chip"]');
    await page.waitForSelector('[data-testid="answer-card"] [data-testid="citation-tooltip"]', { visible: true });
    const citationIndex = await page.$eval('[data-testid="answer-card"] [data-testid="citation-chip"]', (chip) => chip.getAttribute("data-citation-index"));
    await page.click('[data-testid="answer-card"] [data-testid="citation-chip"]');
    await page.waitForFunction((index) => document.querySelector(`[data-testid="citation-evidence"][data-citation-index="${index}"]`)?.getAttribute("data-highlighted") === "true", {}, citationIndex);
    await page.waitForSelector('[data-testid="pdf-viewer"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="pdf-viewer-page"]')?.textContent?.includes("/ 2"));
    const pdfViewerPage = await page.$eval('[data-testid="pdf-viewer"]', (viewer) => viewer.getAttribute("data-pdf-page"));
    if (pdfViewerPage !== "1") throw new Error(`PDF citation opened on page ${pdfViewerPage} instead of page 1`);
    try {
      await page.waitForSelector('.mindgrow-pdf-container .textLayer .highlight', { timeout: 15000 });
    } catch {
      const diagnostics = await page.evaluate(() => ({
        status: document.querySelector('[data-testid="pdf-viewer-status"]')?.textContent,
        query: document.querySelector('input[aria-label="PDF 原文搜索"]')?.value,
        page: document.querySelector('[data-testid="pdf-viewer"]')?.getAttribute("data-pdf-page"),
        renderedPages: document.querySelectorAll('.mindgrow-pdf-container .page').length,
        textLayers: document.querySelectorAll('.mindgrow-pdf-container .textLayer').length,
        text: Array.from(document.querySelectorAll('.mindgrow-pdf-container .textLayer')).map((layer) => layer.textContent).join(" ").slice(0, 600),
      }));
      await page.screenshot({ path: path.join(artifactDir, "pdf-viewer-highlight-failure.png"), fullPage: true });
      throw new Error(`PDF findController did not render a highlight: ${JSON.stringify(diagnostics)}`);
    }
    if (!await page.$('button[aria-label^="在 PDF 中定位引用"]')) throw new Error("PDF citation evidence has no explicit source-viewer action");
    const urlBeforePdfClose = page.url();
    if (urlBeforePdfClose.includes("/universe")) throw new Error(`PDF viewer navigated away before close: ${urlBeforePdfClose}`);
    await page.click('button[aria-label="关闭 PDF 原文查看"]');
    await page.waitForSelector('[data-testid="pdf-viewer"]', { hidden: true });
    try {
      await page.waitForFunction(() => document.body.innerText.includes("图谱增强检索（GraphRAG）论文结构预览"), { timeout: 5000 });
    } catch {
      const diagnostics = await page.evaluate(() => ({
        url: location.href,
        workspace: Boolean(document.querySelector('[data-testid="article-workspace"]')),
        answer: Boolean(document.querySelector('[data-testid="answer-card"]')),
        titleMatches: document.body.innerText.includes("图谱增强检索（GraphRAG）论文结构预览"),
        articleText: document.querySelector('[data-testid="article-content-workspace"]')?.textContent?.slice(0, 1000),
        bodyText: document.body.innerText.slice(0, 1000),
      }));
      throw new Error(`Article result disappeared after closing the PDF viewer: ${JSON.stringify(diagnostics)}`);
    }
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 3);
    if (!await page.$('input[aria-label="搜索论文链路"]')) throw new Error("Paper link navigator search is missing");
    if (!await page.$('textarea[aria-label="与文章知识库对话"]')) throw new Error("Article-library conversation input is missing");
    if (!await page.evaluate(() => document.body.innerText.includes("自动识别翻译、总结、解释、比较、信息提取与事实问答"))) throw new Error("Article task guidance is missing");
    const articleTaskCategories = await page.$$eval('[aria-label="文章问答任务分类"] button', (buttons) => buttons.map((button) => button.textContent.trim()));
    if (articleTaskCategories.length !== 6 || !["翻译", "总结", "比较", "提取", "解释", "问答"].every((label) => articleTaskCategories.some((item) => item.includes(label)))) throw new Error(`Article task categories are unclear: ${articleTaskCategories.join(", ")}`);
    await clickByText(page, "button", "生成音频概览");
    await page.waitForFunction(() => document.body.innerText.includes("音频概览 ·"));
    const audioGrounding = await page.$eval('[data-testid="audio-grounding-status"]', (element) => element.textContent);
    if (!audioGrounding.includes("引用核验通过") || !audioGrounding.includes("全部绑定原文证据")) throw new Error(`Audio evidence status is missing: ${audioGrounding}`);
    await clickByText(page, "button", "保存到文章知识库");
    await page.waitForFunction(() => document.body.innerText.includes("文章知识节点"));
    await page.type('textarea[aria-label="与文章知识库对话"]', "翻译这篇论文");
    await clickByText(page, "button", "发送");
    await page.waitForFunction(() => document.body.innerText.includes("论文翻译"));
    await page.waitForFunction(() => document.body.innerText.includes("已识别为翻译任务"));
    await page.type('textarea[aria-label="与文章知识库对话"]', "这篇论文为什么强调引用？");
    const articleQuestionSent = await page.$eval('textarea[aria-label="与文章知识库对话"]', (textarea) => {
      const send = textarea.parentElement?.querySelector("button");
      if (!send) return false;
      send.click();
      return true;
    });
    if (!articleQuestionSent) throw new Error("Article-library send action is missing");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="structured-answer"] h4').length > 0);
    const structuredHeading = await page.$$eval('[data-testid="structured-answer"]', (answers) => answers.at(-1)?.querySelector("section[data-answer-section]")?.getAttribute("data-answer-section"));
    if (structuredHeading !== "结论") throw new Error(`Structured answer did not put the conclusion first: ${structuredHeading}`);
    await page.$$eval('[data-testid="structured-answer"]', (answers) => answers.at(-1)?.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(artifactDir, "desktop-article-structured-answer.png"), fullPage: true });
  });

  await check("LLM Wiki entity graph exposes typed relations with verbatim evidence", async () => {
    const entityStage = async (label, task) => {
      try { return await task(); } catch (error) { throw new Error(`${label}: ${error.message}`); }
    };
    const storedGraph = await page.evaluate((mapId) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).entityGraphs?.[mapId], articleLibraryId);
    if (!storedGraph?.entities?.length || !storedGraph?.relations?.length) throw new Error("Saved article has no entity graph");
    await clickByText(page, '[data-testid="graph-layer-switch"] button', "实体图");
    await page.waitForFunction(() => document.body.innerText.includes("实体知识图谱"));
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 2 && document.querySelectorAll(".react-flow__edge").length >= 1);
    await page.waitForSelector('[data-testid="entity-view-modes"]');
    const entityQuery = storedGraph.entities[0].canonicalName;
    const networkSummary = await page.$eval('[data-testid="entity-network-summary"]', (element) => element.textContent);
    if (!networkSummary.includes("强关系") || !networkSummary.includes("无强关系实体已隐藏")) throw new Error(`Default entity graph is not the strong-relation view: ${networkSummary}`);
    const globalNodeCount = await page.$$eval('[data-testid="entity-network-node"]', (nodes) => nodes.length);
    if (globalNodeCount < 2) throw new Error("Obsidian entity network did not render enough entities");
    let hoveredEntityNode = null;
    for (const node of await page.$$('[data-testid="entity-network-node"]')) {
      const box = await node.boundingBox();
      if (!box || box.width < 2 || box.height < 2 || box.x < 0 || box.y < 0) continue;
      const viewport = page.viewport();
      if (viewport && (box.x + box.width > viewport.width || box.y + box.height > viewport.height)) continue;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const hoverVisible = await page.waitForFunction(() => {
        const card = document.querySelector('[data-testid="entity-hover-card"]');
        return card && getComputedStyle(card).display !== "none";
      }, { timeout: 1200 }).then(() => true).catch(() => false);
      if (hoverVisible) { hoveredEntityNode = node; break; }
    }
    if (!hoveredEntityNode) throw new Error("No visible entity node exposed its hover explanation");
    await hoveredEntityNode.evaluate((node) => {
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });
    await page.waitForSelector('[data-testid="entity-detail-panel"]');
    const entityDetailText = await page.$eval('[data-testid="entity-detail-panel"]', (panel) => panel.textContent);
    if (!entityDetailText.includes("说明专属证据") || !entityDetailText.includes("相关关系")) throw new Error("Entity detail does not separate definition evidence from relations");
    if (!entityDetailText.includes("在本图定位") || !entityDetailText.includes("进入所属知识库")) throw new Error("Entity detail actions are not distinct");
    const dedicatedEvidenceCount = await page.$$eval('[data-testid="entity-detail-panel"] blockquote', (quotes) => quotes.length);
    if (dedicatedEvidenceCount < 1) throw new Error("Entity description has no dedicated evidence quote");
    const localNodeCount = await page.$$eval('[data-testid="entity-network-node"]', (nodes) => nodes.length);
    if (localNodeCount > globalNodeCount) throw new Error("One-hop entity view expanded beyond the global graph");
    await page.screenshot({ path: path.join(artifactDir, "desktop-entity-network.png") });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[data-testid="entity-detail-panel"]'));
    await entityStage("图内实体搜索", async () => {
      await page.click('button[aria-label="搜索与过滤实体"]');
      await page.waitForSelector('[data-testid="entity-network-tools"]');
      await page.type('[data-testid="entity-network-search"]', entityQuery);
      await page.waitForSelector('[data-testid="entity-network-search-result"]');
      const graphSearchResult = await page.$eval('[data-testid="entity-network-search-result"]', (element) => element.textContent);
      if (!graphSearchResult.includes(entityQuery)) throw new Error("Graph-native search did not match the entity name");
      await page.click('[data-testid="entity-network-search-result"]');
      await page.waitForSelector('[data-testid="entity-detail-panel"]');
      const graphSearchDetail = await page.$eval('[data-testid="entity-detail-panel"]', (panel) => panel.textContent);
      if (!graphSearchDetail.includes(entityQuery)) throw new Error("Graph-native search did not enter the selected entity's one-hop view");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[data-testid="entity-detail-panel"]'));
    });
    await entityStage("实体类型筛选", async () => {
      await clickByText(page, '[data-testid="entity-view-modes"] button', "全局强关系");
      await page.click('button[aria-label="搜索与过滤实体"]');
      await page.waitForSelector('[data-testid="entity-network-type-filters"] button[data-entity-type="concept"]');
      await page.click('[data-testid="entity-network-type-filters"] button[data-entity-type="concept"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="entity-network-summary"]')?.textContent.includes("已筛选 1 种类型"));
      const conceptFilterPressed = await page.$eval('[data-testid="entity-network-type-filters"] button[data-entity-type="concept"]', (button) => button.getAttribute("aria-pressed"));
      if (conceptFilterPressed !== "true") throw new Error("Entity type filter did not expose its active state");
      await page.click('[data-testid="entity-network-type-filters"] button[data-entity-type="concept"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="entity-network-summary"]')?.textContent.includes("已筛选"));
    });
    await entityStage("孤立实体开关", async () => {
      await page.click('[data-testid="entity-network-show-isolated"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="entity-network-show-isolated"]')?.getAttribute("aria-pressed") === "true");
      await page.click('[data-testid="entity-network-show-isolated"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="entity-network-show-isolated"]')?.getAttribute("aria-pressed") === "false");
      await page.click('button[aria-label="搜索与过滤实体"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="entity-network-tools"]'));
    });
    await entityStage("Ctrl+K 实体定位", async () => {
      await page.evaluate(() => {
        window.__mindgrowEntityCommandEvents = [];
        window.addEventListener("mindgrow:command-navigate", (event) => window.__mindgrowEntityCommandEvents.push({ type: "navigate", detail: event.detail }), { once: true });
        window.addEventListener("mindgrow:command-entity-focus", (event) => window.__mindgrowEntityCommandEvents.push({ type: "focus", detail: event.detail }), { once: true });
      });
      await entityStage("Ctrl+K 打开", async () => {
        await page.keyboard.down("Control");
        await page.keyboard.press("k");
        await page.keyboard.up("Control");
        await page.waitForSelector('[data-testid="command-palette"] input');
      });
      await entityStage("Ctrl+K 搜索结果", async () => {
        await page.$eval('[data-testid="command-palette"] input', (input, query) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(input, query);
          input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: query }));
        }, entityQuery);
        await page.waitForSelector('[data-result-group="entities"] [data-result-kind="entity"]');
      });
      await entityStage("Ctrl+K 详情定位", async () => {
        try {
          await page.$eval('[data-result-group="entities"] [data-result-kind="entity"]', (button) => button.click());
          await page.waitForSelector('[data-testid="entity-detail-panel"]', { timeout: 6000 });
        } catch (error) {
          const diagnostic = await page.evaluate(() => ({
            events: window.__mindgrowEntityCommandEvents,
            layer: document.querySelector('[data-testid="graph-layer-switch"]')?.textContent,
            network: document.querySelector('[data-testid="entity-network-summary"]')?.textContent,
            paletteOpen: Boolean(document.querySelector('[data-testid="command-palette"]')),
          }));
          throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
        }
        const commandEntityTitle = await page.$eval('[data-testid="entity-detail-panel"]', (panel) => panel.textContent);
        if (!commandEntityTitle.includes(entityQuery)) throw new Error("Command palette did not focus the selected entity");
        await page.waitForFunction(() => !document.querySelector('[data-testid="command-palette"]'), { timeout: 6000 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        try {
          await page.click('[data-testid="entity-detail-panel"] button[aria-label="关闭实体详情"]');
          await page.waitForFunction(() => !document.querySelector('[data-testid="entity-detail-panel"]'), { timeout: 6000 });
        } catch (error) {
          const diagnostic = await page.evaluate(() => ({
            events: window.__mindgrowEntityCommandEvents,
            paletteOpen: Boolean(document.querySelector('[data-testid="command-palette"]')),
            entityPanelOpen: Boolean(document.querySelector('[data-testid="entity-detail-panel"]')),
            entityPanelCount: document.querySelectorAll('[data-testid="entity-detail-panel"]').length,
          }));
          throw new Error(`${error.message}; closeDiagnostic=${JSON.stringify(diagnostic)}`);
        }
      });
    });
    await entityStage("关系证据链", async () => {
      await clickByText(page, '[data-testid="entity-view-modes"] button', "证据链");
      await page.waitForFunction(() => {
        const evidenceButton = Array.from(document.querySelectorAll('[data-testid="entity-view-modes"] button'))
          .find((button) => button.textContent.includes("证据链"));
        return evidenceButton?.className.includes("bg-violet-400");
      });
      await page.waitForSelector(".react-flow__edge-interaction");
      await page.hover(".react-flow__edge-interaction");
      await page.waitForFunction(() => Boolean(document.querySelector(".react-flow__edge-text")?.textContent.trim()));
      if (await page.$('[data-testid="relation-evidence-panel"]')) throw new Error("Relation hover opened the evidence card before click");
      await page.$eval(".react-flow__edge-interaction", (edgeInteraction) => {
        edgeInteraction.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      });
      await page.waitForSelector('[data-testid="relation-evidence-panel"]');
      const evidence = await page.$eval('[data-testid="relation-evidence-panel"]', (panel) => panel.textContent);
      if (!evidence.includes("关系原文证据")) throw new Error("Relation evidence panel has no traceability heading");
      const evidenceSource = await page.$eval('[data-testid="relation-evidence-citation"]', (card) => ({
        locator: card.querySelector('[data-testid="relation-evidence-locator"]')?.textContent?.trim(),
        quote: card.querySelector("blockquote")?.textContent?.trim(),
      }));
      if (!evidenceSource.locator || !evidenceSource.quote) throw new Error(`Relation evidence has no source locator or quote: ${JSON.stringify(evidenceSource)}`);
    });
    await clickByText(page, '[data-testid="graph-layer-switch"] button', "概念图");
    await page.waitForFunction(() => !document.body.innerText.includes("实体知识图谱"));
  });

  await check("article project cards keep the latest navigation target", async () => {
    await page.click('button[title="新建知识库"]');
    await page.waitForSelector('input[placeholder="知识库名称..."]');
    await page.type('input[placeholder="知识库名称..."]', "论文图谱测试库");
    await clickByText(page, "button", "创建");
    await page.waitForFunction(() => document.body.innerText.includes("论文图谱测试库"));
    const targetMapId = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return state.maps.find((map) => map.name === "论文图谱测试库")?.id || "";
    });
    if (!targetMapId) throw new Error("New article project was not created");
    const oldMapName = await page.evaluate((mapId) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).maps.find((map) => map.id === mapId)?.name || "", articleLibraryId);
    const oldCard = await page.$(`button[aria-label="打开知识库 ${oldMapName}"]`);
    const newCard = await page.$('button[aria-label="打开知识库 论文图谱测试库"]');
    if (!oldCard || !newCard) throw new Error("Article project cards are missing");
    await oldCard.click();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await newCard.click();
    await page.waitForFunction((expected) => document.querySelector("[data-mode-library-id]")?.getAttribute("data-mode-library-id") === expected, {}, targetMapId);
    if (!await page.$('[data-testid="knowledge-graph-workspace"][data-graph-mode="article"]')) throw new Error("Article graph disappeared after project navigation");
    const repeatedFile = await page.waitForSelector('input[type="file"][accept*="pdf"]');
    await repeatedFile.uploadFile(pdfPath);
    await page.waitForFunction(() => document.body.innerText.includes("已读取 2 页"));
    await clickByText(page, "button", "解析文章");
    await page.waitForSelector('[data-testid="answer-card"]');
    await clickByText(page, "button", "保存到文章知识库");
    await page.waitForFunction(() => document.body.innerText.includes("文章知识节点"));
  });

  await check("top product tabs switch both content and graph without cross-board residue", async () => {
    const switchDurations = [];
    for (const [label, mode] of [["会议助手", "meeting"], ["知识碎片", "knowledge"], ["文章解析", "article"]]) {
      const startedAt = Date.now();
      await clickByText(page, "button", label);
      await page.waitForSelector(`[data-testid="knowledge-graph-workspace"][data-graph-mode="${mode}"]`);
      await page.waitForFunction((expectedMode) => {
        const id = document.querySelector("[data-mode-library-id]")?.getAttribute("data-mode-library-id");
        if (!id && expectedMode === "knowledge") return true;
        const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
        const map = state.maps.find((item) => item.id === id);
        if (!map) return false;
        return map.mode === expectedMode;
      }, {}, mode);
      switchDurations.push(Date.now() - startedAt);
    }
    const slowestSwitch = Math.max(...switchDurations);
    if (slowestSwitch > 1500) throw new Error(`Warm product switch took ${slowestSwitch}ms: ${switchDurations.join(", ")}`);
    process.stdout.write(`  product switch latency: ${switchDurations.join("ms, ")}ms\n`);
    await clickByText(page, "button", "会议助手");
    await clickByText(page, "button", "知识碎片");
    await clickByText(page, "button", "文章解析");
    await page.waitForSelector('[data-testid="knowledge-graph-workspace"][data-graph-mode="article"]');
    const finalMode = await page.$eval('[data-testid="knowledge-graph-workspace"]', (element) => element.getAttribute("data-graph-mode"));
    if (finalMode !== "article") throw new Error(`Rapid tab switch ended in ${finalMode}`);
  });

  await check("one-click organizer previews, applies, and restores the prior structure", async () => {
    await clickByText(page, "button", "知识碎片");
    await page.waitForSelector('[data-testid="knowledge-graph-workspace"][data-graph-mode="knowledge"]');
    const beforeState = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return {
        assignments: Object.fromEntries(state.maps.filter((map) => !(map.description || "").includes("[MindGrow:")).map((map) => [map.id, map.categoryId || null])),
        categoryIds: state.categories.map((category) => category.id).sort(),
      };
    });
    await page.click('[data-testid="open-library-organizer"]');
    await page.waitForSelector('[data-testid="organize-library-dialog"]');
    const applyDisabledBeforePreview = await page.$eval('[data-testid="organize-apply"]', (button) => button.disabled);
    if (!applyDisabledBeforePreview) throw new Error("Organizer could mutate the library without a preview");
    await page.click('[data-testid="organize-close"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="organize-library-dialog"]'));
    const stateAfterClose = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return {
        assignments: Object.fromEntries(state.maps.filter((map) => !(map.description || "").includes("[MindGrow:")).map((map) => [map.id, map.categoryId || null])),
        categoryIds: state.categories.map((category) => category.id).sort(),
      };
    });
    if (JSON.stringify(beforeState) !== JSON.stringify(stateAfterClose)) throw new Error("Opening and closing the organizer changed the library");
    await page.click('[data-testid="open-library-organizer"]');
    await page.waitForSelector('[data-testid="organize-library-dialog"]');
    await page.click('[data-testid="organize-mode-workflow"]');
    await page.click('[data-testid="organize-create-preview"]');
    await page.waitForSelector('[data-testid="organize-preview"]');
    const previewCategoryCount = await page.$$eval('[data-testid="organize-preview"] input', (inputs) => inputs.length);
    if (previewCategoryCount < 1) throw new Error("Organizer preview did not create any directory");
    const assignmentSelectCount = await page.$$eval('[data-testid="organize-preview"] select', (selects) => selects.length);
    await page.$eval('[data-testid="organize-preview"] select', (select) => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForSelector('[data-testid="organize-kept-maps"]');
    if (assignmentSelectCount === 1) {
      const fallbackCategory = await page.$eval('[data-testid="organize-kept-maps"] select', (select) => Array.from(select.options).find((option) => option.value)?.value || "");
      if (!fallbackCategory) throw new Error("Organizer preview did not expose a category for manual reassignment");
      await page.select('[data-testid="organize-kept-maps"] select', fallbackCategory);
    }
    await page.waitForFunction(() => !document.querySelector('[data-testid="organize-apply"]')?.disabled);
    await page.screenshot({ path: path.join(artifactDir, "desktop-organizer-preview.png") });
    await page.click('[data-testid="organize-apply"]');
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-testid="organize-status"]')?.textContent || "";
      return text.includes("已整理") || text.includes("未完成") || text.includes("填写") || text.includes("不能重复");
    });
    const applyStatus = await page.$eval('[data-testid="organize-status"]', (element) => element.textContent || "");
    if (!applyStatus.includes("已整理")) throw new Error(`Organizer apply failed after manual adjustment: ${applyStatus}`);
    await page.click('[data-testid="organize-undo"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="organize-status"]')?.textContent.includes("已恢复"));
    const afterState = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return {
        assignments: Object.fromEntries(state.maps.filter((map) => !(map.description || "").includes("[MindGrow:")).map((map) => [map.id, map.categoryId || null])),
        categoryIds: state.categories.map((category) => category.id).sort(),
      };
    });
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) throw new Error("Undo did not restore knowledge-library categories");
    await page.click('[data-testid="organize-close"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="organize-library-dialog"]'));
  });

  await check("all three product boards expose and execute inline library deletion", async () => {
    for (const [label, mode, name] of [["文章解析", "article", "待删除文章库"], ["会议助手", "meeting", "待删除会议库"], ["知识碎片", "knowledge", "待删除知识库"]]) {
      await clickByText(page, "button", label);
      await page.waitForSelector(`[data-testid="knowledge-graph-workspace"][data-graph-mode="${mode}"]`);
      await page.click('button[title="新建知识库"]');
      await page.waitForSelector('input[placeholder="知识库名称..."]');
      await page.type('input[placeholder="知识库名称..."]', name);
      await clickByText(page, "button", "创建");
      await page.waitForSelector(`button[aria-label="删除知识库 ${name}"]`);
      await page.click(`button[aria-label="删除知识库 ${name}"]`);
      await page.waitForFunction((libraryName) => document.querySelector('[role="dialog"]')?.textContent.includes(libraryName), {}, name);
      await clickByText(page, "button", "确认删除");
      await page.waitForFunction((libraryName) => {
        const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
        return !state.maps.some((map) => map.name === libraryName);
      }, {}, name);
      if (await page.$(`button[aria-label="删除知识库 ${name}"]`)) throw new Error(`${name} still appears after deletion`);
    }
  });

  await check("real research PDF preserves pages and reports visual structures", async () => {
    if (!fs.existsSync(realPaperPath)) throw new Error("LayoutLMv3 test paper is missing");
    await clickByText(page, "button", "文章解析");
    await page.waitForSelector('[data-testid="article-content-workspace"]');
    const fileInput = await page.waitForSelector('input[type="file"][accept*="pdf"]');
    await fileInput.uploadFile(realPaperPath);
    await page.waitForFunction(() => document.body.innerText.includes("已读取 10 页"));
    const extraction = await page.$eval('textarea[placeholder*="PDF 文字"]', (element) => ({
      hasPageTwo: element.value.includes("[第 2 页]"),
      hasLineBreaks: element.value.split("\n").length > 100,
      length: element.value.length,
    }));
    if (!extraction.hasPageTwo || !extraction.hasLineBreaks || extraction.length < 20000) throw new Error(`PDF layout extraction is incomplete: ${JSON.stringify(extraction)}`);
    await clickByText(page, "button", "解析文章");
    await page.waitForFunction(() => document.body.innerText.includes("文档解析覆盖"));
    await page.waitForSelector('[data-testid="answer-card"]');
    const coverageText = await page.evaluate(() => document.body.innerText);
    if (!coverageText.includes("图片页：")) throw new Error("Image-page diagnostics are missing");
    if (!coverageText.includes("关键结论支持")) throw new Error("Per-claim citation support audit is missing");
    const sourceAction = await page.$('button[aria-label^="在 PDF 中定位引用"]');
    if (!sourceAction) throw new Error("Real PDF citations have no source-viewer action");
    await sourceAction.click();
    await page.waitForSelector('[data-testid="pdf-viewer"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="pdf-viewer-page"]')?.textContent?.includes("/ 10"));
    await page.click('button[aria-label="关闭 PDF 原文查看"]');
    await page.waitForSelector('[data-testid="pdf-viewer"]', { hidden: true });
    await page.screenshot({ path: path.join(artifactDir, "layoutlmv3-document-coverage.png"), fullPage: true });
  });

  await check("mobile bottom navigation stays clear on iPhone SE and keeps graph access", async () => {
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: "networkidle0" });
    await page.click('[data-testid="mobile-bottom-nav"] button[aria-label="切换到知识碎片"]');
    const mobileBreadcrumb = await page.$('[data-testid="mobile-breadcrumb-bar"] [data-testid="product-breadcrumb"]');
    if (!mobileBreadcrumb) throw new Error("Mobile knowledge-base breadcrumb is missing");
    const mobileBreadcrumbLabel = await mobileBreadcrumb.$eval("button span.truncate", (label) => label.textContent.trim());
    if (mobileBreadcrumbLabel.length > 12) throw new Error(`Mobile breadcrumb was not shortened: ${mobileBreadcrumbLabel}`);
    const hasTextarea = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    if (!hasTextarea) throw new Error("Mobile chat input missing");
    const navigationCount = await page.$$eval('[data-testid="mobile-bottom-nav"]', (elements) => elements.length);
    if (navigationCount !== 1 || await page.$('[data-testid="mobile-product-tabs"]')) throw new Error("Mobile product navigation is duplicated");
    const safeAreaStyle = await page.$eval('[data-testid="mobile-bottom-nav"]', (element) => element.getAttribute("style") || "");
    if (!safeAreaStyle.includes("safe-area-inset-bottom")) throw new Error("Mobile bottom navigation does not reserve the device safe area");
    const [inputBox, contentBox, navigationBox] = await Promise.all([
      hasTextarea.boundingBox(),
      page.$eval('[data-testid="mobile-content-region"]', (element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
      page.$eval('[data-testid="mobile-bottom-nav"]', (element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    ]);
    if (contentBox.y + contentBox.height > navigationBox.y) throw new Error("Mobile bottom navigation overlaps the scrollable content and citation region");
    if (!inputBox || inputBox.y + inputBox.height > navigationBox.y) throw new Error("Mobile bottom navigation obscures the chat input");
    await page.click('[data-testid="mobile-bottom-nav"] button[aria-label="切换到会议助手"]');
    await page.waitForFunction(() => document.body.innerText.includes("独立会议知识库"));
    const meetingHasMapTab = await page.$$eval("button", (buttons) => buttons.some((button) => button.textContent.includes("图谱")));
    if (!meetingHasMapTab || await page.$(".react-flow")) throw new Error("Mobile meeting graph tab behavior is incorrect");
    await page.click('[data-testid="mobile-view-toolbar"] button[aria-label="查看知识图谱"]');
    await page.waitForSelector('[data-testid="knowledge-graph-workspace"][data-graph-mode="meeting"]');
    await page.click('[data-testid="mobile-bottom-nav"] button[aria-label="切换到知识碎片"]');
    await page.waitForSelector('textarea[aria-label="输入知识或向知识库提问"]');
    await page.click('[data-testid="mobile-view-toolbar"] button[aria-label="查看知识图谱"]');
    await page.waitForSelector(".react-flow");
    await page.waitForSelector(".mindgrow-minimap");
    await page.waitForFunction(() => document.body.innerText.includes("当前显示") && document.body.innerText.includes("＋N 逐层展开"));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error("Mobile layout overflows horizontally");
    const minimap = await page.$(".mindgrow-minimap");
    const box = await minimap.boundingBox();
    if (!box || box.width < 100 || box.width > 150) throw new Error("Mobile minimap is missing its compact size");
    await page.screenshot({ path: path.join(artifactDir, "mobile-map.png"), fullPage: true });
    const beforeTransform = await page.$eval(".react-flow__viewport", (element) => element.style.transform);
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.65, { steps: 5 });
    await page.mouse.up();
    const afterTransform = await page.$eval(".react-flow__viewport", (element) => element.style.transform);
    if (afterTransform === beforeTransform) throw new Error("Dragging the mobile minimap did not pan the canvas");
    await page.$eval(".react-flow__controls-fitview", (button) => button.click());
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  await check("mobile floating New creates a library in the current board", async () => {
    await page.click('[data-testid="mobile-bottom-nav"] button[aria-label="切换到会议助手"]');
    await page.waitForFunction(() => document.body.innerText.includes("独立会议知识库"));
    await page.click('[data-testid="mobile-create-library"]');
    const name = `移动会议库-${Date.now()}`;
    await page.waitForSelector('input[placeholder="知识库名称..."]');
    await page.type('input[placeholder="知识库名称..."]', name);
    await clickByText(page, "button", "创建");
    await page.waitForFunction((libraryName) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return state.maps.some((map) => map.name === libraryName && map.mode === "meeting");
    }, {}, name);
    await page.waitForSelector('[data-testid="meeting-content-workspace"]');
    const createLabel = await page.$eval('[data-testid="mobile-create-library"]', (button) => button.getAttribute("aria-label"));
    if (createLabel !== "在会议助手中新建知识库") throw new Error(`Floating New lost current-board scope: ${createLabel}`);
  });

  await check("mobile template creation uses the shared graph loader once", async () => {
    await page.click('[data-testid="mobile-bottom-nav"] button[aria-label="切换到知识碎片"]');
    await page.waitForSelector('textarea[aria-label="输入知识或向知识库提问"]');
    const existingMapIds = await page.evaluate(() => JSON.parse(localStorage.getItem("mindgrow.local.v2")).maps.map((map) => map.id));
    await page.evaluate(() => {
      window.__mindgrowLocalGraphRequests = [];
      window.__mindgrowLocalGraphCapture = (event) => {
        const detail = event.detail || {};
        const url = new URL(detail.path || "", window.location.origin);
        const mapId = url.searchParams.get("mapId");
        if (detail.method === "GET" && url.pathname.endsWith("/api/knowledge") && mapId) window.__mindgrowLocalGraphRequests.push(mapId);
      };
      window.addEventListener("mindgrow:local-api-request", window.__mindgrowLocalGraphCapture);
    });
    try {
      await page.click(".drawer-toggle-btn");
      await page.waitForSelector('[data-testid="mobile-template-browser-open"]');
      await page.click('[data-testid="mobile-template-browser-open"]');
      await page.waitForSelector('[data-testid="template-browser"]');
      await page.click('[data-testid="template-card-tpl_project_mgmt"]');
      await page.waitForSelector('[data-testid="template-use"]');
      await page.click('[data-testid="template-use"]');
      await page.waitForFunction((knownIds) => {
        const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
        return state.maps.some((map) => !knownIds.includes(map.id));
      }, {}, existingMapIds);
      const created = await page.evaluate((knownIds) => {
        const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
        const map = state.maps.find((candidate) => !knownIds.includes(candidate.id));
        return { id: map?.id || "", root: state.nodes[map?.id]?.[0]?.content || "" };
      }, existingMapIds);
      if (!created.id || !created.root) throw new Error("Template did not create a populated knowledge library");
      await page.click('[data-testid="mobile-view-toolbar"] button[aria-label="查看知识图谱"]');
      await page.waitForFunction((root) => document.body.innerText.includes(root), {}, created.root);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const requestCount = await page.evaluate((mapId) => window.__mindgrowLocalGraphRequests.filter((candidate) => candidate === mapId).length, created.id);
      if (requestCount !== 1) throw new Error(`Expected one shared-loader request for ${created.id}, got ${requestCount}`);
    } finally {
      await page.evaluate(() => {
        window.removeEventListener("mindgrow:local-api-request", window.__mindgrowLocalGraphCapture);
        delete window.__mindgrowLocalGraphCapture;
        delete window.__mindgrowLocalGraphRequests;
      });
    }
  });

  await check("knowledge universe keeps board isolation and supports zoom", async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/universe?mode=article`, { waitUntil: "networkidle0", timeout: 30000 });
    await page.waitForSelector('[data-testid="universe-view"][data-universe-mode="article"]');
    await page.waitForFunction(() => document.body.innerText.includes("文章解析宇宙") && document.body.innerText.includes("跨库关系"));
    const crossLibraryCount = await page.$eval('[data-testid="universe-cross-library-count"]', (element) => Number(element.getAttribute("data-count") || 0));
    if (crossLibraryCount < 1) throw new Error("Shared article concepts did not produce a cross-library relationship");
    const headerCount = await page.$$eval("header", (headers) => headers.length);
    if (headerCount !== 1) throw new Error(`Expected one application header, got ${headerCount}`);
    const hasBackButton = await page.evaluate(() => document.body.innerText.includes("返回当前知识库"));
    if (!hasBackButton) throw new Error("Universe navigation is incomplete");
    const scopeSwitchStartedAt = Date.now();
    await clickByText(page, '[data-testid="universe-scope-switch"] button', "全部知识");
    await page.waitForSelector('[data-testid="universe-view"][data-universe-mode="all"]');
    const scopeSwitchDuration = Date.now() - scopeSwitchStartedAt;
    if (scopeSwitchDuration > 1000) throw new Error(`Universe scope switch took ${scopeSwitchDuration}ms`);
    process.stdout.write(`  universe scope latency: ${scopeSwitchDuration}ms\n`);
    const allScopeText = await page.$eval('[data-testid="universe-view"]', (element) => element.textContent);
    if (!allScopeText.includes("文章") || !allScopeText.includes("会议")) throw new Error("Unified universe does not expose article and meeting knowledge");
    await clickByText(page, '[data-testid="universe-scope-switch"] button', "文章");
    await page.waitForSelector('[data-testid="universe-view"][data-universe-mode="article"]');
    const beforeZoom = await page.$eval('button[aria-label="重置知识宇宙视图"]', (button) => button.textContent.trim());
    await page.click('button[aria-label="放大知识宇宙"]');
    const afterZoom = await page.$eval('button[aria-label="重置知识宇宙视图"]', (button) => button.textContent.trim());
    if (beforeZoom === afterZoom) throw new Error("Universe zoom control did not update the viewport");
    await clickByText(page, "button", "会议助手");
    await page.waitForSelector('[data-testid="universe-view"][data-universe-mode="meeting"]');
    await page.waitForFunction(() => document.body.innerText.includes("会议助手宇宙"));
  });

  await check("SEO guide is indexable and readable", async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/guide`, { waitUntil: "networkidle0", timeout: 30000 });
    const h1 = await page.$eval("h1", (element) => element.textContent.trim());
    const title = await page.title();
    if (!h1.includes("可追溯的知识网络")) throw new Error(`Unexpected guide heading: ${h1}`);
    if (!title.includes("AI 知识助手使用指南")) throw new Error(`Unexpected guide title: ${title}`);
    const timelineSteps = await page.$$eval('[data-testid="guide-timeline"] ol > li', (steps) => steps.length);
    if (timelineSteps < 4) throw new Error("Visual guide timeline is incomplete");
  });

  await check("robots and sitemap endpoints render", async () => {
    const result = await page.evaluate(async (basePath) => {
      const [robots, sitemap] = await Promise.all([
        fetch(`${basePath}/robots.txt`).then((response) => response.text()),
        fetch(`${basePath}/sitemap.xml`).then((response) => response.text()),
      ]);
      return { robots, sitemap };
    }, BASE_PATH);
    if (!result.robots.includes("sitemap.xml")) throw new Error("robots.txt has no sitemap");
    if (!result.sitemap.includes("/guide/")) throw new Error("sitemap has no guide URL");
  });

  await check("new-user empty state routes all three real onboarding flows", async () => {
    const onboardingKey = "mindgrow:onboarding:v1:tenant:local-user:local-workspace";
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="knowledge-workspace"]');
    const original = await page.evaluate((key) => ({ state: localStorage.getItem("mindgrow.local.v2"), onboarding: localStorage.getItem(key) }), onboardingKey);
    if (!original.state) throw new Error("Cannot snapshot the existing local account");
    if (await page.$('[data-testid="new-user-empty-state"]')) throw new Error("Existing account incorrectly received new-user onboarding");

    const resetToEmptyAccount = async () => {
      await page.evaluate(({ stateJson, key }) => {
        const state = JSON.parse(stateJson);
        const defaultMap = state.maps.find((map) => map.isDefault);
        if (!defaultMap) throw new Error("Default map is missing");
        state.maps = [{ ...defaultMap, nodeCount: 0 }];
        state.nodes = { [defaultMap.id]: [] };
        state.edges = { [defaultMap.id]: [] };
        state.entityGraphs = { [defaultMap.id]: { entities: [], relations: [] } };
        state.layouts = {};
        localStorage.setItem("mindgrow.local.v2", JSON.stringify(state));
        localStorage.removeItem(key);
      }, { stateJson: original.state, key: onboardingKey });
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector('[data-testid="new-user-empty-state"]');
    };

    try {
      await resetToEmptyAccount();
      const cards = await page.$$eval('[data-testid="new-user-empty-state"] [data-testid^="onboarding-"]', (items) => items.map((item) => item.textContent.trim()));
      if (cards.length !== 3 || !["个人笔记", "论文速读", "会议纪要"].every((label) => cards.some((card) => card.includes(label)))) throw new Error(`Onboarding cards are incomplete: ${cards.join(" | ")}`);
      await page.click('[data-testid="onboarding-personal-notes"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="new-user-empty-state"]'));
      const personalNotes = await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
        const map = state.maps.find((candidate) => candidate.name === "我的个人笔记");
        return { id: map?.id || "", contents: (state.nodes[map?.id] || []).map((node) => node.content) };
      });
      if (!personalNotes.id || !["学习目标", "灵感想法", "待办事项"].every((item) => personalNotes.contents.includes(item))) throw new Error(`Personal note seeds are incomplete: ${JSON.stringify(personalNotes)}`);

      await resetToEmptyAccount();
      await page.click('[data-testid="onboarding-article-reading"]');
      await page.waitForSelector('[data-testid="article-content-workspace"]');
      await page.waitForFunction(() => document.activeElement?.matches('input[type="url"]'));

      await resetToEmptyAccount();
      await page.click('[data-testid="onboarding-meeting-notes"]');
      await page.waitForSelector('[data-testid="meeting-workspace"]');

      await resetToEmptyAccount();
      await page.click('button[aria-label="关闭新用户引导"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="new-user-empty-state"]'));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="knowledge-workspace"][data-library-busy="false"]');
      if (await page.$('[data-testid="new-user-empty-state"]')) throw new Error("Dismissed onboarding reappeared after reload");
    } finally {
      await page.evaluate(({ stateJson, key, onboarding }) => {
        localStorage.setItem("mindgrow.local.v2", stateJson);
        if (onboarding === null) localStorage.removeItem(key);
        else localStorage.setItem(key, onboarding);
      }, { stateJson: original.state, key: onboardingKey, onboarding: original.onboarding });
      await page.goto(`${BASE_URL}/guide`, { waitUntil: "domcontentloaded", timeout: 60000 });
    }
  });

  await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  await page.goto(`${BASE_URL}/guide`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.scrollWidth > 0 && document.documentElement.scrollHeight > 0);
  await page.screenshot({ path: path.join(artifactDir, "seo-guide.png"), fullPage: true });
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (browser.process() && !browser.process().killed) browser.process().kill();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
})();
