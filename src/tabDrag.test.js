import { describe, expect, it } from 'vitest';
import {
  applyVerticalResistance,
  detachHysteresisPx,
  detachThresholdPx,
  getInsertionIndexFromCenters,
  getProxySettleDelta,
  resolveDetachIntent,
  resolveDragVisualOffsetY,
  shouldCloseSourcePanelAfterTransfer,
  shouldDetachOnDrop,
  shouldRemoveSourceWindowOnDetach,
  shouldArmReattach,
  shouldDetachFromVerticalDelta,
  shouldReattachToOriginalStrip,
  windowAttachPaddingPx,
  verticalResistanceMaxPx
} from './tabDrag';

describe('getInsertionIndexFromCenters', () => {
  it('returns insertion index by crossing sibling centers', () => {
    expect(getInsertionIndexFromCenters({ centers: [100, 200, 300], pointerClientX: 20 })).toBe(0);
    expect(getInsertionIndexFromCenters({ centers: [100, 200, 300], pointerClientX: 150 })).toBe(1);
    expect(getInsertionIndexFromCenters({ centers: [100, 200, 300], pointerClientX: 500 })).toBe(3);
  });
});

describe('applyVerticalResistance', () => {
  it('reduces vertical drag distance and clamps to max offset', () => {
    expect(applyVerticalResistance(60)).toBeLessThan(60);
    expect(applyVerticalResistance(10_000)).toBe(verticalResistanceMaxPx);
    expect(applyVerticalResistance(-10_000)).toBe(-verticalResistanceMaxPx);
  });
});

describe('shouldDetachFromVerticalDelta', () => {
  it('detaches only when absolute vertical movement reaches threshold', () => {
    expect(shouldDetachFromVerticalDelta(detachThresholdPx - 1)).toBe(false);
    expect(shouldDetachFromVerticalDelta(detachThresholdPx)).toBe(true);
    expect(shouldDetachFromVerticalDelta(-detachThresholdPx)).toBe(true);
  });
});

describe('detach and reattach progression', () => {
  const originalStripRect = {
    left: 100,
    right: 500,
    top: 40,
    bottom: 88
  };

  it('allows reattach after detach hysteresis while pointer stays down', () => {
    expect(shouldDetachFromVerticalDelta(detachThresholdPx + 4)).toBe(true);
    expect(shouldArmReattach({ clientY: 180, detachOriginY: 180 })).toBe(false);
    expect(shouldArmReattach({ clientY: 180 + detachHysteresisPx, detachOriginY: 180 })).toBe(true);
    expect(
      shouldReattachToOriginalStrip({
        reattachArmed: false,
        clientX: 220,
        clientY: 62,
        rect: originalStripRect
      })
    ).toBe(false);
    expect(
      shouldReattachToOriginalStrip({
        reattachArmed: true,
        clientX: 220,
        clientY: 62,
        rect: originalStripRect
      })
    ).toBe(true);
  });
});

describe('shouldRemoveSourceWindowOnDetach', () => {
  it('removes source window only when dragging its single tab', () => {
    expect(shouldRemoveSourceWindowOnDetach(1)).toBe(true);
    expect(shouldRemoveSourceWindowOnDetach(2)).toBe(false);
  });
});

describe('shouldDetachOnDrop', () => {
  it('creates detached window only on drop from attached detach intent', () => {
    expect(shouldDetachOnDrop({ mode: 'attached', detachIntentActive: true })).toBe(true);
    expect(shouldDetachOnDrop({ mode: 'attached', detachIntentActive: false })).toBe(false);
    expect(shouldDetachOnDrop({ mode: 'detached', detachIntentActive: true })).toBe(false);
  });
});

describe('resolveDragVisualOffsetY', () => {
  it('uses resistance before detach intent and raw delta after', () => {
    expect(resolveDragVisualOffsetY({ deltaY: 80, detachIntentActive: false })).toBe(applyVerticalResistance(80));
    expect(resolveDragVisualOffsetY({ deltaY: 80, detachIntentActive: true })).toBe(80);
  });
});

describe('resolveDetachIntent', () => {
  it('keeps detach intent active once threshold has been crossed', () => {
    expect(resolveDetachIntent({ currentIntent: false, deltaY: detachThresholdPx + 1 })).toBe(true);
    expect(resolveDetachIntent({ currentIntent: true, deltaY: 0 })).toBe(true);
  });
});

describe('windowAttachPaddingPx', () => {
  it('keeps a positive window-level attach tolerance', () => {
    expect(windowAttachPaddingPx).toBeGreaterThan(0);
  });
});

describe('shouldCloseSourcePanelAfterTransfer', () => {
  it('closes source panel only when source has no tabs left', () => {
    expect(
      shouldCloseSourcePanelAfterTransfer({
        sourceTabCountAfterMove: 0
      })
    ).toBe(true);
    expect(
      shouldCloseSourcePanelAfterTransfer({
        sourceTabCountAfterMove: 1
      })
    ).toBe(false);
    expect(
      shouldCloseSourcePanelAfterTransfer({
        sourceTabCountAfterMove: 2
      })
    ).toBe(false);
  });
});

describe('getProxySettleDelta', () => {
  it('computes settle translation from proxy rect to target rect', () => {
    expect(
      getProxySettleDelta({
        proxyRect: { left: 110, top: 80 },
        targetRect: { left: 260, top: 128 }
      })
    ).toEqual({
      deltaX: 150,
      deltaY: 48
    });
  });
});
