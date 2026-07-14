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
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });

  await check("seed knowledge map renders", async () => {
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 10);
    const count = await page.$$eval(".react-flow__node", (nodes) => nodes.length);
    if (count !== 13) throw new Error(`Expected 13 seed nodes, got ${count}`);
  });

  await check("usage guide button opens the guide from the application", async () => {
    const guide = await page.$('[data-testid="guide-link"]');
    if (!guide) throw new Error("Usage guide link is missing");
    await guide.click();
    await page.waitForFunction(() => window.location.pathname.endsWith("/guide") || window.location.pathname.endsWith("/guide/"));
    const heading = await page.$eval("h1", (element) => element.textContent.trim());
    if (!heading.includes("可追溯的知识网络")) throw new Error("Usage guide did not render after clicking");
    await page.goBack({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 10);
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

  await check("grounded retrieval returns cited evidence", async () => {
    const input = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    await input.type("AI 知识助手包含哪些能力？");
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
    const expand = await page.$('button[aria-label^="展开 "]');
    if (!expand) throw new Error("No branch expansion control found");
    await expand.click();
    await page.waitForFunction((previous) => document.querySelectorAll(".react-flow__node").length > previous, {}, before);

    await clickByText(page, "button", "全部");
    await page.waitForFunction(() => {
      const allButton = Array.from(document.querySelectorAll("button")).find((button) => /^全部 \d+$/.test(button.textContent.trim()));
      const total = Number(allButton?.textContent.match(/\d+/)?.[0] || 0);
      return total > 0 && document.querySelectorAll(".react-flow__node").length === total;
    });
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
    if (await page.$(".react-flow")) throw new Error("Knowledge-fragment mind map leaked into the meeting board");
    meetingLibraryId = await page.$eval("[data-mode-library-id]", (element) => element.getAttribute("data-mode-library-id"));
    const meetingLibrary = await page.evaluate((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return state.maps.find((map) => map.id === mapId);
    }, meetingLibraryId);
    if (!meetingLibrary?.description.includes("[MindGrow:meeting]")) throw new Error("Meeting board did not enter its own knowledge library");
    await page.type('textarea[placeholder*="会议记录"]', "今天讨论知识助手发布计划。决定本周完成登录测试。小王负责回归验证，周五前完成。风险是文章解析接口可能超时。");
    await clickByText(page, "button", "生成结构化会议纪要");
    await page.waitForFunction(() => document.body.innerText.includes("会议摘要"));
    await clickByText(page, "button", "保存到会议知识库");
    await page.waitForFunction(() => document.body.innerText.includes("会议知识节点"));
    const microphone = await page.$('button[aria-label="开始语音输入"]');
    if (!microphone) throw new Error("Meeting microphone control missing");
  });

  await check("article parser extracts and saves a knowledge map", async () => {
    await clickByText(page, "button", "文章解析");
    await page.waitForSelector('[data-testid="article-workspace"]');
    if (await page.$(".react-flow")) throw new Error("Knowledge-fragment mind map leaked into the article board");
    const articleLibraryId = await page.$eval("[data-mode-library-id]", (element) => element.getAttribute("data-mode-library-id"));
    if (!articleLibraryId || articleLibraryId === meetingLibraryId) throw new Error("Article and meeting boards share the same knowledge library");
    const articleLibrary = await page.evaluate((mapId) => {
      const state = JSON.parse(localStorage.getItem("mindgrow.local.v2"));
      return state.maps.find((map) => map.id === mapId);
    }, articleLibraryId);
    if (!articleLibrary?.description.includes("[MindGrow:article]")) throw new Error("Article board did not enter its own knowledge library");
    const fileInput = await page.waitForSelector('input[type="file"][accept*="pdf"]');
    await fileInput.uploadFile(pdfPath);
    await page.waitForFunction(() => document.body.innerText.includes("已读取 2 页"));
    await clickByText(page, "button", "解析文章");
    await page.waitForFunction(() => document.body.innerText.includes("核心要点"));
    await page.waitForFunction(() => document.body.innerText.includes("[1]"));
    await page.waitForFunction(() => document.body.innerText.includes("Repo Wiki 论文链路"));
    if (!await page.$('input[aria-label="搜索论文链路"]')) throw new Error("Paper link navigator search is missing");
    if (!await page.$('textarea[aria-label="向文章知识库提问"]')) throw new Error("Article-library Q&A input is missing");
    await clickByText(page, "button", "生成 Audio Overview");
    await page.waitForFunction(() => document.body.innerText.includes("Audio Overview ·"));
    await clickByText(page, "button", "保存到文章知识库");
    await page.waitForFunction(() => document.body.innerText.includes("文章知识节点"));
  });

  await check("real research PDF preserves pages and reports visual structures", async () => {
    if (!fs.existsSync(realPaperPath)) throw new Error("LayoutLMv3 test paper is missing");
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
    const meetingHasMapTab = await page.$$eval("button", (buttons) => buttons.some((button) => button.textContent.includes("导图")));
    if (meetingHasMapTab || await page.$(".react-flow")) throw new Error("Mobile meeting board still exposes the knowledge map");
    await clickByText(page, "button", "知识");
    await page.waitForSelector('textarea[aria-label="输入知识或向知识库提问"]');
    await clickByText(page, "button", "导图");
    await page.waitForSelector(".react-flow");
    await page.waitForSelector(".mindgrow-minimap");
    await page.waitForFunction(() => document.body.innerText.includes("当前显示") && document.body.innerText.includes("点击节点上的 ＋N 展开"));
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

  await check("knowledge universe renders a single application header", async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/universe`, { waitUntil: "networkidle0", timeout: 30000 });
    const headerCount = await page.$$eval("header", (headers) => headers.length);
    if (headerCount !== 1) throw new Error(`Expected one application header, got ${headerCount}`);
    const hasBackButton = await page.evaluate(() => document.body.innerText.includes("返回知识导图"));
    if (!hasBackButton) throw new Error("Universe navigation is incomplete");
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
