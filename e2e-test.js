// E2E Test Suite v2 - MindGrow
const puppeteer = require('puppeteer');
const BASE = 'http://127.0.0.1:3000';
let page, browser;
const failures = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function test(name, fn) {
  try { await fn(); console.log(`  PASS ${name}`); }
  catch (e) { failures.push({ name, error: e.message }); console.log(`  FAIL ${name}: ${e.message}`); }
}

(async () => {
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  // ===== DESKTOP =====
  console.log('\n=== DESKTOP ===\n');
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await test('Homepage loads', async () => {
    const r = await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    if (r.status() !== 200) throw `Status ${r.status()}`;
  });

  await test('Header visible', async () => {
    const h = await page.$('header');
    if (!h) throw 'No header';
  });

  await test('Sidebar visible', async () => {
    const w = await page.evaluate(() => {
      const s = document.querySelector('.border-r.flex.flex-col.h-full, [class*="w-[220px]"]');
      return s ? s.getBoundingClientRect().width : 0;
    });
    if (w < 200) throw `Sidebar too narrow: ${w}`;
  });

  await test('Chat panel visible', async () => {
    const ta = await page.$('textarea');
    if (!ta) throw 'No textarea';
  });

  await test('Mind map renders', async () => {
    const n = await page.$$eval('.react-flow__node', els => els.length);
    if (n === 0) throw 'No nodes';
  });

  await test('Node double-click edit', async () => {
    const node = await page.$('.react-flow__node');
    if (!node) throw 'No node';
    const box = await node.boundingBox();
    // Dispatch dblclick event
    await page.evaluate((x, y) => {
      const el = document.elementFromPoint(x, y);
      if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));
    }, box.x + box.width/2, box.y + box.height/2);
    await sleep(800);
    const found = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).some(i => i.closest('.fixed') && i.value.length > 0);
    });
    if (!found) throw 'Edit modal not shown';
    // Close modal
    await page.keyboard.press('Escape');
    await sleep(300);
  });

  await test('Search toggle', async () => {
    // Find search button by title
    const found = await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) { if (b.title && b.title.includes('\u641c\u7d22')) { b.click(); return true; } }
      return false;
    });
    if (!found) throw 'Search button not found';
    await sleep(500);
    const input = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).some(i => i.placeholder.includes('\u641c\u7d22'));
    });
    if (!input) throw 'Search input not visible';
    // Close
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) { if (b.title && b.title.includes('\u641c\u7d22')) { b.click(); return; } }
    });
    await sleep(300);
  });

  await test('Keyboard shortcut opens help', async () => {
    await page.keyboard.press('?');
    await sleep(300);
    const visible = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div')).some(d => d.textContent.includes('\u5feb\u6377\u952e'));
    });
    if (!visible) throw 'Help not shown';
    await page.keyboard.press('Escape');
    await sleep(200);
  });

  // ===== MOBILE =====
  console.log('\n=== MOBILE (390x844) ===\n');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(1000);

  await test('Header hidden', async () => {
    const h = await page.$('header');
    if (h) {
      const vis = await page.evaluate(el => el.offsetHeight > 0, h);
      if (vis) throw 'Header visible on mobile';
    }
  });

  await test('Tab bar shows', async () => {
    const n = await page.evaluate(() => {
      return document.querySelectorAll('button').length;
    });
    if (n < 2) throw `Too few buttons: ${n}`;
  });

  await test('Chat tab content renders', async () => {
    const ta = await page.$('textarea');
    if (!ta) throw 'No textarea on mobile chat';
  });

  await test('Drawer toggle button visible', async () => {
    const btn = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).some(b => b.classList.contains('drawer-toggle-btn'));
    });
    if (!btn) throw 'No drawer toggle button';
  });

  await test('Open drawer shows map list', async () => {
    await page.evaluate(() => {
      const btn = document.querySelector('.drawer-toggle-btn');
      if (btn) btn.click();
    });
    await sleep(500);
    const visible = await page.evaluate(() => {
      const d = document.querySelector('.mobile-drawer-panel');
      return d ? d.getBoundingClientRect().width > 0 : false;
    });
    if (!visible) throw 'Drawer not visible';
  });

  await test('Drawer shows maps', async () => {
    const count = await page.evaluate(() => {
      const panel = document.querySelector('.mobile-drawer-panel');
      if (!panel) return 0;
      // Count map buttons (not the create button)
      const btns = panel.querySelectorAll('button[class*="border-l-2"]');
      return btns.length;
    });
    if (count === 0) throw `No maps in drawer: ${count}`;
  });

  await test('Close drawer', async () => {
    // Click backdrop
    await page.evaluate(() => {
      const backdrop = document.querySelector('.fixed.z-\\[200\\] > div:first-child');
      if (backdrop) backdrop.click();
    });
    await sleep(300);
    const visible = await page.evaluate(() => !!document.querySelector('.mobile-drawer-panel'));
    if (visible) throw 'Drawer still visible after close';
  });

  await test('Switch to map tab', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('\u5bfc\u56fe')) b.click(); });
    });
    await sleep(1500);
    const rf = await page.$('.react-flow');
    if (!rf) throw 'ReactFlow not visible';
  });

  await test('No overflow on map tab', async () => {
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (ov) throw 'Horizontal overflow';
  });

  await test('ReactFlow dimensions', async () => {
    const dims = await page.evaluate(() => {
      const rf = document.querySelector('.react-flow');
      if (!rf) return null;
      const r = rf.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    if (!dims || dims.w < 370) throw `ReactFlow too small: ${JSON.stringify(dims)}`;
  });

  await test('Switch back to chat', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('\u5bf9\u8bdd')) b.click(); });
    });
    await sleep(500);
    const ta = await page.$('textarea');
    if (!ta) throw 'Textarea not visible after switching back';
  });

  // ===== SMALL PHONE =====
  console.log('\n=== SMALL PHONE (375x667) ===\n');
  await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(500);
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('\u5bfc\u56fe')) b.click(); });
  });
  await sleep(1000);

  await test('No overflow on small phone', async () => {
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (ov) throw 'Overflow';
  });

  await test('ReactFlow renders on small phone', async () => {
    const rf = await page.$('.react-flow');
    if (!rf) throw 'No ReactFlow';
  });

  // ===== API =====
  console.log('\n=== API ===\n');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });

  await test('GET /api/knowledge?action=maps', async () => {
    const d = await page.evaluate(() => fetch('/api/knowledge?action=maps').then(r => r.json()));
    if (!Array.isArray(d.maps)) throw 'No maps array';
  });

  await test('GET /api/knowledge?mapId=map_default', async () => {
    const d = await page.evaluate(() => fetch('/api/knowledge?mapId=map_default').then(r => r.json()));
    if (!Array.isArray(d.nodes)) throw 'No nodes';
    if (!Array.isArray(d.edges)) throw 'No edges';
  });

  await test('POST create + DELETE node', async () => {
    const d = await page.evaluate(async () => {
      const r = await fetch('/api/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'E2E-Test-Node', type: 'concept' })
      });
      const data = await r.json();
      if (!data.node?.id) return { error: 'No node created' };
      // Delete it
      await fetch(`/api/knowledge?nodeId=${data.node.id}`, { method: 'DELETE' });
      return { ok: true };
    });
    if (d.error) throw d.error;
  });

  await test('PATCH update node', async () => {
    const result = await page.evaluate(async () => {
      const r = await fetch('/api/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'E2E-Update-Test', type: 'detail' })
      });
      const created = await r.json();
      if (!created.node?.id) return { error: 'Create failed' };
      const u = await fetch('/api/knowledge', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: created.node.id, content: 'E2E-Updated', desc: 'test desc' })
      });
      const updated = await u.json();
      await fetch(`/api/knowledge?nodeId=${created.node.id}`, { method: 'DELETE' });
      return updated;
    });
    if (result.error) throw result.error;
    if (!result.node || result.node.content !== 'E2E-Updated') throw 'Content not updated';
    if (!result.node.desc || !result.node.desc.includes('test desc')) throw 'Desc not updated';
  });

  await test('Chat API knowledge', async () => {
    const d = await page.evaluate(() => fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '\u6df1\u5ea6\u5b66\u4e60' })
    }).then(r => r.json()));
    if (d.type !== 'knowledge') throw `Expected knowledge, got ${d.type}`;
    if (!d.reply) throw 'No reply';
  });

  await test('Chat API chitchat', async () => {
    const d = await page.evaluate(() => fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '\u4f60\u597d' })
    }).then(r => r.json()));
    if (d.type !== 'chitchat') throw `Expected chitchat, got ${d.type}`;
  });

  await test('Create + delete map', async () => {
    const d = await page.evaluate(async () => {
      const r = await fetch('/api/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createMap', name: 'E2E-Test-Map' })
      });
      const data = await r.json();
      if (!data.map?.id) return { error: 'Map not created' };
      await fetch('/api/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteMap', mapId: data.map.id })
      });
      return { ok: true };
    });
    if (d.error) throw d.error;
  });

  await browser.close();
  console.log('\n========================');
  if (failures.length === 0) console.log('ALL PASSED');
  else { console.log(`${failures.length} FAILURES:`); failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`)); }
  process.exit(failures.length ? 1 : 0);
})();
