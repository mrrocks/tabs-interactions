import { isEventTargetElement } from '../shared/dom';
import { scaleDurationMs } from '../motion/motionSpeed';
import { activeTabClassName } from '../tabs/tabState';
import { getTabs, setActiveTab, tabListSelector, tabSelector } from '../tabs/tabs';
import {
  animateDetachedWindowFromTab,
  createDetachedWindow,
  moveTabToList
} from '../window/windowManager';
import { removePanel } from '../window/windowControls';
import {
  createDragSession,
  isSessionAttachedDrag,
  markSessionAsActivated,
  transitionSessionToSettling
} from './dragSessionStateMachine';
import { createLayoutPipeline } from './layoutPipeline';
import { createDropResolver, isPointInsideRect } from './dropResolver';
import { createAnimationCoordinator } from './animationCoordinator';
import { createDragDomAdapter } from './dragDomAdapter';
import { clearDragCompleted, signalDragCompleted } from '../tabs/tabDragSignal';
import {
  dragActivationDistancePx,
  detachThresholdPx,
  reentryPaddingPx,
  windowAttachPaddingPx,
  getInsertionIndexFromCenters,
  getProxySettleDelta,
  resolveDetachIntent,
  resolveDropAttachTarget,
  resolveDropDetachIntent,
  resolveDragVisualOffsetY,
  resolveSourceActivationIndexAfterDetach,
  shouldCloseSourcePanelAfterTransfer,
  shouldDetachOnDrop,
  shouldRemoveSourceWindowOnDetach
} from './dragCalculations';
import { createHoverPreviewManager } from './hoverPreviewManager';
import { createDetachPlaceholderManager } from './detachPlaceholder';
import { createDragVisualWidthManager } from './dragVisualWidth';

export {
  dragActivationDistancePx,
  detachThresholdPx,
  reentryPaddingPx,
  windowAttachPaddingPx,
  applyVerticalResistance,
  shouldDetachFromVerticalDelta,
  verticalResistanceFactor,
  verticalResistanceMaxPx,
  getInsertionIndexFromCenters,
  getProxySettleDelta,
  resolveDetachIntent,
  resolveDropAttachTarget,
  resolveDropDetachIntent,
  resolveDragVisualOffsetY,
  resolveHoverPreviewWidthPx,
  resolveSourceActivationIndexAfterDetach,
  shouldCloseSourcePanelAfterTransfer,
  shouldDetachOnDrop,
  shouldRemoveSourceWindowOnDetach
} from './dragCalculations';

const dragProxySettleDurationMs = 140;
const dragResizeTransitionDurationMs = 150;
const detachCollapseDurationMs = 150;
const hoverPreviewExpandDurationMs = 150;

const dragClassName = 'tab--dragging';
const activeDragClassName = 'tab--dragging-active';
const inactiveDragClassName = 'tab--dragging-inactive';
const dragSourceClassName = 'tab--drag-source';
const dragProxyClassName = 'tab--drag-proxy';
const dragHoverPreviewClassName = 'tab--drag-hover-preview';
const bodyDraggingClassName = 'body--tab-dragging';
const tabAddSelector = '.tab--add';
const closeButtonSelector = '.tab--close';
const initializedRoots = new WeakSet();

const isPointerInsideCurrentHeader = ({ tabList, clientX, clientY, padding = windowAttachPaddingPx }) => {
  if (!tabList || typeof tabList.closest !== 'function') {
    return false;
  }

  const panel = tabList.closest('.browser');
  if (!panel) {
    return false;
  }

  const tabRow = typeof panel.querySelector === 'function' ? panel.querySelector('.tab--row') : null;
  const headerRect =
    tabRow && typeof tabRow.getBoundingClientRect === 'function'
      ? tabRow.getBoundingClientRect()
      : typeof tabList.getBoundingClientRect === 'function'
        ? tabList.getBoundingClientRect()
        : null;

  if (!headerRect) {
    return false;
  }

  return isPointInsideRect({
    clientX,
    clientY,
    rect: headerRect,
    padding
  });
};

export const initializeTabDrag = ({
  root = document,
  initializePanelInteraction = () => {},
  initializeTabList = () => {}
} = {}) => {
  if (!root || initializedRoots.has(root)) {
    return false;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  initializedRoots.add(root);

  const dragDomAdapter = createDragDomAdapter({
    activeTabClassName,
    dragClassName,
    activeDragClassName,
    inactiveDragClassName,
    dragSourceClassName,
    dragProxyClassName
  });
  const animationCoordinator = createAnimationCoordinator({
    scaleDurationMs,
    getProxySettleDelta,
    dragProxySettleDurationMs
  });
  const layoutPipeline = createLayoutPipeline({
    getTabs,
    getInsertionIndexFromCenters,
    moveTabToList,
    tabAddSelector
  });
  const dropResolver = createDropResolver({
    tabListSelector,
    defaultAttachPaddingPx: reentryPaddingPx
  });
  const hoverPreview = createHoverPreviewManager({
    scaleDurationMs,
    hoverPreviewExpandDurationMs,
    tabItemClassName: tabSelector.slice(1),
    dragHoverPreviewClassName
  });
  const placeholderManager = createDetachPlaceholderManager({
    scaleDurationMs,
    detachCollapseDurationMs
  });
  const visualWidth = createDragVisualWidthManager({
    scaleDurationMs,
    dragResizeTransitionDurationMs
  });

  let dragState = null;
  let frameRequestId = 0;
  let queuedClientX = 0;
  let queuedClientY = 0;
  let hasQueuedPointer = false;
  let sourceWindowRemovedDuringDetach = false;

  const clearGlobalListeners = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  const moveTabWithLayoutPipeline = ({ tabList, draggedTab, pointerClientX }) => {
    layoutPipeline.beginFrame();
    const moveResult = layoutPipeline.moveTabToPointerPosition({
      tabList,
      draggedTab,
      pointerClientX
    });

    if (moveResult.moved) {
      animationCoordinator.animateSiblingDisplacement(moveResult.displacements);
    }

    return moveResult;
  };

  const activateDraggedTabInTarget = (draggedTab, targetTabList) => {
    if (!draggedTab.classList.contains(activeTabClassName)) {
      return;
    }
    const targetTabs = getTabs(targetTabList);
    const draggedTabIndex = targetTabs.indexOf(draggedTab);
    if (draggedTabIndex === -1) {
      return;
    }
    setActiveTab(targetTabList, draggedTabIndex);
  };

  const captureSourceActivation = (draggedTab, sourceTabList) => {
    if (!draggedTab.classList.contains(activeTabClassName)) {
      return null;
    }
    const sourceTabs = getTabs(sourceTabList);
    const draggedTabIndex = sourceTabs.indexOf(draggedTab);
    if (draggedTabIndex === -1) {
      return null;
    }
    return () => {
      const remainingTabs = getTabs(sourceTabList);
      const nextActiveIndex = resolveSourceActivationIndexAfterDetach(draggedTabIndex, remainingTabs.length);
      if (nextActiveIndex !== -1) {
        setActiveTab(sourceTabList, nextActiveIndex);
      }
    };
  };

  const commitDropAttach = ({ draggedTab, attachTargetTabList, pointerClientX }) => {
    const didCommitPreviewDrop = hoverPreview.commitDrop({
      draggedTab,
      attachTargetTabList
    });

    if (!didCommitPreviewDrop) {
      moveTabWithLayoutPipeline({
        tabList: attachTargetTabList,
        draggedTab,
        pointerClientX
      });
    }

    activateDraggedTabInTarget(draggedTab, attachTargetTabList);
  };

  const finishDrag = () => {
    if (!dragState) {
      return;
    }

    const completedState = transitionSessionToSettling(dragState);
    dragState = null;
    hasQueuedPointer = false;
    sourceWindowRemovedDuringDetach = false;
    visualWidth.resetEnabled();
    hoverPreview.expanding = false;
    hoverPreview.cancelAnimation();
    clearGlobalListeners();
    placeholderManager.restoreDisplay(completedState.draggedTab);

    if (typeof document !== 'undefined' && document.body) {
      document.body.style.userSelect = completedState.initialUserSelect;
      document.body.classList.remove(bodyDraggingClassName);
    }

    if (typeof completedState.draggedTab.releasePointerCapture === 'function') {
      try {
        completedState.draggedTab.releasePointerCapture(completedState.pointerId);
      } catch {
        void 0;
      }
    }

    if (!completedState.dragStarted) {
      hoverPreview.clear();
      visualWidth.reset(completedState);
      return;
    }

    const cleanupVisualState = () => {
      dragDomAdapter.cleanupVisualState(completedState);
    };

    const settleVisualState = () => {
      const settleAnimation = animationCoordinator.animateProxySettleToTarget({
        dragProxy: completedState.dragProxy,
        draggedTab: completedState.draggedTab,
        toRectSnapshot: dragDomAdapter.toRectSnapshot,
        setDragProxyBaseRect: (rect) => {
          dragDomAdapter.setDragProxyBaseRect(completedState, rect);
        },
        setElementTransform: dragDomAdapter.setElementTransform
      });

      animationCoordinator.finalizeOnAnimationSettled(settleAnimation, cleanupVisualState);
    };

    const sourceTabList = completedState.currentTabList;
    const sourcePanel =
      sourceTabList && typeof sourceTabList.closest === 'function' ? sourceTabList.closest('.browser') : null;
    const resolvedAttachTargetTabList = dropResolver.resolveAttachTargetTabList({
      clientX: completedState.lastClientX,
      clientY: completedState.lastClientY,
      excludedTabList: sourceTabList,
      padding: windowAttachPaddingPx
    });
    const attachTargetTabList = resolveDropAttachTarget({
      attachTargetTabList: resolvedAttachTargetTabList,
      hoverAttachTabList: completedState.hoverAttachTabList,
      sourceTabList,
      dropClientX: completedState.lastClientX,
      dropClientY: completedState.lastClientY,
      hoverAttachClientX: completedState.hoverAttachClientX,
      hoverAttachClientY: completedState.hoverAttachClientY
    });
    const dropInsideCurrentHeader = isPointerInsideCurrentHeader({
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
      const activateInSource = captureSourceActivation(completedState.draggedTab, sourceTabList);
      commitDropAttach({
        draggedTab: completedState.draggedTab,
        attachTargetTabList,
        pointerClientX: completedState.lastClientX
      });
      if (shouldCloseSourcePanelAfterTransfer({ sourceTabCountAfterMove: getTabs(sourceTabList).length })) {
        removePanel(sourcePanel);
      }
      activateInSource?.();
    } else if (dropDestination === 'detach' && sourceTabList && sourcePanel) {
      const sourceTabRect = dragDomAdapter.toRectSnapshot(completedState.draggedTab.getBoundingClientRect());
      const activateInSource = captureSourceActivation(completedState.draggedTab, sourceTabList);
      const detachedWindow = createDetachedWindow({
        sourcePanel,
        sourceTabList,
        draggedTab: completedState.draggedTab,
        pointerClientX: completedState.lastClientX,
        pointerClientY: completedState.lastClientY
      });

      if (detachedWindow) {
        initializePanelInteraction(detachedWindow.panel);
        initializeTabList(detachedWindow.tabList);
        if (shouldCloseSourcePanelAfterTransfer({ sourceTabCountAfterMove: getTabs(sourceTabList).length })) {
          removePanel(sourcePanel);
        }
        animateDetachedWindowFromTab({ panel: detachedWindow.panel, tabRect: sourceTabRect, frame: detachedWindow.frame });
        activateInSource?.();
        hoverPreview.clear();
        visualWidth.reset(completedState);
        cleanupVisualState();

        if (completedState.dragMoved) {
          signalDragCompleted();
        }

        return;
      }
    }

    hoverPreview.clear();
    if (dropDestination !== 'attach') {
      visualWidth.reset(completedState);
    }
    settleVisualState();

    if (completedState.dragMoved) {
      signalDragCompleted();
    }
  };

  const applyAttachedDragSample = (clientX, clientY) => {
    if (!dragState) {
      return;
    }

    const deltaX = clientX - dragState.startX;
    const deltaY = clientY - dragState.startY;

    if (dragState.reattachArmed) {
      dragState.detachIntentActive = resolveDetachIntent({
        currentIntent: dragState.detachIntentActive,
        deltaY
      });
    } else if (Math.abs(deltaY) < detachThresholdPx * 0.5) {
      dragState.reattachArmed = true;
    }

    if (dragState.dragProxy) {
      const isLastTab = shouldRemoveSourceWindowOnDetach(dragState.sourceTabCount);

      if (dragState.detachIntentActive && isLastTab && !sourceWindowRemovedDuringDetach) {
        const sourcePanel =
          dragState.currentTabList && typeof dragState.currentTabList.closest === 'function'
            ? dragState.currentTabList.closest('.browser')
            : null;

        if (sourcePanel && removePanel(sourcePanel)) {
          sourceWindowRemovedDuringDetach = true;
        }
      }

      if (!isLastTab && dragState.detachIntentActive) {
        const insideHeader = isPointerInsideCurrentHeader({
          tabList: dragState.currentTabList,
          clientX,
          clientY
        });
        placeholderManager.sync(!insideHeader, dragState);
      }
    }

    const visualOffsetY = resolveDragVisualOffsetY({
      deltaY,
      detachIntentActive: dragState.detachIntentActive
    });
    dragDomAdapter.setDragVisualTransform(dragState, deltaX, visualOffsetY);

    if (attachToHoveredTabListFromAttachedDrag(clientX, clientY)) {
      return;
    }

    if (dragState.detachIntentActive) {
      return;
    }

    const moveResult = moveTabWithLayoutPipeline({
      tabList: dragState.currentTabList,
      draggedTab: dragState.draggedTab,
      pointerClientX: clientX
    });

    if (!dragState.dragProxy && moveResult.moved) {
      dragState.startX += moveResult.draggedBaseShiftX;
      dragDomAdapter.setDragVisualTransform(dragState, clientX - dragState.startX, visualOffsetY);
    }
  };

  const attachToHoveredTabListFromAttachedDrag = (clientX, clientY) => {
    if (!dragState || !isSessionAttachedDrag(dragState)) {
      return false;
    }

    const sourceTabList = dragState.currentTabList;
    const attachTarget = dropResolver.resolveAttachTargetTabList({
      clientX,
      clientY,
      excludedTabList: sourceTabList,
      padding: windowAttachPaddingPx
    });

    if (attachTarget) {
      dragState.hoverAttachTabList = attachTarget;
      dragState.hoverAttachClientX = clientX;
      dragState.hoverAttachClientY = clientY;
    }

    if (!attachTarget) {
      hoverPreview.collapseAndRemove();
      visualWidth.reset(dragState);
      return false;
    }

    let isFirstInsertion = false;
    if (!hoverPreview.previewTab || hoverPreview.previewTabList !== attachTarget) {
      hoverPreview.clear();
      hoverPreview.setPreview(hoverPreview.create(), attachTarget);
      isFirstInsertion = true;
    }

    if (hoverPreview.previewTab && (isFirstInsertion || !hoverPreview.expanding)) {
      moveTabWithLayoutPipeline({
        tabList: attachTarget,
        draggedTab: hoverPreview.previewTab,
        pointerClientX: clientX
      });

      if (isFirstInsertion) {
        const expandTiming = hoverPreview.expand();
        if (expandTiming) {
          visualWidth.animateToWidth(dragState, expandTiming.targetWidthPx, expandTiming.durationMs);
        }
      } else {
        visualWidth.syncWithHoverPreview(dragState, hoverPreview);
      }
    }

    return true;
  };

  const startDragIfNeeded = (clientX, clientY) => {
    if (!dragState || dragState.dragStarted) {
      return;
    }

    const deltaX = clientX - dragState.startX;
    const deltaY = clientY - dragState.startY;

    if (Math.hypot(deltaX, deltaY) < dragActivationDistancePx) {
      return;
    }

    dragState = markSessionAsActivated(dragState);
    dragDomAdapter.applyDragStyles(dragState);

    if (typeof document !== 'undefined' && document.body) {
      document.body.style.userSelect = 'none';
      document.body.classList.add(bodyDraggingClassName);
    }
  };

  const applyDragSample = () => {
    if (!dragState || !hasQueuedPointer) {
      return;
    }

    const clientX = queuedClientX;
    const clientY = queuedClientY;
    dragState.lastClientX = clientX;
    dragState.lastClientY = clientY;

    startDragIfNeeded(clientX, clientY);

    if (!dragState.dragStarted) {
      return;
    }

    if (isSessionAttachedDrag(dragState)) {
      applyAttachedDragSample(clientX, clientY);
    }
  };

  const processDragFrame = () => {
    frameRequestId = 0;
    applyDragSample();
  };

  const scheduleDragFrame = () => {
    if (frameRequestId !== 0) {
      return;
    }

    frameRequestId = window.requestAnimationFrame(processDragFrame);
  };

  const flushDragFrame = () => {
    if (frameRequestId !== 0) {
      window.cancelAnimationFrame(frameRequestId);
      frameRequestId = 0;
    }

    applyDragSample();
  };

  const onPointerMove = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    scheduleDragFrame();
  };

  const onPointerUp = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    flushDragFrame();
    finishDrag();
  };

  root.addEventListener('pointerdown', (event) => {
    if (dragState) {
      return;
    }

    if ((typeof event.button === 'number' && event.button !== 0) || !isEventTargetElement(event.target)) {
      return;
    }

    if (event.target.closest(closeButtonSelector)) {
      return;
    }

    const draggedTab = event.target.closest(tabSelector);
    if (!draggedTab) {
      return;
    }

    const tabList = draggedTab.closest(tabListSelector);
    if (!tabList) {
      return;
    }

    const sourcePanel = draggedTab.closest('.browser');
    if (!sourcePanel) {
      return;
    }

    clearDragCompleted();

    if (typeof draggedTab.setPointerCapture === 'function') {
      try {
        draggedTab.setPointerCapture(event.pointerId);
      } catch {
        void 0;
      }
    }

    dragState = createDragSession({
      pointerId: event.pointerId,
      draggedTab,
      currentTabList: tabList,
      sourceTabCount: getTabs(tabList).length,
      startX: event.clientX,
      startY: event.clientY,
      initialUserSelect: typeof document !== 'undefined' && document.body ? document.body.style.userSelect : '',
      initialInlineStyles: {
        transform: draggedTab.style.transform,
        transition: draggedTab.style.transition,
        flex: draggedTab.style.flex,
        minWidth: draggedTab.style.minWidth,
        maxWidth: draggedTab.style.maxWidth,
        willChange: draggedTab.style.willChange,
        zIndex: draggedTab.style.zIndex
      }
    });

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    sourceWindowRemovedDuringDetach = false;
    visualWidth.resetEnabled();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  return true;
};
