import { describe, expect, it } from 'vitest';
import {
  applyVerticalResistance,
  detachThresholdPx,
  getInsertionIndexFromCenters,
  getProxySettleDelta,
  resolveDetachIntent,
  resolveDropDetachIntent,
  resolveDropAttachTarget,
  resolveDragVisualOffsetY,
  resolveHoverPreviewWidthPx,
  resolveSourceActivationIndexAfterDetach,
  shouldCloseSourcePanelAfterTransfer,
  shouldDetachFromVerticalDelta,
  shouldDetachOnDrop,
  shouldRemoveSourceWindowOnDetach,
  verticalResistanceMaxPx,
  windowAttachPaddingPx
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

describe('shouldDetachOnDrop', () => {
  it('creates detached window when detach intent is active on drop', () => {
    expect(shouldDetachOnDrop({ detachIntentActive: true })).toBe(true);
    expect(shouldDetachOnDrop({ detachIntentActive: false })).toBe(false);
  });
});

describe('resolveDragVisualOffsetY', () => {
  it('uses resistance before detach intent and raw delta after', () => {
    expect(resolveDragVisualOffsetY({ deltaY: 80, detachIntentActive: false })).toBe(applyVerticalResistance(80));
    expect(resolveDragVisualOffsetY({ deltaY: 80, detachIntentActive: true })).toBe(80);
  });
});

describe('resolveHoverPreviewWidthPx', () => {
  it('prefers drag proxy base width when available', () => {
    expect(
      resolveHoverPreviewWidthPx({
        dragProxyBaseRect: { width: 132 },
        draggedTab: {
          style: { minWidth: '120px' },
          getBoundingClientRect: () => ({ width: 0 })
        }
      })
    ).toBe(132);
  });

  it('falls back to drag proxy or dragged tab width when source is detached', () => {
    expect(
      resolveHoverPreviewWidthPx({
        dragProxy: {
          getBoundingClientRect: () => ({ width: 128 })
        },
        draggedTab: {
          style: { minWidth: '120px' },
          getBoundingClientRect: () => ({ width: 0 })
        }
      })
    ).toBe(128);
    expect(
      resolveHoverPreviewWidthPx({
        dragProxy: {
          getBoundingClientRect: () => ({ width: 0 })
        },
        draggedTab: {
          style: { minWidth: '120px' },
          getBoundingClientRect: () => ({ width: 124 })
        }
      })
    ).toBe(124);
    expect(
      resolveHoverPreviewWidthPx({
        draggedTab: {
          style: { minWidth: '120px' },
          getBoundingClientRect: () => ({ width: 0 })
        }
      })
    ).toBe(120);
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
