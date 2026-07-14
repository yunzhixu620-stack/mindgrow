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

(async () => {
  const browser = await puppeteer.launch({ headless: "new", pipe: true, executablePath, args: ["--no-sandbox"] });
  const page = await browser.newPage();

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle2", timeout: 60000 });

  await check("secure login screen renders", async () => {
    await page.waitForFunction(() => document.body.innerText.includes("你的私有 AI 知识工作区"), { timeout: 30000 });
    const email = await page.$('input[type="email"]');
    const password = await page.$('input[type="password"]');
    if (!email || !password) throw new Error("Login form fields are missing");
  });

  await check("registration option is available", async () => {
    const labels = await page.$$eval("button", (buttons) => buttons.map((button) => button.textContent.trim()));
    if (!labels.includes("登录") || !labels.includes("注册")) throw new Error("Login or registration tab is missing");
  });

  await check("production API is healthy and anonymous data is denied", async () => {
    const result = await page.evaluate(async () => {
      const base = "https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run";
      const [health, knowledge] = await Promise.all([
        fetch(`${base}/health`, { cache: "no-store" }),
        fetch(`${base}/api/knowledge?action=maps`, { cache: "no-store" }),
      ]);
      return { health: health.status, knowledge: knowledge.status, healthBody: await health.json() };
    });
    if (result.health !== 200 || result.healthBody.status !== "ok") throw new Error(`Health check returned ${result.health}`);
    if (result.knowledge !== 401) throw new Error(`Anonymous knowledge request returned ${result.knowledge}, expected 401`);
  });

  await check("mobile login has no horizontal overflow", async () => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes("你的私有 AI 知识工作区"), { timeout: 30000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error("Mobile login overflows horizontally");
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
