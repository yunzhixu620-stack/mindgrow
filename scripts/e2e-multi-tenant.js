const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const credentials = {
  a: {
    email: process.env.MINDGROW_TEST_A_EMAIL,
    password: process.env.MINDGROW_TEST_A_PASSWORD,
  },
  b: {
    email: process.env.MINDGROW_TEST_B_EMAIL,
    password: process.env.MINDGROW_TEST_B_PASSWORD,
  },
};

const requiredCredentials = [credentials.a.email, credentials.a.password, credentials.b.email, credentials.b.password];
if (requiredCredentials.some((value) => !value)) {
  console.warn("skip: multi-tenant creds missing");
  console.log("TEST_SKIPPED=true");
  process.exit(0);
}
if (credentials.a.email === credentials.b.email) {
  console.error("FAIL multi-tenant fixture: account A and B must be different");
  process.exit(1);
}

const configuredAppUrl = process.env.MINDGROW_TEST_APP_URL || "http://127.0.0.1:3000";
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const appBase = new URL(configuredAppUrl.endsWith("/") ? configuredAppUrl : `${configuredAppUrl}/`);
const artifactDir = path.join(process.cwd(), "artifacts", "e2e-multi-tenant");
fs.mkdirSync(artifactDir, { recursive: true });

function appUrl(relative = "") {
  return new URL(relative, appBase).toString();
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function isUniverseRequest(urlString) {
  try {
    const url = new URL(urlString);
    return url.pathname.endsWith("/api/knowledge") && url.searchParams.get("action") === "universe";
  } catch {
    return false;
  }
}

function captureNextUniverseSnapshot(page) {
  let settled = false;
  let timer;
  let resolveSnapshot;
  const cleanup = () => {
    clearTimeout(timer);
    page.off("response", onResponse);
  };
  const onResponse = async (response) => {
    if (settled || !isUniverseRequest(response.url()) || !response.ok()) return;
    try {
      const data = await response.json();
      if (!Array.isArray(data.libraries)) return;
      settled = true;
      cleanup();
      resolveSnapshot(data);
    } catch {
      // Ignore an unreadable response and keep waiting for the retry.
    }
  };
  const promise = new Promise((resolve, reject) => {
    resolveSnapshot = resolve;
    timer = setTimeout(() => {
      settled = true;
      cleanup();
      reject(new Error("Timed out waiting for the authenticated Universe snapshot"));
    }, 45_000);
  });
  page.on("response", onResponse);
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}

function normalizeSnapshot(data, workspaceId) {
  const libraries = data.libraries || [];
  if (!workspaceId || libraries.length === 0) throw new Error("Tenant fixture has no active workspace or knowledge library");
  const mapIds = libraries.map((library) => String(library.map?.id || "")).filter(Boolean).sort();
  const mapNames = libraries.map((library) => String(library.map?.name || "").trim()).filter(Boolean).sort();
  const nodeIds = libraries.flatMap((library) => (library.nodes || []).map((node) => String(node.id || "")).filter(Boolean)).sort();
  const contents = libraries.flatMap((library) => (library.nodes || []).map((node) => String(node.content || "").trim()).filter(Boolean));
  if (mapIds.length !== libraries.length) throw new Error("Universe response contains a library without a canonical map id");
  return { workspaceId, mapIds, mapNames, nodeIds, contents };
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function assertTenantIsolation(a, b) {
  if (a.workspaceId === b.workspaceId) throw new Error("Account A and B resolved to the same workspace");
  if (intersection(a.mapIds, b.mapIds).length) throw new Error("A map id appeared in both tenant snapshots");
  if (intersection(a.nodeIds, b.nodeIds).length) throw new Error("A node id appeared in both tenant snapshots");
  if (intersection(a.mapNames, b.mapNames).length) throw new Error("Fixture map names overlap; seed account-specific map names before release verification");
  const uniqueAContents = a.contents.filter((value) => !b.contents.includes(value));
  const uniqueBContents = b.contents.filter((value) => !a.contents.includes(value));
  if (!uniqueAContents.length || !uniqueBContents.length) throw new Error("Fixture content is not distinct enough to verify cross-account isolation");
}

function assertSameTenant(expected, actual, label) {
  if (expected.workspaceId !== actual.workspaceId) throw new Error(`${label} workspace changed after authentication transition`);
  if (JSON.stringify(expected.mapIds) !== JSON.stringify(actual.mapIds)) throw new Error(`${label} map catalog changed after authentication transition`);
  if (JSON.stringify(expected.nodeIds) !== JSON.stringify(actual.nodeIds)) throw new Error(`${label} graph changed after authentication transition`);
}

async function waitForLogin(page) {
  await page.waitForSelector('input[type="email"]', { visible: true, timeout: 45_000 });
  await page.waitForSelector('input[type="password"]', { visible: true, timeout: 45_000 });
}

async function submitLogin(page, accountLabel, account) {
  await waitForLogin(page);
  await page.type('input[type="email"]', account.email);
  await page.type('input[type="password"]', account.password);
  await page.click('form button:not([type="button"])');
  await page.waitForSelector('button[aria-label="退出登录"]', { visible: true, timeout: 45_000 });
  await page.waitForFunction(() => Boolean(window.localStorage.getItem("mindgrow.workspace.v1")), { timeout: 45_000 });
  const status = await page.$('[role="status"]');
  if (status) {
    const text = await status.evaluate((element) => element.textContent.trim());
    if (text) throw new Error(`Account ${accountLabel} login returned a status error`);
  }
}

async function loginFromRoot(page, accountLabel, account) {
  await page.goto(appUrl(`?tenant-e2e=${Date.now()}`), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await submitLogin(page, accountLabel, account);
}

async function signOut(page, priorSnapshot) {
  await page.click('button[aria-label="退出登录"]');
  await waitForLogin(page);
  await page.waitForFunction(() => !window.localStorage.getItem("mindgrow.workspace.v1"), { timeout: 30_000 });
  const visibleText = await page.evaluate(() => document.body.innerText);
  const leakedName = priorSnapshot.mapNames.find((name) => name.length >= 3 && visibleText.includes(name));
  if (leakedName) throw new Error("Signed-out page still exposes a prior tenant library name");
}

async function navigateAndCaptureUniverse(page, label) {
  const capture = captureNextUniverseSnapshot(page);
  try {
    await page.goto(appUrl(`universe/?mode=all&tenant-e2e=${label}-${Date.now()}`), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="universe-view"]', { timeout: 45_000 });
    const data = await capture.promise;
    const workspaceId = await page.evaluate(() => window.localStorage.getItem("mindgrow.workspace.v1"));
    return normalizeSnapshot(data, workspaceId);
  } catch (error) {
    capture.cancel();
    throw error;
  }
}

async function assertRenderedUniverse(page, expectedMapIds, label) {
  const expected = [...expectedMapIds].sort().join(",");
  await page.waitForFunction((signature) => (
    document.querySelector('[data-testid="universe-view"]')?.getAttribute("data-universe-library-ids") === signature
  ), { timeout: 30_000 }, expected);
  const actual = await page.$eval('[data-testid="universe-view"]', (element) => element.getAttribute("data-universe-library-ids"));
  if (actual !== expected) throw new Error(`${label} rendered another tenant's Universe`);
}

async function holdNextUniverseRequest(page) {
  await page.setRequestInterception(true);
  let heldRequest = null;
  let resolveHeld;
  const held = new Promise((resolve) => { resolveHeld = resolve; });
  const onRequest = (request) => {
    if (!heldRequest && isUniverseRequest(request.url())) {
      heldRequest = request;
      resolveHeld();
      return;
    }
    void request.continue().catch(() => {});
  };
  page.on("request", onRequest);
  return {
    async waitUntilHeld() {
      await withTimeout(held, 30_000, "Slow Universe request was not intercepted");
    },
    async release() {
      if (heldRequest && !heldRequest.isInterceptResolutionHandled()) {
        await heldRequest.continue().catch(() => {});
      }
    },
    async stop() {
      page.off("request", onRequest);
      if (heldRequest && !heldRequest.isInterceptResolutionHandled()) await heldRequest.continue().catch(() => {});
      await page.setRequestInterception(false);
    },
  };
}

(async () => {
  const browser = await puppeteer.launch({ headless: "new", pipe: true, executablePath, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await loginFromRoot(page, "A", credentials.a);
    const snapshotA = await navigateAndCaptureUniverse(page, "account-a");
    await page.screenshot({ path: path.join(artifactDir, "account-a-universe.png") });

    // Hold an authenticated A request, sign out, and sign in as B before the
    // response is released. The late response must not repaint B's Universe.
    const delayed = await holdNextUniverseRequest(page);
    await page.goto(appUrl(`universe/?mode=all&tenant-e2e=late-a-${Date.now()}`), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await delayed.waitUntilHeld();
    await signOut(page, snapshotA);
    const captureB = captureNextUniverseSnapshot(page);
    await submitLogin(page, "B", credentials.b);
    const dataB = await captureB.promise;
    const workspaceB = await page.evaluate(() => window.localStorage.getItem("mindgrow.workspace.v1"));
    const snapshotB = normalizeSnapshot(dataB, workspaceB);
    await assertRenderedUniverse(page, snapshotB.mapIds, "Account B before late response");
    await delayed.release();
    await new Promise((resolve) => setTimeout(resolve, 750));
    await delayed.stop();
    await assertRenderedUniverse(page, snapshotB.mapIds, "Account B after late A response");
    assertTenantIsolation(snapshotA, snapshotB);
    await page.screenshot({ path: path.join(artifactDir, "account-b-after-late-a.png") });

    // A browser refresh must preserve B, not resurrect the previous account.
    const captureBRefresh = captureNextUniverseSnapshot(page);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="universe-view"]', { timeout: 45_000 });
    const refreshedB = normalizeSnapshot(
      await captureBRefresh.promise,
      await page.evaluate(() => window.localStorage.getItem("mindgrow.workspace.v1")),
    );
    assertSameTenant(snapshotB, refreshedB, "Account B");
    await assertRenderedUniverse(page, snapshotB.mapIds, "Account B after refresh");

    // Switching back to A must restore A's own catalog and graph exactly.
    await signOut(page, snapshotB);
    const captureAReturn = captureNextUniverseSnapshot(page);
    await submitLogin(page, "A", credentials.a);
    const returnedA = normalizeSnapshot(
      await captureAReturn.promise,
      await page.evaluate(() => window.localStorage.getItem("mindgrow.workspace.v1")),
    );
    assertSameTenant(snapshotA, returnedA, "Account A");
    await assertRenderedUniverse(page, snapshotA.mapIds, "Account A after switching back");

    if (pageErrors.length) throw new Error(`Browser reported ${pageErrors.length} uncaught page error(s)`);
    console.log("PASS multi-tenant account isolation, late response rejection, and refresh persistence");
    console.log("TEST_SKIPPED=false");
  } finally {
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (browser.process() && !browser.process().killed) browser.process().kill();
  }
})().catch((error) => {
  console.error(`FAIL multi-tenant E2E: ${error.message}`);
  process.exit(1);
});
