import { describe, expect, it } from 'vitest';
import {
  applyResistance,
  computeOvershoot,
  detachThresholdPx,
  getInsertionIndexFromCenters,
  getProxySettleDelta,
  resistanceMaxPx,
  resistanceOnsetInsetPx,
  resolveDetachIntent,
  resolveDropDetachIntent,
  resolveDropAttachTarget,
  resolveDragVisualOffsetX,
  resolveDragVisualOffsetY,
  resolveHoverPreviewWidthPx,
  resolveSourceActivationIndexAfterDetach,
  shouldCloseSourcePanelAfterTransfer,
  shouldDetachFromOvershoot,
  shouldDetachOnDrop,
  shouldRemoveSourceWindowOnDetach,
  windowAttachPaddingPx
} from './dragCalculations';

describe('getInsertionIndexFromCenters', () => {
  it('returns insertion index by crossing sibling centers', () => {
    expect(getInsertionIndexFromCenters({ centers: [100, 200, 300], pointerClientX: 20 })).toBe(0);
    expect(getInsertionIndexFromCenters({ centers: [100, 200, 300], pointerClientX: 150 })).toBe(1);
    expect(getInsertionIndexFromCenters({ centers: [100, 200, 300], pointerClientX: 500 })).toBe(3);
  });
});

describe('applyResistance', () => {
  it('reduces drag distance and clamps to max offset', () => {
    expect(applyResistance(60)).toBeLessThan(60);
    expect(applyResistance(10_000)).toBe(resistanceMaxPx);
    expect(applyResistance(-10_000)).toBe(-resistanceMaxPx);
  });

  it('returns zero for zero input', () => {
    expect(applyResistance(0)).toBe(0);
  });
});

describe('computeOvershoot', () => {
  it('returns zero when value is inside the inset boundary', () => {
    expect(computeOvershoot({ value: 50, min: 0, max: 100, inset: 4 })).toBe(0);
  });

  it('returns negative overshoot past the left/top inset edge', () => {
    expect(computeOvershoot({ value: 2, min: 0, max: 100, inset: 4 })).toBe(-2);
  });

  it('returns positive overshoot past the right/bottom inset edge', () => {
    expect(computeOvershoot({ value: 98, min: 0, max: 100, inset: 4 })).toBe(2);
  });

  it('returns zero exactly at the inset boundary', () => {
    expect(computeOvershoot({ value: 4, min: 0, max: 100, inset: 4 })).toBe(0);
    expect(computeOvershoot({ value: 96, min: 0, max: 100, inset: 4 })).toBe(0);
  });

  it('uses resistanceOnsetInsetPx as default inset', () => {
    expect(computeOvershoot({ value: 0, min: 0, max: 100 })).toBe(-resistanceOnsetInsetPx);
  });
});

describe('shouldDetachFromOvershoot', () => {
  it('detaches when X overshoot reaches threshold', () => {
    expect(shouldDetachFromOvershoot(detachThresholdPx, 0)).toBe(true);
    expect(shouldDetachFromOvershoot(-detachThresholdPx, 0)).toBe(true);
  });

  it('detaches when Y overshoot reaches threshold', () => {
    expect(shouldDetachFromOvershoot(0, detachThresholdPx)).toBe(true);
  });

  it('does not detach when both overshoots are below threshold', () => {
    expect(shouldDetachFromOvershoot(detachThresholdPx - 1, detachThresholdPx - 1)).toBe(false);
  });

  it('uses the max of both axes', () => {
    expect(shouldDetachFromOvershoot(10, detachThresholdPx)).toBe(true);
    expect(shouldDetachFromOvershoot(detachThresholdPx, 10)).toBe(true);
  });
});

describe('shouldDetachOnDrop', () => {
  it('creates detached window when detach intent is active on drop', () => {
    expect(shouldDetachOnDrop({ detachIntentActive: true })).toBe(true);
    expect(shouldDetachOnDrop({ detachIntentActive: false })).toBe(false);
  });
});

describe('resolveDragVisualOffsetY', () => {
  it('applies resistance only to overshoot portion before detach', () => {
    const result = resolveDragVisualOffsetY({ deltaY: 80, overshootY: 30, detachIntentActive: false });
    expect(result).toBe(80 - 30 + applyResistance(30));
  });

  it('returns raw deltaY after detach', () => {
    expect(resolveDragVisualOffsetY({ deltaY: 80, overshootY: 30, detachIntentActive: true })).toBe(80);
  });
});

describe('resolveDragVisualOffsetX', () => {
  it('applies resistance only to overshoot portion before detach', () => {
    const result = resolveDragVisualOffsetX({ deltaX: 120, overshootX: 40, detachIntentActive: false });
    expect(result).toBe(120 - 40 + applyResistance(40));
  });

  it('returns raw deltaX after detach', () => {
    expect(resolveDragVisualOffsetX({ deltaX: 120, overshootX: 40, detachIntentActive: true })).toBe(120);
  });

  it('passes through deltaX when overshoot is zero', () => {
    expect(resolveDragVisualOffsetX({ deltaX: 50, overshootX: 0, detachIntentActive: false })).toBe(50);
  });
});

describe('resolveHoverPreviewWidthPx', () => {
  it('prefers drag proxy base rect width when available', () => {
    expect(
      resolveHoverPreviewWidthPx({
        dragProxyBaseRect: { width: 132 },
        draggedTab: { getBoundingClientRect: () => ({ width: 120 }) }
      })
    ).toBe(132);
  });

  it('falls back to dragged tab bounding width when base rect is absent', () => {
    expect(
      resolveHoverPreviewWidthPx({
        draggedTab: { getBoundingClientRect: () => ({ width: 124 }) }
      })
    ).toBe(124);
  });
});

describe('resolveDetachIntent', () => {
  it('activates from vertical overshoot exceeding threshold', () => {
    expect(resolveDetachIntent({ currentIntent: false, overshootY: detachThresholdPx + 1 })).toBe(true);
  });

  it('activates from horizontal overshoot exceeding threshold', () => {
    expect(resolveDetachIntent({ currentIntent: false, overshootX: detachThresholdPx + 1 })).toBe(true);
  });

  it('stays active once intent is set regardless of current overshoot', () => {
    expect(resolveDetachIntent({ currentIntent: true, overshootX: 0, overshootY: 0 })).toBe(true);
  });

  it('stays inactive when both overshoots are below threshold', () => {
    expect(resolveDetachIntent({ currentIntent: false, overshootX: 10, overshootY: 10 })).toBe(false);
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

describe('shouldRemoveSourceWindowOnDetach', () => {
  it('removes source window only when dragging its single tab', () => {
    expect(shouldRemoveSourceWindowOnDetach(1)).toBe(true);
    expect(shouldRemoveSourceWindowOnDetach(2)).toBe(false);
    expect(shouldRemoveSourceWindowOnDetach(0)).toBe(false);
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

describe('resolveDropAttachTarget', () => {
  it('prefers explicit attach target when available', () => {
    const sourceTabList = { id: 'source', isConnected: true };
    const attachTargetTabList = { id: 'target-a', isConnected: true };
    const hoverAttachTabList = { id: 'target-b', isConnected: true };

    expect(
      resolveDropAttachTarget({
        attachTargetTabList,
        hoverAttachTabList,
        sourceTabList
      })
    ).toBe(attachTargetTabList);
  });

  it('falls back to last hovered attach target when explicit target misses', () => {
    const sourceTabList = { id: 'source', isConnected: true };
    const hoverAttachTabList = { id: 'target', isConnected: true };

    expect(
      resolveDropAttachTarget({
        attachTargetTabList: null,
        hoverAttachTabList,
        sourceTabList,
        dropClientX: 300,
        dropClientY: 200,
        hoverAttachClientX: 320,
        hoverAttachClientY: 210
      })
    ).toBe(hoverAttachTabList);
  });

  it('rejects source or disconnected fallback targets', () => {
    const sourceTabList = { id: 'source', isConnected: true };
    const disconnectedHoverTarget = { id: 'target', isConnected: false };

    expect(
      resolveDropAttachTarget({
        attachTargetTabList: null,
        hoverAttachTabList: sourceTabList,
        sourceTabList,
        dropClientX: 100,
        dropClientY: 100,
        hoverAttachClientX: 100,
        hoverAttachClientY: 100
      })
    ).toBeNull();
    expect(
      resolveDropAttachTarget({
        attachTargetTabList: null,
        hoverAttachTabList: disconnectedHoverTarget,
        sourceTabList,
        dropClientX: 100,
        dropClientY: 100,
        hoverAttachClientX: 100,
        hoverAttachClientY: 100
      })
    ).toBeNull();
  });

  it('ignores stale hover target when drop is far away', () => {
    const sourceTabList = { id: 'source', isConnected: true };
    const hoverAttachTabList = { id: 'target', isConnected: true };

    expect(
      resolveDropAttachTarget({
        attachTargetTabList: null,
        hoverAttachTabList,
        sourceTabList,
        dropClientX: 600,
        dropClientY: 420,
        hoverAttachClientX: 120,
        hoverAttachClientY: 60,
        fallbackRadiusPx: 48
      })
    ).toBeNull();
  });
});

describe('resolveDropDetachIntent', () => {
  it('keeps detach when detach intent is active', () => {
    expect(
      resolveDropDetachIntent({
        detachIntentActive: true,
        isDropInsideCurrentHeader: false,
        didCrossWindowAttach: false
      })
    ).toBe(true);
  });

  it('does not detach when drop stays in current header', () => {
    expect(
      resolveDropDetachIntent({
        detachIntentActive: true,
        isDropInsideCurrentHeader: true,
        didCrossWindowAttach: false
      })
    ).toBe(false);
  });

  it('stays false when detach intent is not active', () => {
    expect(
      resolveDropDetachIntent({
        detachIntentActive: false,
        isDropInsideCurrentHeader: false,
        didCrossWindowAttach: false
      })
    ).toBe(false);
  });

  it('cancels detach after cross-window attach in the same drag', () => {
    expect(
      resolveDropDetachIntent({
        detachIntentActive: true,
        isDropInsideCurrentHeader: false,
        didCrossWindowAttach: true
      })
    ).toBe(false);
  });
});

describe('resolveSourceActivationIndexAfterDetach', () => {
  it('activates the previous tab when the middle tab is detached', () => {
    expect(resolveSourceActivationIndexAfterDetach(2, 3)).toBe(1);
  });

  it('activates index 0 when the first tab is detached', () => {
    expect(resolveSourceActivationIndexAfterDetach(0, 2)).toBe(0);
  });

  it('returns -1 when no tabs remain after detach', () => {
    expect(resolveSourceActivationIndexAfterDetach(0, 0)).toBe(-1);
  });
});
