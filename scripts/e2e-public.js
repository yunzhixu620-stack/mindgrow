const puppeteer = require("puppeteer");

const baseUrl = (process.env.MINDGROW_BASE_URL || "https://yunzhixu620-stack.github.io/mindgrow/").replace(/\/$/, "");
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const results = [];

async function check(name, task) {
  try {
    await task();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function clickByText(page, selector, text) {
  const clicked = await page.$$eval(selector, (elements, label) => {
    const target = elements.find((element) => element.textContent.trim().includes(label));
    if (!target) return false;
    target.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Cannot find ${selector} containing ${text}`);
}

(async () => {
  const browser = await puppeteer.launch({ headless: "new", executablePath, args: ["--no-sandbox"] });
  const page = await browser.newPage();

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle2", timeout: 60000 });

  await check("production API reports connected", async () => {
    await page.waitForFunction(() => document.body.innerText.includes("云端知识库 · API 已连接"), { timeout: 30000 });
  });

  await check("cloud knowledge graph renders", async () => {
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0, { timeout: 30000 });
    const count = await page.$$eval(".react-flow__node", (nodes) => nodes.length);
    if (count < 1) throw new Error("No cloud knowledge nodes rendered");
  });

  await check("greeting reaches cloud chat API", async () => {
    const input = await page.$('textarea[aria-label="输入知识或向知识库提问"]');
    if (!input) throw new Error("Chat input is missing");
    await input.type("你好");
    await page.click('button[aria-label="发送"]');
    await page.waitForFunction(() => document.body.innerText.includes("我可以帮你整理知识"), { timeout: 30000 });
  });

  await check("mobile chat and map have no horizontal overflow", async () => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes("API 已连接"), { timeout: 30000 });
    await clickByText(page, "button", "导图");
    await page.waitForSelector(".react-flow", { timeout: 30000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error("Mobile layout overflows horizontally");
  });

  await check("SEO guide renders", async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/guide/`, { waitUntil: "networkidle2", timeout: 60000 });
    const heading = await page.$eval("h1", (element) => element.textContent.trim());
    if (!heading.includes("可追溯的知识网络")) throw new Error(`Unexpected guide heading: ${heading}`);
  });

  await check("robots and sitemap are public", async () => {
    const [robots, sitemap] = await Promise.all([
      fetch(`${baseUrl}/robots.txt`).then((response) => response.text()),
      fetch(`${baseUrl}/sitemap.xml`).then((response) => response.text()),
    ]);
    if (!robots.includes("sitemap.xml")) throw new Error("robots.txt has no sitemap reference");
    if (!sitemap.includes("/guide/")) throw new Error("sitemap has no guide URL");
  });

  await browser.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} public checks passed`);
  if (failed.length) process.exit(1);
})();
