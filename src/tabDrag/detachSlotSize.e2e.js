import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 800 };
const STEP_DELAY_MS = 30;
const DETACH_OVERSHOOT = 120;
const MAX_SLOT_WIDTH_VARIANCE_PX = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dispatchPointer = async (session, type, x, y, button = 'left') => {
  await session.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button,
    pointerType: 'mouse'
  });
};

const pointerDown = (session, x, y) => dispatchPointer(session, 'mousePressed', x, y);
const pointerUp = (session, x, y) => dispatchPointer(session, 'mouseReleased', x, y);
const pointerMove = (session, x, y) => dispatchPointer(session, 'mouseMoved', x, y, 'none');

const dragSteps = async (session, from, to, steps = 20) => {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    await pointerMove(session, x, y);
    await sleep(STEP_DELAY_MS);
  }
};

const getTabCenter = (page, panelSelector, tabIndex) =>
  page.$eval(panelSelector, (panel, idx) => {
    const tab = panel.querySelectorAll('.tab--item')[idx];
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, tabIndex);

const getDetachedPanelTabWidth = (page) =>
  page.$$eval('.browser', (panels) => {
    if (panels.length < 2) return null;
    const detached = panels[panels.length - 1];
    const tab = detached.querySelector('.tab--item');
    if (!tab) return null;
    return tab.getBoundingClientRect().width;
  });

const sampleTabWidth = async (page, intervalMs, count) => {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const width = await getDetachedPanelTabWidth(page);
    if (width != null && width > 0) samples.push(width);
    if (i < count - 1) await sleep(intervalMs);
  }
  return samples;
};

const run = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height}`]
  });
  const page = await browser.newPage();
  const session = await page.createCDPSession();
  await page.setViewport(VIEWPORT);
  await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
  await sleep(600);

  await page.$eval('.motion--control', (el) => { el.style.display = 'none'; });

  const results = { passed: 0, failed: 0, errors: [] };

  const assert = (condition, msg) => {
    if (condition) {
      results.passed++;
      console.log(`  PASS: ${msg}`);
    } else {
      results.failed++;
      results.errors.push(msg);
      console.error(`  FAIL: ${msg}`);
    }
  };

  console.log('Test: Detached window tab slot is at final size immediately');

  const panelCountBefore = await page.$$eval('.browser', (els) => els.length);
  const tabCenter = await getTabCenter(page, '.browser', 1);
  if (!tabCenter) {
    console.error('  Could not find second tab');
    await browser.close();
    process.exit(1);
  }

  await pointerMove(session, tabCenter.x, tabCenter.y);
  await sleep(50);
  await pointerDown(session, tabCenter.x, tabCenter.y);
  await dragSteps(session, tabCenter, { x: tabCenter.x, y: tabCenter.y + 10 }, 5);

  const detachTarget = { x: tabCenter.x, y: tabCenter.y + DETACH_OVERSHOOT };
  await dragSteps(session, { x: tabCenter.x, y: tabCenter.y + 10 }, detachTarget, 30);
  await sleep(100);

  let panelCountAfter = await page.$$eval('.browser', (els) => els.length);
  if (panelCountAfter <= panelCountBefore) {
    const furtherTarget = { x: tabCenter.x, y: tabCenter.y + DETACH_OVERSHOOT + 80 };
    await dragSteps(session, detachTarget, furtherTarget, 20);
    await sleep(200);
    panelCountAfter = await page.$$eval('.browser', (els) => els.length);
  }

  if (panelCountAfter <= panelCountBefore) {
    console.error('  Detached window was never created — aborting');
    await pointerUp(session, tabCenter.x, tabCenter.y + DETACH_OVERSHOOT + 80);
    await browser.close();
    process.exit(1);
  }

  const earlySamples = await sampleTabWidth(page, 30, 6);

  await sleep(400);

  const lateSamples = await sampleTabWidth(page, 50, 6);

  const allSamples = [...earlySamples, ...lateSamples];

  if (allSamples.length < 2) {
    console.error('  Not enough valid width samples');
    await pointerUp(session, tabCenter.x, tabCenter.y + DETACH_OVERSHOOT);
    await browser.close();
    process.exit(1);
  }

  const firstWidth = allSamples[0];
  const lastWidth = allSamples[allSamples.length - 1];
  const maxWidth = Math.max(...allSamples);
  const minWidth = Math.min(...allSamples);
  const widthRange = maxWidth - minWidth;

  assert(
    widthRange < MAX_SLOT_WIDTH_VARIANCE_PX,
    `Tab width stable across ${allSamples.length} samples: range=${widthRange.toFixed(1)}px (max ${MAX_SLOT_WIDTH_VARIANCE_PX}px allowed)`
  );

  assert(
    Math.abs(firstWidth - lastWidth) < 3,
    `First width (${firstWidth.toFixed(1)}) matches last (${lastWidth.toFixed(1)}), diff=${Math.abs(firstWidth - lastWidth).toFixed(1)}px`
  );

  assert(
    firstWidth > 30,
    `Tab at reasonable width: ${firstWidth.toFixed(1)}px`
  );

  await pointerUp(session, tabCenter.x, tabCenter.y + DETACH_OVERSHOOT);
  await sleep(300);

  // --- Test 2: Hover preview slot stays stable on vertical crossing ---
  console.log('\nTest: Hover preview slot stable during vertical tab bar crossing');

  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);
  await page.$eval('.motion--control', (el) => { el.style.display = 'none'; });

  const tab2Center = await getTabCenter(page, '.browser', 1);
  if (!tab2Center) {
    console.error('  Could not find second tab after reload');
    await browser.close();
    process.exit(1);
  }

  await pointerMove(session, tab2Center.x, tab2Center.y);
  await sleep(50);
  await pointerDown(session, tab2Center.x, tab2Center.y);
  await dragSteps(session, tab2Center, { x: tab2Center.x, y: tab2Center.y + 10 }, 5);
  await dragSteps(session, { x: tab2Center.x, y: tab2Center.y + 10 }, { x: tab2Center.x, y: tab2Center.y + DETACH_OVERSHOOT }, 30);
  await sleep(200);

  const panelsAfterDetach = await page.$$eval('.browser', (els) => els.length);
  if (panelsAfterDetach < 2) {
    await dragSteps(session, { x: tab2Center.x, y: tab2Center.y + DETACH_OVERSHOOT }, { x: tab2Center.x, y: tab2Center.y + DETACH_OVERSHOOT + 80 }, 20);
    await sleep(200);
  }

  const sourceTabListTop = await page.$eval('.browser', (panel) => {
    const row = panel.querySelector('.tab--row');
    const r = row.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, centerY: r.top + r.height / 2 };
  });

  const hoverX = tab2Center.x;
  const aboveBar = sourceTabListTop.top - 40;
  const insideBar = sourceTabListTop.centerY;

  const crossingSamples = [];
  const numCrossings = 6;

  for (let i = 0; i < numCrossings; i++) {
    const enterY = insideBar;
    const exitY = aboveBar;

    await dragSteps(session, { x: hoverX, y: exitY }, { x: hoverX, y: enterY }, 5);
    await sleep(80);

    const widthAfterEnter = await page.$eval('.browser', (panel) => {
      const tabs = panel.querySelectorAll('.tab--item');
      const addBtn = panel.querySelector('.tab--add');
      const lastTab = tabs[tabs.length - 1];
      const addRect = addBtn?.getBoundingClientRect();
      const lastTabRect = lastTab?.getBoundingClientRect();
      return {
        addBtnLeft: addRect?.left ?? null,
        lastTabRight: lastTabRect?.right ?? null,
        tabWidths: Array.from(tabs).map((t) => t.getBoundingClientRect().width),
        tabCount: tabs.length
      };
    });
    crossingSamples.push(widthAfterEnter);

    await dragSteps(session, { x: hoverX, y: enterY }, { x: hoverX, y: exitY }, 5);
    await sleep(40);
  }

  const previewWidths = crossingSamples
    .flatMap((s) => s.tabWidths)
    .filter((w) => w > 0);

  if (previewWidths.length >= 2) {
    const maxPW = Math.max(...previewWidths);
    const minPW = Math.min(...previewWidths);
    const pwRange = maxPW - minPW;
    console.log(`  Tab widths across ${numCrossings} crossings: min=${minPW.toFixed(1)}, max=${maxPW.toFixed(1)}, range=${pwRange.toFixed(1)}`);
    assert(
      pwRange < 10,
      `Tab widths should be stable across crossings: range=${pwRange.toFixed(1)}px (max 10px allowed)`
    );
  }

  const addBtnGaps = crossingSamples
    .filter((s) => s.addBtnLeft != null && s.lastTabRight != null)
    .map((s) => s.addBtnLeft - s.lastTabRight);

  if (addBtnGaps.length >= 2) {
    const maxGap = Math.max(...addBtnGaps);
    console.log(`  Max gap before add button: ${maxGap.toFixed(1)}px`);
    assert(
      maxGap < 20,
      `Add button should not shift significantly during crossings: max gap=${maxGap.toFixed(1)}px`
    );
  }

  await pointerUp(session, hoverX, aboveBar);
  await sleep(200);

  console.log(`\nResults: ${results.passed} passed, ${results.failed} failed`);
  if (results.errors.length > 0) {
    console.log('Failures:');
    results.errors.forEach((e) => console.log(`  - ${e}`));
  }

  await browser.close();
  process.exit(results.failed > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
