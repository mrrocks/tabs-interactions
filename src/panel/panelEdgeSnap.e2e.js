import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 800 };
const SNAP_ZONE_X = 20;
const DETACH_THRESHOLD = 220;
const RESISTANCE_MAX = 35;
const SNAP_ANIM_WAIT = 400;
const UNSNAP_ANIM_WAIT = 400;
const MAX_ALLOWED_JUMP_PX = 50;
const STEP_DELAY_MS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getPanelRect = (page) =>
  page.$eval('[data-resizable]', (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });

const getPanelVisualLeft = (page) =>
  page.$eval('[data-resizable]', (el) => el.getBoundingClientRect().left);

const getTitleBarGrabPoint = (page) =>
  page.$eval('[data-resizable]', (el) => {
    const tabRow = el.querySelector('.tab--row');
    const controls = el.querySelector('.window--controls');
    const tabList = el.querySelector('.tab--list');
    const rowRect = tabRow.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const tabListRect = tabList.getBoundingClientRect();
    const x = controlsRect.right + (tabListRect.left - controlsRect.right) / 2;
    return { x, y: rowRect.top + rowRect.height / 2 };
  });

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

const dragSteps = async (page, session, from, to, steps = 20) => {
  const positions = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    await pointerMove(session, x, y);
    await sleep(STEP_DELAY_MS);
    const left = await getPanelVisualLeft(page);
    positions.push({ x, y, left });
  }
  return positions;
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
    } else {
      results.failed++;
      results.errors.push(msg);
      console.error(`  FAIL: ${msg}`);
    }
  };

  // --- Test 1: Snap to left edge ---
  console.log('Test 1: Snap window to left edge');
  const initial = await getPanelRect(page);
  const grab = await getTitleBarGrabPoint(page);
  console.log(`  Initial: left=${initial.left}, width=${initial.width}, grab=(${grab.x.toFixed(0)}, ${grab.y.toFixed(0)})`);

  await pointerMove(session, grab.x, grab.y);
  await sleep(50);
  await pointerDown(session, grab.x, grab.y);
  await dragSteps(page, session, grab, { x: SNAP_ZONE_X, y: grab.y }, 20);
  await pointerUp(session, SNAP_ZONE_X, grab.y);
  await sleep(SNAP_ANIM_WAIT);

  const snapped = await getPanelRect(page);
  assert(snapped.left <= 2, `Panel should be snapped to left edge, got left=${snapped.left}`);
  assert(Math.abs(snapped.width - VIEWPORT.width / 2) < 5, `Panel width should be ~${VIEWPORT.width / 2}, got ${snapped.width}`);
  console.log(`  Snapped: left=${snapped.left}, width=${snapped.width}`);

  if (snapped.left > 2 || Math.abs(snapped.width - VIEWPORT.width / 2) > 5) {
    console.log('\n  Snap failed — aborting remaining tests');
    await browser.close();
    process.exit(1);
  }

  // --- Test 2: Click should NOT unsnap ---
  console.log('Test 2: Click on snapped window preserves snap');
  const clickGrab = await getTitleBarGrabPoint(page);
  await pointerMove(session, clickGrab.x, clickGrab.y);
  await sleep(50);
  await pointerDown(session, clickGrab.x, clickGrab.y);
  await sleep(50);
  await pointerUp(session, clickGrab.x, clickGrab.y);
  await sleep(200);

  const afterClick = await getPanelRect(page);
  assert(
    Math.abs(afterClick.width - snapped.width) < 2,
    `Width should stay ${snapped.width} after click, got ${afterClick.width}`
  );
  console.log(`  After click: left=${afterClick.left}, width=${afterClick.width}`);

  // --- Test 3: Resistance phase — sub-threshold drag stays snapped ---
  console.log('Test 3: Small drag stays in resistance (no unsnap)');
  const resistGrab = await getTitleBarGrabPoint(page);
  await pointerMove(session, resistGrab.x, resistGrab.y);
  await sleep(50);
  await pointerDown(session, resistGrab.x, resistGrab.y);

  const resistPositions = await dragSteps(
    page, session,
    resistGrab,
    { x: resistGrab.x + 60, y: resistGrab.y },
    15
  );

  await pointerUp(session, resistGrab.x + 60, resistGrab.y);
  await sleep(200);

  const afterResist = await getPanelRect(page);
  assert(
    Math.abs(afterResist.width - snapped.width) < 2,
    `Width should still be snapped (${snapped.width}) after sub-threshold drag, got ${afterResist.width}`
  );

  const maxResistDisplacement = Math.max(...resistPositions.map((p) => Math.abs(p.left - snapped.left)));
  assert(
    maxResistDisplacement <= RESISTANCE_MAX + 5,
    `Resistance displacement should be <= ${RESISTANCE_MAX}px, got ${maxResistDisplacement.toFixed(1)}`
  );
  console.log(`  Max resistance displacement: ${maxResistDisplacement.toFixed(1)}px`);
  console.log(`  After release: left=${afterResist.left}, width=${afterResist.width}`);

  // --- Test 4: Drag past threshold — smooth unsnap, no jump ---
  console.log('Test 4: Drag past threshold unsnaps smoothly (no jump)');

  const unsnapGrab = await getTitleBarGrabPoint(page);

  await pointerMove(session, unsnapGrab.x, unsnapGrab.y);
  await sleep(50);
  await pointerDown(session, unsnapGrab.x, unsnapGrab.y);

  const totalDrag = DETACH_THRESHOLD + 40;
  const unsnapPositions = await dragSteps(
    page, session,
    unsnapGrab,
    { x: unsnapGrab.x + totalDrag, y: unsnapGrab.y },
    40
  );

  let maxJump = 0;
  let jumpAt = null;
  for (let i = 1; i < unsnapPositions.length; i++) {
    const jump = Math.abs(unsnapPositions[i].left - unsnapPositions[i - 1].left);
    if (jump > maxJump) {
      maxJump = jump;
      jumpAt = i;
    }
  }

  console.log(`  Max frame-to-frame jump: ${maxJump.toFixed(1)}px at step ${jumpAt}`);
  console.log(`  Positions around threshold crossing:`);
  const thresholdStep = Math.round((DETACH_THRESHOLD / totalDrag) * 40);
  for (let i = Math.max(0, thresholdStep - 3); i < Math.min(unsnapPositions.length, thresholdStep + 4); i++) {
    const p = unsnapPositions[i];
    console.log(`    step ${i}: pointer.x=${p.x.toFixed(1)}, panel.left=${p.left.toFixed(1)}`);
  }

  assert(
    maxJump < MAX_ALLOWED_JUMP_PX,
    `Max frame-to-frame left jump should be < ${MAX_ALLOWED_JUMP_PX}px, got ${maxJump.toFixed(1)}px at step ${jumpAt}`
  );

  await sleep(UNSNAP_ANIM_WAIT);

  const afterUnsnap = await getPanelRect(page);
  assert(
    Math.abs(afterUnsnap.width - initial.width) < 10,
    `Width should be restored to ~${initial.width}, got ${afterUnsnap.width}`
  );
  console.log(`  After unsnap + animation: left=${afterUnsnap.left.toFixed(1)}, width=${afterUnsnap.width.toFixed(1)}`);

  await pointerUp(session, unsnapGrab.x + totalDrag, unsnapGrab.y);

  // --- Summary ---
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
