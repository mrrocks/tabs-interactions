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
  shouldDetachOnDrop
} from './dragCalculations';
import { animateDragShadowOut } from './dragShadowAnimation';
import { dragTransitionDurationMs, dragShadowOutDurationMs } from './dragAnimationConfig';
import { applyTabAttachedStyle } from './styleHelpers';
import { captureSourceActivation } from './detachedWindowSpawner';
import {
  computeSnappedFrame,
  animatePanelToSnappedFrame,
  snappedPanelFrames
} from '../panel/panelEdgeSnap';

const activeDragClassName = 'tab--dragging-active';

export const settleDetachedDrag = (completedState, deps) => {
  const { dragDomAdapter, hoverPreview, animationCoordinator, visualWidth } = deps;

  if (completedState.detachWindowToggle) {
    completedState.detachWindowToggle.destroy();
    completedState.detachWindowToggle = null;
  }

  const attachTarget = hoverPreview.previewTabList;

  if (attachTarget && hoverPreview.previewTab && completedState.dragProxy) {
    const tab = completedState.draggedTab;
    const proxy = completedState.dragProxy;

    tab.style.visibility = '';
    dragDomAdapter.restoreDraggedTabStyles(completedState);
    hoverPreview.commitDrop({ draggedTab: tab, attachTargetTabList: attachTarget });
    deps.activateDraggedTabInTarget(tab, attachTarget);
    tab.style.visibility = 'hidden';

    animateDragShadowOut(proxy, {
      durationMs: scaleDurationMs(dragShadowOutDurationMs),
      isActive: proxy.classList.contains(activeDragClassName)
    });

    const settleAnimation = animationCoordinator.animateProxySettleToTarget({
      dragProxy: proxy,
      draggedTab: tab,
      toRectSnapshot,
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

    removePanel(completedState.detachedPanel);
  } else if (attachTarget && hoverPreview.previewTab) {
    const tab = completedState.draggedTab;
    tab.style.visibility = '';
    dragDomAdapter.restoreDraggedTabStyles(completedState);
    dragDomAdapter.removeDragProxy(completedState.dragProxy);
    hoverPreview.commitDrop({ draggedTab: tab, attachTargetTabList: attachTarget });
    deps.activateDraggedTabInTarget(tab, attachTarget);
    removePanel(completedState.detachedPanel);
  } else {
    completedState.draggedTab.style.visibility = '';
    dragDomAdapter.restoreDraggedTabStyles(completedState);
    dragDomAdapter.removeDragProxy(completedState.dragProxy);
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
    const beforeLeftMap = new Map(siblings.map((t) => [t, t.getBoundingClientRect().left]));

    dragDomAdapter.cleanupVisualState(completedState);

    const displacements = siblings
      .map((tab) => ({ tab, deltaX: beforeLeftMap.get(tab) - tab.getBoundingClientRect().left }))
      .filter(({ deltaX }) => Math.abs(deltaX) >= 0.5);
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
  if (dropDestination !== 'attach') {
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
