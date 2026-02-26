import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 800 };
const DETACH_OVERSHOOT = 130;
// Scale animation duration. Samples before this elapsed-since-spawn mark are
// "during animation"; samples after are expected to be clean.
const SCALE_ANIM_MS = 180;
// Drift threshold for the final convergence window (last 30ms of animation).
// Observed: converges to exactly 0px. 3px provides headroom for rendering variance.
const MAX_DRIFT_CONVERGENCE_PX = 3;
// Max permitted drift at any point during the animation. The scale animation
// causes ~44px geometric offset at peak (scale=0.6, tab ~185px wide). This
// threshold catches catastrophic regressions where sync is broken entirely.
const MAX_DRIFT_ANIMATION_PX = 60;

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
 * Injects a rAF-driven sampler into the page. It runs continuously and records
 * { t, driftX, driftY } for every frame where:
 *   - a detached panel exists (.browser count >= 2)
 *   - the drag proxy is still active (pointerEvents !== 'none')
 *
 * Because sampling happens inside the browser process, it captures the full
 * ~150ms scale-animation window at ~60 fps without CDP roundtrip latency.
 *
 * The "t" value is ms since the sampler was started (performance.now() based).
 * spawnT is set to the first frame where the detached panel appears, allowing
 * post-analysis bucketing relative to spawn time.
 */
const injectSampler = (page) =>
  page.evaluate(() => {
    window.__alignSamples = [];
    window.__alignSpawnT = null;

    const tick = () => {
      const proxy = document.querySelector('.tab--drag-proxy');
      const panels = document.querySelectorAll('.browser');
      const hasDetached = panels.length >= 2;
      const proxyActive = proxy && proxy.style.pointerEvents !== 'none';

      if (hasDetached && window.__alignSpawnT === null) {
        window.__alignSpawnT = performance.now();
      }

      if (hasDetached && proxyActive) {
        const panel = panels[panels.length - 1];
        const tab = panel?.querySelector('.tab--item');
        if (tab) {
          const pr = proxy.getBoundingClientRect();
          const tr = tab.getBoundingClientRect();
          window.__alignSamples.push([
            Math.round(performance.now() - (window.__alignSpawnT ?? performance.now())),
            parseFloat((pr.left - tr.left).toFixed(1)),
            parseFloat((pr.top - tr.top).toFixed(1))
          ]);
        }
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
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

  /**
   * Analyses the in-page samples. Buckets into:
   *   peak    — all samples (overall max drift, i.e. animation peak)
   *   tail    — last 30ms of animation (convergence window)
   * Returns stats objects and raw buckets.
   */
  const analyzeSamples = (samples, label) => {
    if (!samples.length) {
      console.log(`  ${label}: no samples collected`);
      return { peakStats: null, tailStats: null };
    }
    const maxT = Math.max(...samples.map((s) => s[0]));
    const tailMs = 30;
    const tail = samples.filter((s) => s[0] >= maxT - tailMs);
    const peakStats = driftStats(samples);
    const tailStats = driftStats(tail);

    console.log(`  ${label} (${peakStats.count} samples, t=0..${maxT}ms): driftX peak=${peakStats.maxX.toFixed(1)}px avg=${peakStats.avgX.toFixed(1)}px | driftY peak=${peakStats.maxY.toFixed(1)}px avg=${peakStats.avgY.toFixed(1)}px`);
    console.log(`  ${label} convergence (last ${tailMs}ms, ${tailStats?.count ?? 0} samples): driftX=${tailStats?.maxX.toFixed(1) ?? 'n/a'}px | driftY=${tailStats?.maxY.toFixed(1) ?? 'n/a'}px`);
    console.log(`  All samples: ${formatLog(samples)}`);

    return { peakStats, tailStats };
  };

  // ── Test 1: Slow detach, stationary — baseline alignment ───────────────────
  console.log('Test 1: Slow detach, stationary — baseline proxy/window alignment');

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

  await sleep(400);
  await pointerUp(session, tabCenter.x, tabCenter.y + DETACH_OVERSHOOT);
  await sleep(200);

  const t1Samples = await readSamples(page);
  const { peakStats: t1Peak, tailStats: t1Tail } = analyzeSamples(t1Samples, 'T1 stationary');

  if (t1Peak) {
    assert(
      t1Peak.maxX < MAX_DRIFT_ANIMATION_PX,
      `Slow-detach peak driftX < ${MAX_DRIFT_ANIMATION_PX}px: got ${t1Peak.maxX.toFixed(1)}px`
    );
  }
  if (t1Tail) {
    assert(
      t1Tail.maxX < MAX_DRIFT_CONVERGENCE_PX,
      `Slow-detach convergence driftX < ${MAX_DRIFT_CONVERGENCE_PX}px: got ${t1Tail.maxX.toFixed(1)}px`
    );
    assert(
      t1Tail.maxY < MAX_DRIFT_CONVERGENCE_PX,
      `Slow-detach convergence driftY < ${MAX_DRIFT_CONVERGENCE_PX}px: got ${t1Tail.maxY.toFixed(1)}px`
    );
  }

  // ── Test 2: Fast detach + fast continued movement — stress alignment ────────
  console.log('\nTest 2: Fast detach + fast movement — stress alignment');

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
  // Fast downward drag — no inter-step delay to maximise mouse speed at spawn
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

  // Continue moving horizontally fast for 400ms to sample the post-animation period
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

  const t2Samples = await readSamples(page);
  const { peakStats: t2Peak, tailStats: t2Tail } = analyzeSamples(t2Samples, 'T2 fast-move');

  if (t2Peak) {
    assert(
      t2Peak.maxX < MAX_DRIFT_ANIMATION_PX,
      `Fast-detach peak driftX < ${MAX_DRIFT_ANIMATION_PX}px: got ${t2Peak.maxX.toFixed(1)}px`
    );
  }
  if (t2Tail) {
    assert(
      t2Tail.maxX < MAX_DRIFT_CONVERGENCE_PX,
      `Fast-detach convergence driftX < ${MAX_DRIFT_CONVERGENCE_PX}px: got ${t2Tail.maxX.toFixed(1)}px`
    );
    assert(
      t2Tail.maxY < MAX_DRIFT_CONVERGENCE_PX,
      `Fast-detach convergence driftY < ${MAX_DRIFT_CONVERGENCE_PX}px: got ${t2Tail.maxY.toFixed(1)}px`
    );
  }

  // ── Test 3: Spawn-moment snapshot ──────────────────────────────────────────
  // Tight-polls for the newly-created panel and captures panel CSS + proxy/tab
  // positions as early as the CDP roundtrip allows (~10-30ms after spawn).
  // Since applyPanelFrame runs synchronously inside createDetachedWindow before
  // the panel becomes visible, panel CSS left/top is already set when we read it.
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
      // Loose threshold: scale animation is expected to cause drift here;
      // this catches gross JS-level misalignment, not animation-induced offset.
      assert(
        Math.abs(spawnDriftX) < 30,
        `Spawn-moment driftX < 30px (diagnostic): got ${spawnDriftX}px`
      );
      assert(
        Math.abs(spawnDriftY) < 30,
        `Spawn-moment driftY < 30px (diagnostic): got ${spawnDriftY}px`
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
