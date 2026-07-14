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
const pdf = new jsPDF();
pdf.text("Retrieval augmented generation must find relevant evidence before producing an answer.", 12, 20, { maxWidth: 180 });
pdf.text("Every conclusion should keep a source citation so users can verify the original material.", 12, 40, { maxWidth: 180 });
pdf.addPage();
pdf.text("When evidence is missing, the assistant should clearly abstain instead of inventing details.", 12, 20, { maxWidth: 180 });
pdf.text("A fixed evaluation set should measure retrieval recall and citation accuracy as data grows.", 12, 40, { maxWidth: 180 });
fs.writeFileSync(pdfPath, Buffer.from(pdf.output("arraybuffer")));

const results = [];
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
  await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 30000 });

  await check("seed knowledge map renders", async () => {
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 10);
    const count = await page.$$eval(".react-flow__node", (nodes) => nodes.length);
    if (count !== 13) throw new Error(`Expected 13 seed nodes, got ${count}`);
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
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 13);
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
    await page.waitForSelector('textarea[placeholder*="会议记录"]');
    await page.type('textarea[placeholder*="会议记录"]', "今天讨论知识助手发布计划。决定本周完成登录测试。小王负责回归验证，周五前完成。风险是文章解析接口可能超时。");
    await clickByText(page, "button", "生成结构化会议纪要");
    await page.waitForFunction(() => document.body.innerText.includes("会议摘要"));
    await clickByText(page, "button", "保存到当前思维导图");
    await page.waitForFunction(() => document.body.innerText.includes("会议知识节点"));
    const microphone = await page.$('button[aria-label="开始语音输入"]');
    if (!microphone) throw new Error("Meeting microphone control missing");
  });

  await check("article parser extracts and saves a knowledge map", async () => {
    await clickByText(page, "button", "文章解析");
    const fileInput = await page.waitForSelector('input[type="file"][accept*="pdf"]');
    await fileInput.uploadFile(pdfPath);
    await page.waitForFunction(() => document.body.innerText.includes("已读取 2 页"));
    await clickByText(page, "button", "解析文章");
    await page.waitForFunction(() => document.body.innerText.includes("核心要点"));
    await page.waitForFunction(() => document.body.innerText.includes("[1]"));
    await clickByText(page, "button", "生成 Audio Overview");
    await page.waitForFunction(() => document.body.innerText.includes("Audio Overview ·"));
    await clickByText(page, "button", "保存到当前思维导图");
    await page.waitForFunction(() => document.body.innerText.includes("文章知识节点"));
  });

  await check("mobile chat and map tabs have no horizontal overflow", async () => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: "networkidle0" });
    const hasTextarea = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    if (!hasTextarea) throw new Error("Mobile chat input missing");
    await clickByText(page, "button", "导图");
    await page.waitForSelector(".react-flow");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error("Mobile layout overflows horizontally");
  });

  await page.screenshot({ path: path.join(artifactDir, "mobile-map.png"), fullPage: true });

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
