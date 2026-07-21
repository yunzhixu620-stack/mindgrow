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

  await check("usage guide button opens the guide from the application", async () => {
    const guide = await page.$('[data-testid="guide-link"]');
    if (!guide) throw new Error("Usage guide link is missing");
    await guide.click();
    await page.waitForFunction(() => window.location.pathname.endsWith("/guide") || window.location.pathname.endsWith("/guide/"));
    const heading = await page.$eval("h1", (element) => element.textContent.trim());
    if (!heading.includes("可追溯的知识网络")) throw new Error("Usage guide did not render after clicking");
    const timeline = await page.$('[data-testid="guide-timeline"]');
    if (!timeline) throw new Error("Visual usage timeline is missing");
    const guideScroll = await page.$eval('[data-guide-scroll]', (element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    if (guideScroll.scrollHeight <= guideScroll.clientHeight) throw new Error("Usage guide is not vertically scrollable");
    await page.$eval('[data-guide-scroll]', (element) => { element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) * 0.55); element.dispatchEvent(new Event("scroll")); });
    await page.waitForFunction(() => parseFloat(document.querySelector('[data-testid="guide-progress"]')?.style.width || "0") > 25);
    await page.goBack({ waitUntil: "networkidle0" });
    await revealAllStoredNodes(page);
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
    await page.click('button[aria-label="回答有帮助"]');
    const recorded = await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("mindgrow.feedback.")));
    if (!recorded) throw new Error("Feedback was not stored");
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
    const expand = await page.$('button[aria-label^="展开下一层 "]');
    if (!expand) throw new Error("No branch expansion control found");
    await expand.click();
    await page.waitForFunction((previous) => document.querySelectorAll(".react-flow__node").length > previous, {}, before);
    const afterFirstLevel = await page.$$eval(".react-flow__node", (nodes) => nodes.length);
    const total = await page.$$eval("button", (buttons) => Number(buttons.find((button) => /^全部 \d+$/.test(button.textContent.trim()))?.textContent.match(/\d+/)?.[0] || 0));
    const nextLevel = await page.$('button[aria-label^="展开下一层 "]');
    if (nextLevel && afterFirstLevel >= total) throw new Error("First expansion revealed the full descendant tree instead of one level");
    if (nextLevel) {
      await nextLevel.click();
      await page.waitForFunction((previous) => document.querySelectorAll(".react-flow__node").length > previous, {}, afterFirstLevel);
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
    await page.waitForFunction(() => document.body.innerText.includes("会议摘要"));
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
    await page.waitForFunction(() => document.body.innerText.includes("核心要点"));
    await page.waitForFunction(() => document.body.innerText.includes("[1]"));
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
    const relationClicked = await page.$eval(".react-flow__edge", (edge) => {
      edge.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    });
    if (!relationClicked) throw new Error("Entity relation cannot be selected");
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
    const cards = await page.$$("button");
    const oldCard = await Promise.all(cards.map(async (button) => ({ button, text: await button.evaluate((element) => element.textContent.trim()) })))
      .then((items) => items.find((item) => item.text.includes("文章知识库") && !item.text.includes("独立文章知识库"))?.button);
    const newCard = await Promise.all(cards.map(async (button) => ({ button, text: await button.evaluate((element) => element.textContent.trim()) })))
      .then((items) => items.find((item) => item.text.includes("论文图谱测试库"))?.button);
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
    await page.waitForFunction(() => document.body.innerText.includes("核心要点"));
    await clickByText(page, "button", "保存到文章知识库");
    await page.waitForFunction(() => document.body.innerText.includes("文章知识节点"));
  });

  await check("top product tabs switch both content and graph without cross-board residue", async () => {
    for (const [label, mode] of [["会议助手", "meeting"], ["知识碎片", "knowledge"], ["文章解析", "article"]]) {
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
    }
    await clickByText(page, "button", "会议助手");
    await clickByText(page, "button", "知识碎片");
    await clickByText(page, "button", "文章解析");
    await page.waitForSelector('[data-testid="knowledge-graph-workspace"][data-graph-mode="article"]');
    const finalMode = await page.$eval('[data-testid="knowledge-graph-workspace"]', (element) => element.getAttribute("data-graph-mode"));
    if (finalMode !== "article") throw new Error(`Rapid tab switch ended in ${finalMode}`);
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
    const coverageText = await page.evaluate(() => document.body.innerText);
    if (!coverageText.includes("图片页：")) throw new Error("Image-page diagnostics are missing");
    if (!coverageText.includes("引用完整性检查")) throw new Error("Citation coverage audit is missing");
    await page.screenshot({ path: path.join(artifactDir, "layoutlmv3-document-coverage.png"), fullPage: true });
  });

  await check("mobile chat and map tabs have no horizontal overflow", async () => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: "networkidle0" });
    const hasTextarea = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    if (!hasTextarea) throw new Error("Mobile chat input missing");
    await clickByText(page, "button", "会议");
    await page.waitForFunction(() => document.body.innerText.includes("独立会议知识库"));
    const meetingHasMapTab = await page.$$eval("button", (buttons) => buttons.some((button) => button.textContent.includes("图谱")));
    if (!meetingHasMapTab || await page.$(".react-flow")) throw new Error("Mobile meeting graph tab behavior is incorrect");
    await clickByText(page, "button", "图谱");
    await page.waitForSelector('[data-testid="knowledge-graph-workspace"][data-graph-mode="meeting"]');
    await clickByText(page, "button", "知识");
    await page.waitForSelector('textarea[aria-label="输入知识或向知识库提问"]');
    await clickByText(page, "button", "图谱");
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
