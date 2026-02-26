import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 800 };
const DETACH_OVERSHOOT = 130;
// At the sync point (right after applyPanelFrame), the correction is exact.
// 1px tolerance covers sub-pixel rounding in getBoundingClientRect.
const MAX_DRIFT_AT_SYNC_PX = 1;

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

const dragSteps = async (session, from, to, steps = 20, delayMs = 30) => {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    await pointerMove(
      session,
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t
    );
    if (delayMs > 0) await sleep(delayMs);
  }
};

const getTabCenter = (page, panelSelector, tabIndex) =>
  page.$eval(
    panelSelector,
    (panel, idx) => {
      const tab = panel.querySelectorAll('.tab--item')[idx];
      if (!tab) return null;
      const r = tab.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    tabIndex
  );

const getPanelCount = (page) => page.$$eval('.browser', (els) => els.length);

/**
 * Injects a MutationObserver-based sampler. It fires as a microtask immediately
 * after each applyPanelFrame call (which sets panel.style.left/top/width/height),
 * so the measurement happens right after the scale correction has been applied.
 *
 * This avoids the rAF-ordering artifact where a requestAnimationFrame sampler
 * could fire before the app's sync rAF within the same frame.
 *
 * Captures until proxy.style.pointerEvents === 'none' (fadeOutProxy fired).
 */
const injectSampler = (page) =>
  page.evaluate(() => {
    window.__alignSamples = [];
    window.__alignSpawnT = null;
    window.__panelStyleObserver = null;

    const captureAlignment = (panel) => {
      const proxy = document.querySelector('.tab--drag-proxy');
      if (!proxy || proxy.style.pointerEvents === 'none') {
        window.__panelStyleObserver?.disconnect();
        window.__panelStyleObserver = null;
        return;
      }
      const tab = panel.querySelector('.tab--item');
      if (!tab) return;
      if (window.__alignSpawnT === null) window.__alignSpawnT = performance.now();
      const pr = proxy.getBoundingClientRect();
      const tr = tab.getBoundingClientRect();
      window.__alignSamples.push([
        Math.round(performance.now() - window.__alignSpawnT),
        parseFloat((pr.left - tr.left).toFixed(1)),
        parseFloat((pr.top - tr.top).toFixed(1))
      ]);
    };

    // Watch for the detached panel to be added to the DOM
    const bodyObserver = new MutationObserver(() => {
      const panels = document.querySelectorAll('.browser');
      if (panels.length < 2 || window.__panelStyleObserver) return;
      const panel = panels[panels.length - 1];

      // Observe style attribute changes on the panel — fires as a microtask
      // immediately after each applyPanelFrame call.
      window.__panelStyleObserver = new MutationObserver(() => {
        captureAlignment(panel);
      });
      window.__panelStyleObserver.observe(panel, {
        attributes: true,
        attributeFilter: ['style']
      });
      bodyObserver.disconnect();
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
  });

const readSamples = (page) =>
  page.evaluate(() => window.__alignSamples ?? []);

const waitForDetach = async (page, countBefore, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await getPanelCount(page)) > countBefore) return true;
    await sleep(16);
  }
  return false;
};

const driftStats = (samples) => {
  if (!samples.length) return null;
  const xs = samples.map((s) => Math.abs(s[1]));
  const ys = samples.map((s) => Math.abs(s[2]));
  return {
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    avgX: xs.reduce((a, b) => a + b, 0) / xs.length,
    avgY: ys.reduce((a, b) => a + b, 0) / ys.length,
    count: samples.length
  };
};

const formatLog = (samples) =>
  samples
    .map((s) => `t=${s[0]}ms (${s[1] >= 0 ? '+' : ''}${s[1]},${s[2] >= 0 ? '+' : ''}${s[2]})`)
    .join(' ');

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

  const disableMotion = () =>
    page.$eval('.motion--control', (el) => { el.style.display = 'none'; });

  const resetPage = async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(600);
    await disableMotion();
  };

  // ── Test 1: Fast detach + fast continued movement ──────────────────────────
  // Primary test: reproduces the user's scenario. Samples alignment immediately
  // after each applyPanelFrame (right after scale correction is applied). With
  // the fix, drift at each sync point should be ~0px.
  console.log('Test 1: Fast detach + fast movement — proxy/window alignment at each sync point');

  await disableMotion();
  await injectSampler(page);

  let countBefore = await getPanelCount(page);
  let tabCenter = await getTabCenter(page, '.browser', 1);
  if (!tabCenter) {
    console.error('  No second tab found');
    await browser.close();
    process.exit(1);
  }

  await pointerMove(session, tabCenter.x, tabCenter.y);
  await sleep(50);
  await pointerDown(session, tabCenter.x, tabCenter.y);
  await dragSteps(
    session,
    tabCenter,
    { x: tabCenter.x, y: tabCenter.y + DETACH_OVERSHOOT + 60 },
    60,
    0
  );

  if (!await waitForDetach(page, countBefore, 2000)) {
    console.error('  Detach never triggered — aborting');
    await pointerUp(session, tabCenter.x, tabCenter.y + DETACH_OVERSHOOT + 60);
    await browser.close();
    process.exit(1);
  }

  // Continue fast horizontal movement to drive sync calls through the animation
  const fixedY = tabCenter.y + DETACH_OVERSHOOT + 60;
  let curX = tabCenter.x;
  let direction = 1;
  const stressDeadline = Date.now() + 400;

  while (Date.now() < stressDeadline) {
    curX += direction * 10;
    if (curX > VIEWPORT.width - 150 || curX < 150) direction *= -1;
    await pointerMove(session, curX, fixedY);
    await sleep(16);
  }

  await pointerUp(session, curX, fixedY);
  await sleep(200);

  const t1Samples = await readSamples(page);
  const t1Stats = driftStats(t1Samples);

  if (t1Stats) {
    console.log(`  ${t1Stats.count} sync-point samples, t=0..${Math.max(...t1Samples.map((s) => s[0]))}ms`);
    console.log(`  driftX max=${t1Stats.maxX.toFixed(1)}px avg=${t1Stats.avgX.toFixed(1)}px | driftY max=${t1Stats.maxY.toFixed(1)}px avg=${t1Stats.avgY.toFixed(1)}px`);
    console.log(`  All samples: ${formatLog(t1Samples)}`);
    assert(
      t1Stats.maxX < MAX_DRIFT_AT_SYNC_PX,
      `Fast-detach driftX at sync < ${MAX_DRIFT_AT_SYNC_PX}px: got ${t1Stats.maxX.toFixed(1)}px`
    );
    assert(
      t1Stats.maxY < MAX_DRIFT_AT_SYNC_PX,
      `Fast-detach driftY at sync < ${MAX_DRIFT_AT_SYNC_PX}px: got ${t1Stats.maxY.toFixed(1)}px`
    );
  } else {
    console.error('  No sync-point samples collected');
  }

  // ── Test 2: Slow detach + stationary ───────────────────────────────────────
  // Baseline: rAF loop is the only source of sync calls (no pointer movement).
  // In headless mode rAF fires less often, so fewer samples. Still verifies
  // each sync point achieves near-zero drift.
  console.log('\nTest 2: Slow detach, stationary — alignment at each rAF sync point');

  await resetPage();
  await injectSampler(page);

  countBefore = await getPanelCount(page);
  tabCenter = await getTabCenter(page, '.browser', 1);
  if (!tabCenter) {
    console.error('  No second tab found');
    await browser.close();
    process.exit(1);
  }

  await pointerMove(session, tabCenter.x, tabCenter.y);
  await sleep(50);
  await pointerDown(session, tabCenter.x, tabCenter.y);
  await dragSteps(session, tabCenter, { x: tabCenter.x, y: tabCenter.y + 10 }, 5, 30);
  await dragSteps(
    session,
    { x: tabCenter.x, y: tabCenter.y + 10 },
    { x: tabCenter.x, y: tabCenter.y + DETACH_OVERSHOOT },
    30,
    30
  );
  await sleep(50);

  if (!await waitForDetach(page, countBefore)) {
    console.error('  Detach never triggered — aborting');
    await pointerUp(session, tabCenter.x, tabCenter.y + DETACH_OVERSHOOT);
    await browser.close();
    process.exit(1);
  }

  // Hold position — sync driven only by the rAF loop, no pointer events
  await sleep(400);
  await pointerUp(session, tabCenter.x, tabCenter.y + DETACH_OVERSHOOT);
  await sleep(200);

  const t2Samples = await readSamples(page);
  const t2Stats = driftStats(t2Samples);

  if (t2Stats) {
    console.log(`  ${t2Stats.count} sync-point samples`);
    console.log(`  driftX max=${t2Stats.maxX.toFixed(1)}px avg=${t2Stats.avgX.toFixed(1)}px | driftY max=${t2Stats.maxY.toFixed(1)}px avg=${t2Stats.avgY.toFixed(1)}px`);
    if (t2Samples.length <= 20) console.log(`  All samples: ${formatLog(t2Samples)}`);
    assert(
      t2Stats.maxX < MAX_DRIFT_AT_SYNC_PX,
      `Slow-detach driftX at sync < ${MAX_DRIFT_AT_SYNC_PX}px: got ${t2Stats.maxX.toFixed(1)}px`
    );
    assert(
      t2Stats.maxY < MAX_DRIFT_AT_SYNC_PX,
      `Slow-detach driftY at sync < ${MAX_DRIFT_AT_SYNC_PX}px: got ${t2Stats.maxY.toFixed(1)}px`
    );
  } else {
    console.log('  No sync-point samples (rAF may have been throttled before proxy parked)');
  }

  // ── Test 3: Spawn-moment snapshot ──────────────────────────────────────────
  // Tight-polls for the newly-created panel and captures panel CSS + proxy/tab
  // positions as early as the CDP roundtrip allows (~10-30ms after spawn).
  // With the fix, the panel CSS position accounts for the spawn-time scale so
  // tab.getBoundingClientRect() should match proxy.getBoundingClientRect().
  console.log('\nTest 3: Spawn-moment — positional snapshot at window creation');

  await resetPage();

  countBefore = await getPanelCount(page);
  tabCenter = await getTabCenter(page, '.browser', 1);
  if (!tabCenter) {
    console.error('  No second tab found');
    await browser.close();
    process.exit(1);
  }

  await pointerMove(session, tabCenter.x, tabCenter.y);
  await sleep(50);
  await pointerDown(session, tabCenter.x, tabCenter.y);
  await dragSteps(
    session,
    tabCenter,
    { x: tabCenter.x, y: tabCenter.y + DETACH_OVERSHOOT + 40 },
    30,
    5
  );

  let spawnSnapshot = null;
  const spawnDeadline = Date.now() + 3000;
  while (Date.now() < spawnDeadline) {
    if ((await getPanelCount(page)) > countBefore) {
      spawnSnapshot = await page.evaluate(() => {
        const proxy = document.querySelector('.tab--drag-proxy');
        const panels = document.querySelectorAll('.browser');
        const panel = panels[panels.length - 1];
        const tab = panel?.querySelector('.tab--item');
        const pr = proxy?.getBoundingClientRect();
        const tr = tab?.getBoundingClientRect();
        return {
          panelCssLeft: parseFloat(panel?.style.left ?? 'NaN'),
          panelCssTop: parseFloat(panel?.style.top ?? 'NaN'),
          proxyLeft: pr ? parseFloat(pr.left.toFixed(1)) : null,
          proxyTop: pr ? parseFloat(pr.top.toFixed(1)) : null,
          tabLeft: tr ? parseFloat(tr.left.toFixed(1)) : null,
          tabTop: tr ? parseFloat(tr.top.toFixed(1)) : null
        };
      });
      break;
    }
    await sleep(8);
  }

  const finalDetachY = tabCenter.y + DETACH_OVERSHOOT + 40;
  await pointerUp(session, tabCenter.x, finalDetachY);
  await sleep(300);

  if (spawnSnapshot) {
    const { panelCssLeft, panelCssTop, proxyLeft, proxyTop, tabLeft, tabTop } = spawnSnapshot;
    console.log(`  Panel CSS:  left=${panelCssLeft}  top=${panelCssTop}`);
    console.log(`  Proxy rect: left=${proxyLeft}  top=${proxyTop}`);
    console.log(`  Tab rect:   left=${tabLeft}  top=${tabTop}`);
    if (proxyLeft != null && tabLeft != null) {
      const spawnDriftX = parseFloat((proxyLeft - tabLeft).toFixed(1));
      const spawnDriftY = parseFloat((proxyTop - tabTop).toFixed(1));
      console.log(`  Spawn-moment drift: driftX=${spawnDriftX}px  driftY=${spawnDriftY}px`);
      assert(
        Math.abs(spawnDriftX) < 5,
        `Spawn-moment driftX < 5px: got ${spawnDriftX}px`
      );
      assert(
        Math.abs(spawnDriftY) < 5,
        `Spawn-moment driftY < 5px: got ${spawnDriftY}px`
      );
    } else {
      console.log('  Proxy or tab not found at spawn moment');
    }
  } else {
    console.error('  Detach never occurred in Test 3');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
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
