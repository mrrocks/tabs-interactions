import { scaleDurationMs } from './motionSpeed';
import { activeTabClassName } from './tabState';
import { getTabs, tabListSelector, tabSelector } from './tabs';
import {
  animateDetachedWindowFromTab,
  applyPanelFrame,
  computeDetachedPanelFrame,
  createDetachedWindow,
  moveTabToList,
  removeDetachedWindowIfEmpty
} from './windowManager';
import { removePanel } from './windowControls';
import {
  createDragSession,
  isSessionAttachedDrag,
  isSessionDetachedDrag,
  markSessionAsActivated,
  transitionSessionToAttachedDrag,
  transitionSessionToDetachedDrag,
  transitionSessionToSettling
} from './tabDrag/dragSessionStateMachine';
import { createLayoutPipeline } from './tabDrag/layoutPipeline';
import { createDropResolver } from './tabDrag/dropResolver';
import { createWindowLifecycle } from './tabDrag/windowLifecycle';
import { createAnimationCoordinator } from './tabDrag/animationCoordinator';
import { createDragDomAdapter } from './tabDrag/dragDomAdapter';

export const dragActivationDistancePx = 3;
export const detachThresholdPx = 56;
export const reentryPaddingPx = 16;
export const windowAttachPaddingPx = 12;
export const verticalResistanceFactor = 0.22;
export const verticalResistanceMaxPx = 30;
const dragProxySettleDurationMs = 140;

const dragClassName = 'tab--dragging';
const activeDragClassName = 'tab--dragging-active';
const inactiveDragClassName = 'tab--dragging-inactive';
const dragSourceClassName = 'tab--drag-source';
const dragSourceVisibleClassName = 'tab--drag-source-visible';
const dragProxyClassName = 'tab--drag-proxy';
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

const createRect = (rect, padding) => ({
  left: rect.left - padding,
  right: rect.right + padding,
  top: rect.top - padding,
  bottom: rect.bottom + padding
});

export const isPointInsideRect = ({ clientX, clientY, rect, padding = 0 }) => {
  const resolvedRect = createRect(rect, padding);
  return (
    clientX >= resolvedRect.left &&
    clientX <= resolvedRect.right &&
    clientY >= resolvedRect.top &&
    clientY <= resolvedRect.bottom
  );
};

export const shouldDetachOnDrop = ({ detachIntentActive }) => Boolean(detachIntentActive);
export const resolveDetachIntent = ({ currentIntent, deltaY, thresholdPx = detachThresholdPx }) =>
  Boolean(currentIntent) || shouldDetachFromVerticalDelta(deltaY, thresholdPx);
export const shouldCloseSourcePanelAfterTransfer = ({
  sourceTabCountAfterMove
}) => sourceTabCountAfterMove === 0;

export const shouldRemoveSourceWindowOnDetach = (sourceTabCount) => sourceTabCount === 1;

export const resolveDragVisualOffsetY = ({ deltaY, detachIntentActive }) =>
  detachIntentActive ? deltaY : applyVerticalResistance(deltaY);

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
    dragSourceVisibleClassName,
    dragProxyClassName
  });
  const animationCoordinator = createAnimationCoordinator({
    scaleDurationMs,
    getProxySettleDelta,
    animateDetachedWindowFromTab,
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
  const windowLifecycle = createWindowLifecycle({
    getTabs,
    createDetachedWindow,
    removeDetachedWindowIfEmpty,
    removePanel,
    shouldCloseSourcePanelAfterTransfer,
    initializePanelInteraction,
    initializeTabList,
    animateDetachedWindowEnter: animationCoordinator.animateDetachedWindowEnter
  });

  let dragState = null;
  let frameRequestId = 0;
  let queuedClientX = 0;
  let queuedClientY = 0;
  let hasQueuedPointer = false;

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

  const finishDrag = () => {
    if (!dragState) {
      return;
    }

    const completedState = transitionSessionToSettling(dragState);
    dragState = null;
    hasQueuedPointer = false;
    clearGlobalListeners();

    if (typeof document !== 'undefined' && document.body) {
      document.body.style.userSelect = completedState.initialUserSelect;
    }

    if (typeof completedState.draggedTab.releasePointerCapture === 'function') {
      try {
        completedState.draggedTab.releasePointerCapture(completedState.pointerId);
      } catch {
        void 0;
      }
    }

    if (!completedState.dragStarted) {
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

    if (isSessionDetachedDrag(completedState) && completedState.detachedPanel) {
      const resolvedAttachTarget = dropResolver.resolveAttachTargetTabList({
        clientX: completedState.lastClientX,
        clientY: completedState.lastClientY,
        excludedTabList: completedState.currentTabList,
        padding: windowAttachPaddingPx
      });
      const attachTarget = resolveDropAttachTarget({
        attachTargetTabList: resolvedAttachTarget,
        hoverAttachTabList: completedState.hoverAttachTabList,
        sourceTabList: completedState.currentTabList,
        dropClientX: completedState.lastClientX,
        dropClientY: completedState.lastClientY,
        hoverAttachClientX: completedState.hoverAttachClientX,
        hoverAttachClientY: completedState.hoverAttachClientY
      });

      if (attachTarget) {
        moveTabWithLayoutPipeline({
          tabList: attachTarget,
          draggedTab: completedState.draggedTab,
          pointerClientX: completedState.lastClientX
        });
        removePanel(completedState.detachedPanel);
      }

      settleVisualState();

      if (completedState.dragMoved) {
        suppressNextTabClick();
      }

      return;
    }

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
      moveTabWithLayoutPipeline({
        tabList: attachTargetTabList,
        draggedTab: completedState.draggedTab,
        pointerClientX: completedState.lastClientX
      });
      windowLifecycle.closeSourcePanelIfEmpty({
        sourcePanel,
        sourceTabList
      });
    } else if (dropDestination === 'detach' && sourceTabList && sourcePanel) {
      const sourceTabRect = dragDomAdapter.toRectSnapshot(completedState.draggedTab.getBoundingClientRect());
      const detachedWindow = windowLifecycle.createDetachedWindowFromDrop({
        sourcePanel,
        sourceTabList,
        draggedTab: completedState.draggedTab,
        pointerClientX: completedState.lastClientX,
        pointerClientY: completedState.lastClientY,
        sourceTabRect
      });

      if (detachedWindow) {
        cleanupVisualState();

        if (completedState.dragMoved) {
          suppressNextTabClick();
        }

        return;
      }
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
      dragState.draggedTab.classList.toggle(dragDomAdapter.dragSourceVisibleClassName, dragState.detachIntentActive && !isLastTab);

      if (dragState.detachIntentActive && isLastTab) {
        const sourcePanel = dragState.draggedTab.closest('.browser');
        if (sourcePanel) {
          const panelRect = sourcePanel.getBoundingClientRect();
          dragState = transitionSessionToDetachedDrag(dragState, {
            detachedPanel: sourcePanel,
            detachedPanelWidth: panelRect.width,
            detachedPanelHeight: panelRect.height,
            detachedAnchorOffsetX: clientX - panelRect.left,
            detachedAnchorOffsetY: clientY - panelRect.top,
            reattachArmed: false
          });
          dragDomAdapter.rebaseDragVisualAtPointer(dragState, clientX, clientY);
          return;
        }
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

  const attachToTabList = (nextTabList, clientX, clientY) => {
    if (!dragState || !isSessionDetachedDrag(dragState) || !dragState.detachedPanel || !nextTabList) {
      return;
    }

    moveTabWithLayoutPipeline({
      tabList: nextTabList,
      draggedTab: dragState.draggedTab,
      pointerClientX: clientX
    });

    windowLifecycle.maybeRemoveDetachedPanel(dragState.detachedPanel);
    dragState = transitionSessionToAttachedDrag(dragState, {
      currentTabList: nextTabList,
      sourceTabCount: getTabs(nextTabList).length,
      detachIntentActive: false,
      reattachArmed: false,
      didCrossWindowAttach: true,
      hoverAttachTabList: null,
      hoverAttachClientX: 0,
      hoverAttachClientY: 0,
      detachedPanel: null,
      detachedPanelWidth: 0,
      detachedPanelHeight: 0,
      detachedAnchorOffsetX: 0,
      detachedAnchorOffsetY: 0
    });
    dragDomAdapter.rebaseDragVisualAtPointer(dragState, clientX, clientY);
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
      return false;
    }

    const sourcePanel =
      sourceTabList && typeof sourceTabList.closest === 'function' ? sourceTabList.closest('.browser') : null;
    moveTabWithLayoutPipeline({
      tabList: attachTarget,
      draggedTab: dragState.draggedTab,
      pointerClientX: clientX
    });

    if (sourcePanel && sourceTabList !== attachTarget) {
      windowLifecycle.closeSourcePanelIfEmpty({
        sourcePanel,
        sourceTabList
      });
    }

    dragState = transitionSessionToAttachedDrag(dragState, {
      currentTabList: attachTarget,
      sourceTabCount: getTabs(attachTarget).length,
      detachIntentActive: false,
      reattachArmed: false,
      didCrossWindowAttach: true,
      hoverAttachTabList: null,
      hoverAttachClientX: 0,
      hoverAttachClientY: 0,
      detachedPanel: null,
      detachedPanelWidth: 0,
      detachedPanelHeight: 0,
      detachedAnchorOffsetX: 0,
      detachedAnchorOffsetY: 0
    });
    dragDomAdapter.rebaseDragVisualAtPointer(dragState, clientX, clientY);
    return true;
  };

  const applyDetachedDragSample = (clientX, clientY) => {
    if (!dragState || !dragState.detachedPanel) {
      return;
    }

    const deltaX = clientX - dragState.startX;
    const deltaY = clientY - dragState.startY;
    dragDomAdapter.setDragVisualTransform(dragState, deltaX, deltaY);

    const frame = computeDetachedPanelFrame({
      pointerClientX: clientX,
      pointerClientY: clientY,
      panelWidth: dragState.detachedPanelWidth,
      panelHeight: dragState.detachedPanelHeight,
      anchorOffsetX: dragState.detachedAnchorOffsetX,
      anchorOffsetY: dragState.detachedAnchorOffsetY
    });
    applyPanelFrame(dragState.detachedPanel, frame);

    const attachTarget = dropResolver.resolveAttachTargetTabList({
      clientX,
      clientY,
      excludedTabList: dragState.currentTabList,
      padding: reentryPaddingPx
    });
    if (attachTarget) {
      dragState.hoverAttachTabList = attachTarget;
      dragState.hoverAttachClientX = clientX;
      dragState.hoverAttachClientY = clientY;
    }

    if (attachTarget) {
      attachToTabList(attachTarget, clientX, clientY);
    }
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

    if (isSessionDetachedDrag(dragState)) {
      applyDetachedDragSample(clientX, clientY);
    } else if (isSessionAttachedDrag(dragState)) {
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
        zIndex: draggedTab.style.zIndex
      }
    });

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  return true;
};
