const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const { jsPDF } = require("jspdf");

const BASE_URL = process.env.MINDGROW_BASE_URL || "http://127.0.0.1:3000";
const BASE_PATH = new URL(BASE_URL).pathname.replace(/\/$/, "");
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
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
  try {
    await task();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
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
      await page.waitForFunction(() => window.location.pathname.endsWith("/guide") || window.location.pathname.endsWith("/guide/"));
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

  await check("workspace search finds maps by node content", async () => {
    const search = await page.$('input[aria-label="搜索全部知识库"]');
    if (!search) throw new Error("Workspace search input missing");
    await search.type("可信检索");
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button[aria-label^="打开知识库 "]')).length > 0);
    const result = await page.$('button[aria-label^="打开知识库 "]');
    if (!result) throw new Error("No matching knowledge map result");
    const resultText = await result.evaluate((element) => element.textContent);
    if (!resultText.includes("可信检索")) throw new Error("Node-content match is not visible in result");
    await result.click();
    await page.waitForFunction(() => !document.querySelector('input[aria-label="搜索全部知识库"]').value);
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
      const target = state.maps.find((map) => map.id !== activeId && !String(map.description || "").includes("[MindGrow:meeting]") && !String(map.description || "").includes("[MindGrow:article]"));
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
    if (!meetingLibrary?.description.includes("[MindGrow:meeting]")) throw new Error("Meeting board did not enter its own knowledge library");
    await page.type('textarea[placeholder*="会议记录"]', "今天讨论知识助手发布计划。决定本周完成登录测试。小王负责回归验证，周五前完成。风险是文章解析接口可能超时。");
    await clickByText(page, "button", "生成结构化会议纪要");
    await page.waitForSelector('[data-testid="answer-card"]');
    const meetingAnswerSections = await page.$$eval('[data-testid="answer-card"] > section', (sections) => sections.map((section) => section.textContent.trim()));
    if (!["结论", "证据", "AI 延伸"].every((label) => meetingAnswerSections.some((section) => section.includes(label)))) throw new Error("Meeting answer is not separated into conclusion, evidence, and AI extension");
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 3);
    await clickByText(page, "button", "保存到会议知识库");
    await page.waitForFunction(() => document.body.innerText.includes("会议知识节点"));
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
    if (!articleLibrary?.map?.description.includes("[MindGrow:article]")) throw new Error("Article board did not enter its own knowledge library");
    if (articleLibrary.nodes.some((node) => node.content.includes("知识助手发布计划"))) throw new Error("Meeting content leaked into the article library");
    const fileInput = await page.waitForSelector('input[type="file"][accept*="pdf"]');
    await fileInput.uploadFile(pdfPath);
    await page.waitForFunction(() => document.body.innerText.includes("已读取 2 页"));
    await clickByText(page, "button", "解析文章");
    await page.waitForSelector('[data-testid="answer-card"]');
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
    await page.waitForFunction((index) => document.querySelector(`[data-testid="citation-evidence"][data-citation-index="${index}"]`)?.getAttribute("data-highlighted") === "false", { timeout: 5000 }, citationIndex);
    if (!await page.evaluate(() => document.querySelector('[data-testid="answer-card"]')?.textContent.includes("PDF 本轮仅提供页码/段落 locator"))) throw new Error("PDF locator limitation is not disclosed");
    await page.waitForFunction(() => document.body.innerText.includes("图谱增强检索（GraphRAG）论文结构预览"));
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 3);
    if (!await page.$('input[aria-label="搜索论文链路"]')) throw new Error("Paper link navigator search is missing");
    if (!await page.$('textarea[aria-label="与文章知识库对话"]')) throw new Error("Article-library conversation input is missing");
    if (!await page.evaluate(() => document.body.innerText.includes("自动识别翻译、总结、解释、比较、信息提取与事实问答"))) throw new Error("Article task guidance is missing");
    const articleTaskCategories = await page.$$eval('[aria-label="文章问答任务分类"] button', (buttons) => buttons.map((button) => button.textContent.trim()));
    if (articleTaskCategories.length !== 6 || !["翻译", "总结", "比较", "提取", "解释", "问答"].every((label) => articleTaskCategories.some((item) => item.includes(label)))) throw new Error(`Article task categories are unclear: ${articleTaskCategories.join(", ")}`);
    await clickByText(page, "button", "生成音频概览");
    await page.waitForFunction(() => document.body.innerText.includes("音频概览 ·"));
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
    const storedGraph = await page.evaluate((mapId) => JSON.parse(localStorage.getItem("mindgrow.local.v2")).entityGraphs?.[mapId], articleLibraryId);
    if (!storedGraph?.entities?.length || !storedGraph?.relations?.length) throw new Error("Saved article has no entity graph");
    await clickByText(page, '[data-testid="graph-layer-switch"] button', "实体图");
    await page.waitForFunction(() => document.body.innerText.includes("实体知识图谱"));
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 2 && document.querySelectorAll(".react-flow__edge").length >= 1);
    await page.waitForSelector('[data-testid="entity-view-modes"]');
    const globalNodeCount = await page.$$eval('[data-testid="entity-network-node"]', (nodes) => nodes.length);
    if (globalNodeCount < 2) throw new Error("Obsidian entity network did not render enough entities");
    await page.hover('[data-testid="entity-network-node"]');
    await page.waitForSelector('[data-testid="entity-hover-card"]', { visible: true });
    await page.$eval('[data-testid="entity-network-node"]', (node) => {
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
    if (!evidence.includes("关系原文证据") || !evidence.includes("原文片段")) throw new Error("Relation evidence is not traceable to the original text");
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
        const description = map.description || "";
        return expectedMode === "meeting" ? description.includes("[MindGrow:meeting]") : expectedMode === "article" ? description.includes("[MindGrow:article]") : !description.includes("[MindGrow:");
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
    const beforeAssignments = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return Object.fromEntries(state.maps.filter((map) => !(map.description || "").includes("[MindGrow:")).map((map) => [map.id, map.categoryId || null]));
    });
    await page.click('[data-testid="open-library-organizer"]');
    await page.waitForSelector('[data-testid="organize-library-dialog"]');
    await page.click('[data-testid="organize-mode-workflow"]');
    await page.click('[data-testid="organize-create-preview"]');
    await page.waitForSelector('[data-testid="organize-preview"]');
    const previewCategoryCount = await page.$$eval('[data-testid="organize-preview"] input', (inputs) => inputs.length);
    if (previewCategoryCount < 1) throw new Error("Organizer preview did not create any directory");
    await page.screenshot({ path: path.join(artifactDir, "desktop-organizer-preview.png") });
    await page.click('[data-testid="organize-apply"]');
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes("已整理"));
    await page.click('[data-testid="organize-undo"]');
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes("已恢复"));
    const afterAssignments = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return Object.fromEntries(state.maps.filter((map) => !(map.description || "").includes("[MindGrow:")).map((map) => [map.id, map.categoryId || null]));
    });
    if (JSON.stringify(beforeAssignments) !== JSON.stringify(afterAssignments)) throw new Error("Undo did not restore knowledge-library categories");
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
    if (!coverageText.includes("PDF 本轮仅提供页码/段落 locator")) throw new Error("PDF locator limitation is missing");
    await page.screenshot({ path: path.join(artifactDir, "layoutlmv3-document-coverage.png"), fullPage: true });
  });

  await check("mobile chat and map tabs have no horizontal overflow", async () => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: "networkidle0" });
    const mobileBreadcrumb = await page.$('[data-testid="mobile-breadcrumb-bar"] [data-testid="product-breadcrumb"]');
    if (!mobileBreadcrumb) throw new Error("Mobile knowledge-base breadcrumb is missing");
    const mobileBreadcrumbLabel = await mobileBreadcrumb.$eval("button span.truncate", (label) => label.textContent.trim());
    if (mobileBreadcrumbLabel.length > 12) throw new Error(`Mobile breadcrumb was not shortened: ${mobileBreadcrumbLabel}`);
    const hasTextarea = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    if (!hasTextarea) throw new Error("Mobile chat input missing");
    await page.click('[data-testid="mobile-product-tabs"] button[aria-label="切换到会议助手"]');
    await page.waitForFunction(() => document.body.innerText.includes("独立会议知识库"));
    const meetingHasMapTab = await page.$$eval("button", (buttons) => buttons.some((button) => button.textContent.includes("图谱")));
    if (!meetingHasMapTab || await page.$(".react-flow")) throw new Error("Mobile meeting graph tab behavior is incorrect");
    await page.click('[data-testid="mobile-product-tabs"] button[aria-label="查看知识图谱"]');
    await page.waitForSelector('[data-testid="knowledge-graph-workspace"][data-graph-mode="meeting"]');
    await page.click('[data-testid="mobile-product-tabs"] button[aria-label="切换到知识碎片"]');
    await page.waitForSelector('textarea[aria-label="输入知识或向知识库提问"]');
    await page.click('[data-testid="mobile-product-tabs"] button[aria-label="查看知识图谱"]');
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

  await check("mobile template creation uses the shared graph loader once", async () => {
    await page.click('[data-testid="mobile-product-tabs"] button[aria-label="切换到知识碎片"]');
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
      await page.click('[data-testid="mobile-product-tabs"] button[aria-label="查看知识图谱"]');
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
