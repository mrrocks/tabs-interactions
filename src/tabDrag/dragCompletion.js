import { toRectSnapshot } from '../shared/dom';
import { scaleDurationMs } from '../motion/motionSpeed';
import { panelSelector } from '../shared/selectors';
import { activeTabClassName } from '../tabs/tabState';
import { getTabs } from '../tabs/tabs';
import { animatedRemovePanel, removePanel } from '../window/windowManager';
import { signalDragCompleted } from '../tabs/tabDragSignal';
import {
  windowAttachPaddingPx,
  resolveDropAttachTarget,
  resolveDropDetachIntent,
  shouldCloseSourcePanelAfterTransfer,
  shouldDetachOnDrop,
  snapshotSiblingPositions,
  computeDisplacements
} from './dragCalculations';
import { animateDragShadowOut } from './dragShadowAnimation';
import { dragTransitionDurationMs, dragShadowOutDurationMs, dragTransitionEasing } from './dragAnimationConfig';
import { applyTabAttachedStyle, applyProxyAttachedStyle } from './styleHelpers';
import { captureSourceActivation } from './detachedWindowSpawner';
import {
  computeSnappedFrame,
  animatePanelToSnappedFrame,
  snappedPanelFrames
} from '../panel/panelEdgeSnap';
import { activeDragClassName } from './dragClassNames';

const syncProxyWidthToTarget = (proxy, targetWidth) => {
  if (!(targetWidth > 0) || typeof proxy.animate !== 'function') return;
  const currentWidth = proxy.getBoundingClientRect().width;
  if (Math.abs(currentWidth - targetWidth) < 0.5) return;
  proxy.style.transition = 'none';
  proxy.animate(
    [
      { width: `${currentWidth}px`, minWidth: `${currentWidth}px`, maxWidth: `${currentWidth}px` },
      { width: `${targetWidth}px`, minWidth: `${targetWidth}px`, maxWidth: `${targetWidth}px` }
    ],
    { duration: scaleDurationMs(dragTransitionDurationMs), easing: dragTransitionEasing, fill: 'forwards' }
  );
};

export const settleDetachedDrag = (completedState, deps) => {
  const { dragDomAdapter, hoverPreview, animationCoordinator, visualWidth, commitDropAttach } = deps;

  if (completedState.detachWindowToggle) {
    completedState.detachWindowToggle.destroy();
    completedState.detachWindowToggle = null;
  }

  const attachTarget = hoverPreview.previewTabList;
  const tab = completedState.draggedTab;
  const proxy = completedState.dragProxy;

  if (attachTarget && hoverPreview.previewTab) {
    tab.style.visibility = '';
    visualWidth.cancelAll();

    const { toWidth, settledRect } = commitDropAttach({
      draggedTab: tab,
      attachTargetTabList: attachTarget,
      pointerClientX: completedState.lastClientX
    });

    dragDomAdapter.restoreDraggedTabStyles(completedState);

    if (proxy) {
      tab.style.visibility = 'hidden';

      applyProxyAttachedStyle(proxy, {
        isActive: proxy.classList.contains(activeDragClassName)
      });

      syncProxyWidthToTarget(proxy, toWidth);

      const settleAnimation = animationCoordinator.animateProxySettleToTarget({
        dragProxy: proxy,
        draggedTab: tab,
        toRectSnapshot,
        settleTargetRect: settledRect,
        setDragProxyBaseRect: (rect) => {
          dragDomAdapter.setDragProxyBaseRect(completedState, rect);
        },
        setElementTransform: dragDomAdapter.setElementTransform
      });

      let settleCleanedUp = false;
      const settleCleanup = () => {
        if (settleCleanedUp) return;
        settleCleanedUp = true;
        tab.style.visibility = '';
        dragDomAdapter.removeDragProxy(proxy);
      };
      animationCoordinator.finalizeOnAnimationSettled(settleAnimation, settleCleanup);
      setTimeout(settleCleanup, scaleDurationMs(dragTransitionDurationMs) + 100);
    } else {
      dragDomAdapter.removeDragProxy(proxy);
    }

    removePanel(completedState.detachedPanel);
  } else {
    tab.style.visibility = '';
    dragDomAdapter.restoreDraggedTabStyles(completedState);
    dragDomAdapter.removeDragProxy(proxy);
  }

  if (!attachTarget && completedState.detachEdgeSnapPreview?.activeZone) {
    const zone = completedState.detachEdgeSnapPreview.activeZone;
    const preSnapFrame = completedState.detachedPanelFrame
      ? { ...completedState.detachedPanelFrame }
      : null;
    const targetFrame = computeSnappedFrame(zone, window.innerWidth, window.innerHeight);
    if (preSnapFrame) {
      snappedPanelFrames.set(completedState.detachedPanel, preSnapFrame);
    }
    animatePanelToSnappedFrame(completedState.detachedPanel, targetFrame);
  }

  const sourceTabList = completedState.currentTabList;
  if (sourceTabList) {
    const sourcePanel =
      typeof sourceTabList.closest === 'function' ? sourceTabList.closest(panelSelector) : null;
    if (sourcePanel && shouldCloseSourcePanelAfterTransfer({ sourceTabCountAfterMove: getTabs(sourceTabList).length })) {
      animatedRemovePanel(sourcePanel);
    }
  }

  if (completedState.detachEdgeSnapPreview) {
    completedState.detachEdgeSnapPreview.destroy();
    completedState.detachEdgeSnapPreview = null;
  }

  hoverPreview.clear();
  visualWidth.cancelAll();

  if (completedState.dragMoved) {
    signalDragCompleted();
  }
};

export const settleAttachedDrag = (completedState, deps) => {
  const { dragDomAdapter, hoverPreview, animationCoordinator, dropResolver,
    visualWidth, placeholderManager, commitDropAttach } = deps;

  const cleanupVisualState = () => {
    const tabList = completedState.draggedTab.parentNode;
    const siblings = tabList
      ? getTabs(tabList).filter((t) => t !== completedState.draggedTab)
      : [];
    const snapshot = snapshotSiblingPositions(siblings);

    dragDomAdapter.cleanupVisualState(completedState);

    const displacements = computeDisplacements(siblings, snapshot);
    if (displacements.length > 0) {
      animationCoordinator.animateSiblingDisplacement(displacements);
    }

    if (completedState.draggedTab.classList.contains(activeTabClassName)) {
      applyTabAttachedStyle(completedState.draggedTab);
    }
  };

  const settleVisualState = () => {
    const settleAnimation = animationCoordinator.animateProxySettleToTarget({
      dragProxy: completedState.dragProxy,
      draggedTab: completedState.draggedTab,
      toRectSnapshot,
      setDragProxyBaseRect: (rect) => {
        dragDomAdapter.setDragProxyBaseRect(completedState, rect);
      },
      setElementTransform: dragDomAdapter.setElementTransform
    });

    animationCoordinator.finalizeOnAnimationSettled(settleAnimation, cleanupVisualState);
  };

  const sourceTabList = completedState.currentTabList;
  const sourcePanel =
    sourceTabList && typeof sourceTabList.closest === 'function' ? sourceTabList.closest(panelSelector) : null;
  const sourceReattachActive = completedState.detachIntentActive && hoverPreview.previewTabList === sourceTabList;
  const resolvedAttachTargetTabList = dropResolver.resolveAttachTargetTabList({
    clientX: completedState.lastClientX,
    clientY: completedState.lastClientY,
    excludedTabList: sourceReattachActive ? null : sourceTabList,
    padding: windowAttachPaddingPx
  });
  const attachTargetTabList = resolveDropAttachTarget({
    attachTargetTabList: resolvedAttachTargetTabList,
    hoverAttachTabList: completedState.hoverAttachTabList,
    sourceTabList,
    allowSourceReattach: sourceReattachActive,
    dropClientX: completedState.lastClientX,
    dropClientY: completedState.lastClientY,
    hoverAttachClientX: completedState.hoverAttachClientX,
    hoverAttachClientY: completedState.hoverAttachClientY
  });
  const dropInsideCurrentHeader = deps.isPointerInsideCurrentHeader({
    tabList: sourceTabList,
    clientX: completedState.lastClientX,
    clientY: completedState.lastClientY
  });
  const detachIntentForDrop = resolveDropDetachIntent({
    detachIntentActive: shouldDetachOnDrop(completedState),
    isDropInsideCurrentHeader: dropInsideCurrentHeader,
    didCrossWindowAttach: completedState.didCrossWindowAttach
  });
  const dropDestination = dropResolver.resolveDropDestination({
    detachIntentActive: detachIntentForDrop,
    attachTargetTabList
  });

  if (dropDestination === 'attach' && sourceTabList && sourcePanel) {
    const isCrossListAttach = attachTargetTabList !== sourceTabList;
    const activateInSource = isCrossListAttach
      ? captureSourceActivation(completedState.draggedTab, sourceTabList)
      : null;
    commitDropAttach({
      draggedTab: completedState.draggedTab,
      attachTargetTabList,
      pointerClientX: completedState.lastClientX
    });
    if (isCrossListAttach && shouldCloseSourcePanelAfterTransfer({ sourceTabCountAfterMove: getTabs(sourceTabList).length })) {
      animatedRemovePanel(sourcePanel);
    }
    activateInSource?.();
  }

  placeholderManager.restoreDisplay(completedState.draggedTab);
  hoverPreview.clear();
  if (dropDestination === 'attach') {
    visualWidth.cancelAll();
  } else {
    visualWidth.reset(completedState);
  }
  animateDragShadowOut(completedState.dragProxy, {
    durationMs: scaleDurationMs(dragShadowOutDurationMs),
    isActive: completedState.dragProxy?.classList.contains(activeDragClassName)
  });
  settleVisualState();

  if (completedState.dragMoved) {
    signalDragCompleted();
  }
};
