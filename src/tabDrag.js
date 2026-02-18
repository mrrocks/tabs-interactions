import { scaleDurationMs } from './motionSpeed';
import { activeTabClassName } from './tabState';
import { getTabs, setActiveTab, tabListSelector, tabSelector } from './tabs';
import {
  animateDetachedWindowFromTab,
  createDetachedWindow,
  moveTabToList
} from './windowManager';
import { removePanel } from './windowControls';
import {
  createDragSession,
  isSessionAttachedDrag,
  markSessionAsActivated,
  transitionSessionToAttachedDrag,
  transitionSessionToSettling
} from './tabDrag/dragSessionStateMachine';
import { createLayoutPipeline } from './tabDrag/layoutPipeline';
import { createDropResolver, isPointInsideRect } from './tabDrag/dropResolver';
import { createAnimationCoordinator } from './tabDrag/animationCoordinator';
import { createDragDomAdapter } from './tabDrag/dragDomAdapter';

export const dragActivationDistancePx = 3;
export const detachThresholdPx = 56;
export const reentryPaddingPx = 16;
export const windowAttachPaddingPx = 12;
export const verticalResistanceFactor = 0.22;
export const verticalResistanceMaxPx = 30;
const dragProxySettleDurationMs = 140;
const dragResizeTransitionDurationMs = 110;
const detachSourceCollapseDurationMs = 150;

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

const toFiniteNumber = (value, fallbackValue = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
};

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

export const applyVerticalResistance = (
  deltaY,
  resistanceFactor = verticalResistanceFactor,
  maximumOffsetPx = verticalResistanceMaxPx
) => {
  const scaledDelta = toFiniteNumber(deltaY, 0) * resistanceFactor;
  return clamp(scaledDelta, -maximumOffsetPx, maximumOffsetPx);
};

export const shouldDetachFromVerticalDelta = (deltaY, thresholdPx = detachThresholdPx) =>
  Math.abs(toFiniteNumber(deltaY, 0)) >= thresholdPx;

export const getInsertionIndexFromCenters = ({ centers, pointerClientX }) => {
  const resolvedPointerX = toFiniteNumber(pointerClientX, 0);

  for (let index = 0; index < centers.length; index += 1) {
    if (resolvedPointerX < centers[index]) {
      return index;
    }
  }

  return centers.length;
};

const isEventTargetElement = (target) =>
  Boolean(target) && typeof target === 'object' && typeof target.closest === 'function';

export const shouldDetachOnDrop = ({ detachIntentActive }) => Boolean(detachIntentActive);
export const resolveDetachIntent = ({ currentIntent, deltaY, thresholdPx = detachThresholdPx }) =>
  Boolean(currentIntent) || shouldDetachFromVerticalDelta(deltaY, thresholdPx);
export const shouldCloseSourcePanelAfterTransfer = ({
  sourceTabCountAfterMove
}) => sourceTabCountAfterMove === 0;

export const shouldRemoveSourceWindowOnDetach = (sourceTabCount) => sourceTabCount === 1;

export const resolveSourceActivationIndexAfterDetach = (draggedTabIndex, remainingTabCount) => {
  if (remainingTabCount === 0) {
    return -1;
  }
  return Math.max(0, draggedTabIndex - 1);
};

export const resolveDragVisualOffsetY = ({ deltaY, detachIntentActive }) =>
  detachIntentActive ? deltaY : applyVerticalResistance(deltaY);

export const resolveHoverPreviewWidthPx = ({ dragProxyBaseRect, draggedTab }) => {
  const proxyBaseWidth = toFiniteNumber(dragProxyBaseRect?.width, 0);
  if (proxyBaseWidth > 0) {
    return proxyBaseWidth;
  }

  if (draggedTab && typeof draggedTab.getBoundingClientRect === 'function') {
    return toFiniteNumber(draggedTab.getBoundingClientRect().width, 0);
  }

  return 0;
};

export const resolveDropDetachIntent = ({
  detachIntentActive,
  isDropInsideCurrentHeader,
  didCrossWindowAttach
}) => {
  if (didCrossWindowAttach) {
    return false;
  }

  return Boolean(detachIntentActive) && !Boolean(isDropInsideCurrentHeader);
};

export const resolveDropAttachTarget = ({
  attachTargetTabList,
  hoverAttachTabList,
  sourceTabList,
  dropClientX,
  dropClientY,
  hoverAttachClientX,
  hoverAttachClientY,
  fallbackRadiusPx = 48
}) => {
  if (attachTargetTabList && attachTargetTabList !== sourceTabList) {
    return attachTargetTabList;
  }

  if (!hoverAttachTabList || hoverAttachTabList === sourceTabList) {
    return null;
  }

  if ('isConnected' in hoverAttachTabList && hoverAttachTabList.isConnected === false) {
    return null;
  }

  const resolvedDropClientX = toFiniteNumber(dropClientX, Number.NaN);
  const resolvedDropClientY = toFiniteNumber(dropClientY, Number.NaN);
  const resolvedHoverClientX = toFiniteNumber(hoverAttachClientX, Number.NaN);
  const resolvedHoverClientY = toFiniteNumber(hoverAttachClientY, Number.NaN);

  if (
    Number.isFinite(resolvedDropClientX) &&
    Number.isFinite(resolvedDropClientY) &&
    Number.isFinite(resolvedHoverClientX) &&
    Number.isFinite(resolvedHoverClientY)
  ) {
    const deltaX = resolvedDropClientX - resolvedHoverClientX;
    const deltaY = resolvedDropClientY - resolvedHoverClientY;

    if (Math.hypot(deltaX, deltaY) > fallbackRadiusPx) {
      return null;
    }
  }

  return hoverAttachTabList;
};

export const getProxySettleDelta = ({ proxyRect, targetRect }) => ({
  deltaX: targetRect.left - proxyRect.left,
  deltaY: targetRect.top - proxyRect.top
});

const suppressNextTabClick = () => {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
    return;
  }

  const onClickCapture = (event) => {
    if (isEventTargetElement(event.target) && event.target.closest(tabSelector)) {
      event.preventDefault();
      event.stopPropagation();
    }

    document.removeEventListener('click', onClickCapture, true);
  };

  document.addEventListener('click', onClickCapture, true);
};

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
  let dragState = null;
  let frameRequestId = 0;
  let queuedClientX = 0;
  let queuedClientY = 0;
  let hasQueuedPointer = false;
  let sourceWindowRemovedDuringDetach = false;
  let hoverAttachPreviewTab = null;
  let hoverAttachPreviewTabList = null;
  let dragVisualResizeTransitionEnabled = false;

  const clearGlobalListeners = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  const clearHoverAttachPreview = () => {
    if (!hoverAttachPreviewTab) {
      return;
    }

    if (typeof hoverAttachPreviewTab.remove === 'function') {
      hoverAttachPreviewTab.remove();
    } else if (
      hoverAttachPreviewTab.parentNode &&
      typeof hoverAttachPreviewTab.parentNode.removeChild === 'function'
    ) {
      hoverAttachPreviewTab.parentNode.removeChild(hoverAttachPreviewTab);
    }

    hoverAttachPreviewTab = null;
    hoverAttachPreviewTabList = null;
  };

  const createHoverAttachPreviewTab = (session) => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null;
    }

    const previewTab = document.createElement('div');
    previewTab.className = `${tabSelector.slice(1)} ${dragHoverPreviewClassName}`;
    previewTab.setAttribute('aria-hidden', 'true');
    previewTab.tabIndex = -1;
    previewTab.style.opacity = '0';
    previewTab.style.pointerEvents = 'none';
    previewTab.style.transition = 'none';
    const previewWidthPx = resolveHoverPreviewWidthPx(session);
    if (previewWidthPx > 0) {
      previewTab.style.flex = `0 1 ${previewWidthPx}px`;
    }

    return previewTab;
  };

  const enableDragVisualResizeTransition = (session) => {
    if (dragVisualResizeTransitionEnabled || !session) {
      return;
    }

    const transitionDurationMs = scaleDurationMs(dragResizeTransitionDurationMs);
    const proxyTransition = [
      `width ${transitionDurationMs}ms ease`,
      `min-width ${transitionDurationMs}ms ease`,
      `max-width ${transitionDurationMs}ms ease`
    ].join(', ');
    const tabTransition = [
      `flex-basis ${transitionDurationMs}ms ease`,
      `min-width ${transitionDurationMs}ms ease`,
      `max-width ${transitionDurationMs}ms ease`
    ].join(', ');

    if (session.dragProxy) {
      session.dragProxy.style.transition = proxyTransition;
    }
    session.draggedTab.style.transition = tabTransition;
    dragVisualResizeTransitionEnabled = true;
  };

  const applyDragVisualWidth = (session, widthPx) => {
    const resolvedWidthPx = toFiniteNumber(widthPx, 0);
    if (!session || resolvedWidthPx <= 0) {
      return;
    }

    enableDragVisualResizeTransition(session);

    if (session.dragProxy) {
      session.dragProxy.style.width = `${resolvedWidthPx}px`;
      session.dragProxy.style.minWidth = `${resolvedWidthPx}px`;
      session.dragProxy.style.maxWidth = `${resolvedWidthPx}px`;
    }

    session.draggedTab.style.flex = `0 1 ${resolvedWidthPx}px`;
    session.draggedTab.style.flexBasis = `${resolvedWidthPx}px`;
    session.draggedTab.style.minWidth = `${resolvedWidthPx}px`;
    session.draggedTab.style.maxWidth = `${resolvedWidthPx}px`;
  };

  const resetDragVisualWidth = (session) => {
    if (!session) {
      return;
    }

    const baseWidthPx = resolveHoverPreviewWidthPx({
      dragProxyBaseRect: session.dragProxyBaseRect,
      draggedTab: session.draggedTab
    });
    if (baseWidthPx <= 0) {
      return;
    }

    if (session.dragProxy) {
      session.dragProxy.style.width = `${baseWidthPx}px`;
      session.dragProxy.style.minWidth = `${baseWidthPx}px`;
      session.dragProxy.style.maxWidth = `${baseWidthPx}px`;
    }

    session.draggedTab.style.flex = `0 0 ${baseWidthPx}px`;
    session.draggedTab.style.flexBasis = `${baseWidthPx}px`;
    session.draggedTab.style.minWidth = `${baseWidthPx}px`;
    session.draggedTab.style.maxWidth = `${baseWidthPx}px`;
    session.draggedTab.style.padding = '';
  };

  const syncDragVisualWidthWithHoverPreview = (session) => {
    if (!hoverAttachPreviewTab || !session || typeof hoverAttachPreviewTab.getBoundingClientRect !== 'function') {
      return;
    }

    const previewWidthPx = toFiniteNumber(hoverAttachPreviewTab.getBoundingClientRect().width, 0);
    if (previewWidthPx <= 0) {
      return;
    }

    applyDragVisualWidth(session, previewWidthPx);
  };

  const applyDetachSourceWidthTransition = (shouldCollapse) => {
    const { draggedTab, lockedTabWidthPx } = dragState;
    const durationMs = scaleDurationMs(detachSourceCollapseDurationMs);
    const widthPx = shouldCollapse ? 0 : lockedTabWidthPx;
    const ease = `${durationMs}ms ease`;
    draggedTab.style.transition = `flex-basis ${ease}, min-width ${ease}, max-width ${ease}, padding ${ease}`;
    draggedTab.style.overflow = 'hidden';
    draggedTab.getBoundingClientRect();
    draggedTab.style.flex = `0 0 ${widthPx}px`;
    draggedTab.style.minWidth = `${widthPx}px`;
    draggedTab.style.maxWidth = `${widthPx}px`;
    draggedTab.style.padding = shouldCollapse ? '0' : '';
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

  const commitDropIntoHoverPreview = ({ draggedTab, attachTargetTabList }) => {
    if (!hoverAttachPreviewTab || hoverAttachPreviewTabList !== attachTargetTabList) {
      return false;
    }

    if (!attachTargetTabList || typeof attachTargetTabList.insertBefore !== 'function') {
      clearHoverAttachPreview();
      return false;
    }

    if (hoverAttachPreviewTab.parentNode !== attachTargetTabList) {
      clearHoverAttachPreview();
      return false;
    }

    attachTargetTabList.insertBefore(draggedTab, hoverAttachPreviewTab);
    clearHoverAttachPreview();
    return true;
  };

  const commitDropAttach = ({ draggedTab, attachTargetTabList, pointerClientX }) => {
    const didCommitPreviewDrop = commitDropIntoHoverPreview({
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
    dragVisualResizeTransitionEnabled = false;
    clearGlobalListeners();

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
      clearHoverAttachPreview();
      resetDragVisualWidth(completedState);
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
        clearHoverAttachPreview();
        resetDragVisualWidth(completedState);
        cleanupVisualState();

        if (completedState.dragMoved) {
          suppressNextTabClick();
        }

        return;
      }
    }

    clearHoverAttachPreview();
    if (dropDestination !== 'attach') {
      resetDragVisualWidth(completedState);
    }
    settleVisualState();

    if (completedState.dragMoved) {
      suppressNextTabClick();
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

      if (!isLastTab && dragState.detachIntentActive !== dragState.prevDetachIntentActive) {
        applyDetachSourceWidthTransition(dragState.detachIntentActive);
        dragState.prevDetachIntentActive = dragState.detachIntentActive;
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
      clearHoverAttachPreview();
      const insideSourceHeader = isPointerInsideCurrentHeader({
        tabList: sourceTabList,
        clientX,
        clientY
      });
      if (insideSourceHeader) {
        resetDragVisualWidth(dragState);
      }
      return false;
    }

    if (!hoverAttachPreviewTab || hoverAttachPreviewTabList !== attachTarget) {
      clearHoverAttachPreview();
      hoverAttachPreviewTab = createHoverAttachPreviewTab(dragState);
      hoverAttachPreviewTabList = attachTarget;
    }

    if (hoverAttachPreviewTab) {
      moveTabWithLayoutPipeline({
        tabList: attachTarget,
        draggedTab: hoverAttachPreviewTab,
        pointerClientX: clientX
      });
      syncDragVisualWidthWithHoverPreview(dragState);
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
        zIndex: draggedTab.style.zIndex,
        padding: draggedTab.style.padding,
        overflow: draggedTab.style.overflow
      }
    });

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    sourceWindowRemovedDuringDetach = false;
    dragVisualResizeTransitionEnabled = false;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  return true;
};
