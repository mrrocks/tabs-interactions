import { scaleDurationMs } from './motionSpeed';
import { activeTabClassName } from './tabState';
import { getTabs, tabListSelector, tabSelector } from './tabs';
import {
  applyPanelFrame,
  animateDetachedWindowFromTab,
  computeDetachedPanelFrame,
  createDetachedWindow,
  moveTabToList,
  removeDetachedWindowIfEmpty
} from './windowManager';
import { removePanel } from './windowControls';

export const dragActivationDistancePx = 3;
export const detachThresholdPx = 56;
export const detachHysteresisPx = 14;
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

const getTabEndReference = (tabList) => tabList.querySelector(tabAddSelector) ?? null;

const getSiblingTabs = (tabList, draggedTab) => getTabs(tabList).filter((tab) => tab !== draggedTab);

const getSiblingCenters = (tabs) => tabs.map((tab) => tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2);

const createTabLeftMap = (tabs) => {
  const leftMap = new Map();

  tabs.forEach((tab) => {
    leftMap.set(tab, tab.getBoundingClientRect().left);
  });

  return leftMap;
};

const animateSiblingDisplacement = (tabs, beforeLeftMap) => {
  const duration = scaleDurationMs(150);

  tabs.forEach((tab) => {
    const beforeLeft = beforeLeftMap.get(tab);
    if (beforeLeft === undefined || typeof tab.animate !== 'function') {
      return;
    }

    const afterLeft = tab.getBoundingClientRect().left;
    const deltaX = beforeLeft - afterLeft;

    if (Math.abs(deltaX) < 0.5) {
      return;
    }

    tab.animate(
      [{ transform: `translate3d(${deltaX}px, 0px, 0px)` }, { transform: 'translate3d(0px, 0px, 0px)' }],
      {
        duration,
        easing: 'ease'
      }
    );
  });
};

const moveTabToPointerPosition = ({ tabList, draggedTab, pointerClientX, animate = true }) => {
  const siblingTabs = getSiblingTabs(tabList, draggedTab);
  const centers = getSiblingCenters(siblingTabs);
  const targetIndex = getInsertionIndexFromCenters({ centers, pointerClientX });
  const currentTabs = getTabs(tabList);
  const currentIndex = currentTabs.indexOf(draggedTab);

  if (draggedTab.parentNode === tabList && currentIndex === targetIndex) {
    return {
      moved: false,
      draggedBaseShiftX: 0
    };
  }

  const beforeLeftMap = createTabLeftMap(siblingTabs);
  const draggedLeftBefore = draggedTab.getBoundingClientRect().left;
  const referenceNode = siblingTabs[targetIndex] ?? getTabEndReference(tabList);
  moveTabToList({ tab: draggedTab, tabList, beforeNode: referenceNode });
  const draggedLeftAfter = draggedTab.getBoundingClientRect().left;

  if (animate) {
    animateSiblingDisplacement(siblingTabs, beforeLeftMap);
  }

  return {
    moved: true,
    draggedBaseShiftX: draggedLeftAfter - draggedLeftBefore
  };
};

const setElementTransform = (element, translateX, translateY) => {
  if (!element) {
    return;
  }

  element.style.transform = `translate3d(${translateX}px, ${translateY}px, 0px)`;
};

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

export const shouldArmReattach = ({ clientY, detachOriginY, hysteresisPx = detachHysteresisPx }) =>
  Math.abs(clientY - detachOriginY) >= hysteresisPx;

export const shouldReattachToOriginalStrip = ({ reattachArmed, clientX, clientY, rect, padding = reentryPaddingPx }) =>
  Boolean(reattachArmed) && isPointInsideRect({ clientX, clientY, rect, padding });

export const shouldRemoveSourceWindowOnDetach = (tabCount) => tabCount === 1;
export const shouldDetachOnDrop = ({ mode, detachIntentActive }) => mode === 'attached' && Boolean(detachIntentActive);
export const resolveDetachIntent = ({ currentIntent, deltaY, thresholdPx = detachThresholdPx }) =>
  Boolean(currentIntent) || shouldDetachFromVerticalDelta(deltaY, thresholdPx);
export const shouldCloseSourcePanelAfterTransfer = ({
  sourceTabCountAfterMove
}) => sourceTabCountAfterMove === 0;

export const resolveDragVisualOffsetY = ({ deltaY, detachIntentActive }) =>
  detachIntentActive ? deltaY : applyVerticalResistance(deltaY);

const toRectSnapshot = (rect) => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height
});

const createDragProxy = (draggedTab) => {
  if (typeof document === 'undefined' || !document.body) {
    return null;
  }

  const draggedRect = draggedTab.getBoundingClientRect();
  const dragProxy = draggedTab.cloneNode(true);
  const isActive = draggedTab.classList.contains(activeTabClassName);
  dragProxy.classList.add(dragProxyClassName, dragClassName, isActive ? activeDragClassName : inactiveDragClassName);
  dragProxy.style.left = `${draggedRect.left}px`;
  dragProxy.style.top = `${draggedRect.top}px`;
  dragProxy.style.width = `${draggedRect.width}px`;
  dragProxy.style.height = `${draggedRect.height}px`;
  dragProxy.style.minWidth = `${draggedRect.width}px`;
  dragProxy.style.maxWidth = `${draggedRect.width}px`;
  dragProxy.style.transform = 'translate3d(0px, 0px, 0px)';
  dragProxy.style.willChange = 'transform';
  document.body.append(dragProxy);

  return {
    dragProxy,
    dragProxyBaseRect: toRectSnapshot(draggedRect)
  };
};

const removeDragProxy = (dragProxy) => {
  if (!dragProxy) {
    return;
  }

  if (typeof dragProxy.remove === 'function') {
    dragProxy.remove();
  } else if (dragProxy.parentNode && typeof dragProxy.parentNode.removeChild === 'function') {
    dragProxy.parentNode.removeChild(dragProxy);
  }
};

const setDragProxyBaseRect = (dragState, rect) => {
  if (!dragState.dragProxy) {
    return;
  }

  const snapshot = toRectSnapshot(rect);
  dragState.dragProxyBaseRect = snapshot;
  dragState.dragProxy.style.left = `${snapshot.left}px`;
  dragState.dragProxy.style.top = `${snapshot.top}px`;
  dragState.dragProxy.style.width = `${snapshot.width}px`;
  dragState.dragProxy.style.height = `${snapshot.height}px`;
  dragState.dragProxy.style.minWidth = `${snapshot.width}px`;
  dragState.dragProxy.style.maxWidth = `${snapshot.width}px`;
};

const setDragVisualTransform = (dragState, translateX, translateY) => {
  if (dragState.dragProxy) {
    setElementTransform(dragState.dragProxy, translateX, translateY);
    return;
  }

  setElementTransform(dragState.draggedTab, translateX, translateY);
};

export const getProxySettleDelta = ({ proxyRect, targetRect }) => ({
  deltaX: targetRect.left - proxyRect.left,
  deltaY: targetRect.top - proxyRect.top
});

const animateDragProxyToTarget = (dragState) => {
  if (!dragState.dragProxy) {
    return null;
  }

  const proxyRect = toRectSnapshot(dragState.dragProxy.getBoundingClientRect());
  const targetRect = toRectSnapshot(dragState.draggedTab.getBoundingClientRect());
  const settleDelta = getProxySettleDelta({
    proxyRect,
    targetRect
  });
  setDragProxyBaseRect(dragState, proxyRect);
  setElementTransform(dragState.dragProxy, 0, 0);

  if (Math.abs(settleDelta.deltaX) < 0.5 && Math.abs(settleDelta.deltaY) < 0.5) {
    return null;
  }

  if (typeof dragState.dragProxy.animate !== 'function') {
    setElementTransform(dragState.dragProxy, settleDelta.deltaX, settleDelta.deltaY);
    return null;
  }

  return dragState.dragProxy.animate(
    [
      { transform: 'translate3d(0px, 0px, 0px)' },
      { transform: `translate3d(${settleDelta.deltaX}px, ${settleDelta.deltaY}px, 0px)` }
    ],
    {
      duration: scaleDurationMs(dragProxySettleDurationMs),
      easing: 'ease',
      fill: 'forwards'
    }
  );
};

const rebaseDragVisualAtPointer = (dragState, clientX, clientY) => {
  if (dragState.dragProxy) {
    setDragProxyBaseRect(dragState, dragState.dragProxy.getBoundingClientRect());
  }

  setDragVisualTransform(dragState, 0, 0);
  dragState.startX = clientX;
  dragState.startY = clientY;
};

const getAttachTargetTabList = ({ clientX, clientY, excludedTabList, padding = reentryPaddingPx }) => {
  if (typeof document === 'undefined') {
    return null;
  }

  const tabLists = Array.from(document.querySelectorAll(tabListSelector)).filter(
    (tabList) => tabList !== excludedTabList && tabList.isConnected
  );
  const attachCandidates = tabLists
    .map((tabList) => {
      const panel = tabList.closest('.browser');

      if (!panel || !panel.isConnected) {
        return null;
      }

      return {
        tabList,
        panel
      };
    })
    .filter(Boolean);

  if (attachCandidates.length === 0) {
    return null;
  }

  if (typeof document.elementsFromPoint === 'function') {
    const layeredElements = document.elementsFromPoint(clientX, clientY);

    for (const element of layeredElements) {
      if (!(element instanceof Element)) {
        continue;
      }

      const tabList = element.closest(tabListSelector);

      if (tabList && tabLists.includes(tabList)) {
        return tabList;
      }

      const panel = element.closest('.browser');

      if (panel) {
        const candidate = attachCandidates.find((attachCandidate) => attachCandidate.panel === panel);

        if (candidate) {
          return candidate.tabList;
        }
      }
    }
  }

  const panelHitCandidate = attachCandidates.find((attachCandidate) =>
    isPointInsideRect({
      clientX,
      clientY,
      rect: attachCandidate.panel.getBoundingClientRect(),
      padding: windowAttachPaddingPx
    })
  );

  if (panelHitCandidate) {
    return panelHitCandidate.tabList;
  }

  return (
    attachCandidates.find((attachCandidate) =>
      isPointInsideRect({
        clientX,
        clientY,
        rect: attachCandidate.tabList.getBoundingClientRect(),
        padding
      })
    )?.tabList ?? null
  );
};

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

const restoreDraggedTabStyles = (dragState) => {
  const { draggedTab, initialInlineStyles } = dragState;

  draggedTab.classList.remove(dragSourceClassName);
  draggedTab.classList.remove(dragSourceVisibleClassName);
  draggedTab.classList.remove(dragClassName, activeDragClassName, inactiveDragClassName);
  draggedTab.style.transform = initialInlineStyles.transform;
  draggedTab.style.transition = initialInlineStyles.transition;
  draggedTab.style.flex = initialInlineStyles.flex;
  draggedTab.style.minWidth = initialInlineStyles.minWidth;
  draggedTab.style.maxWidth = initialInlineStyles.maxWidth;
  draggedTab.style.willChange = initialInlineStyles.willChange;
  draggedTab.style.zIndex = initialInlineStyles.zIndex;
};

const applyDragStyles = (dragState) => {
  const { draggedTab } = dragState;
  const draggedRect = draggedTab.getBoundingClientRect();
  draggedTab.style.transition = 'none';
  draggedTab.style.flex = `0 0 ${draggedRect.width}px`;
  draggedTab.style.minWidth = `${draggedRect.width}px`;
  draggedTab.style.maxWidth = `${draggedRect.width}px`;
  const dragProxyState = createDragProxy(draggedTab);

  if (dragProxyState) {
    draggedTab.classList.add(dragSourceClassName);
    dragState.dragProxy = dragProxyState.dragProxy;
    dragState.dragProxyBaseRect = dragProxyState.dragProxyBaseRect;
    return;
  }

  const isActive = draggedTab.classList.contains(activeTabClassName);
  draggedTab.classList.add(dragClassName, isActive ? activeDragClassName : inactiveDragClassName);
  draggedTab.style.willChange = 'transform';
  draggedTab.style.zIndex = '6';
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

  const finishDrag = () => {
    if (!dragState) {
      return;
    }

    const completedState = dragState;
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

    const releasedProxyRect = completedState.dragProxy
      ? toRectSnapshot(completedState.dragProxy.getBoundingClientRect())
      : toRectSnapshot(completedState.draggedTab.getBoundingClientRect());

    const detachOnDrop = () => {
      const sourceTabList = completedState.currentTabList;
      const sourcePanel = sourceTabList instanceof Element ? sourceTabList.closest('.browser') : null;

      if (!sourceTabList || !sourcePanel) {
        return null;
      }

      const sourceTabRect = toRectSnapshot(completedState.draggedTab.getBoundingClientRect());
      const attachTargetTabList = getAttachTargetTabList({
        clientX: completedState.lastClientX,
        clientY: completedState.lastClientY,
        excludedTabList: sourceTabList
      });

      if (attachTargetTabList) {
        moveTabToPointerPosition({
          tabList: attachTargetTabList,
          draggedTab: completedState.draggedTab,
          pointerClientX: completedState.lastClientX,
          animate: true
        });

        if (
          shouldCloseSourcePanelAfterTransfer({
            sourceTabCountAfterMove: getTabs(sourceTabList).length
          })
        ) {
          removePanel(sourcePanel);
        }

        return 'attach';
      }

      const detachedWindow = createDetachedWindow({
        sourcePanel,
        sourceTabList,
        draggedTab: completedState.draggedTab,
        pointerClientX: completedState.lastClientX,
        pointerClientY: completedState.lastClientY
      });

      if (!detachedWindow) {
        return null;
      }

      initializePanelInteraction(detachedWindow.panel);
      initializeTabList(detachedWindow.tabList);

      if (
        shouldCloseSourcePanelAfterTransfer({
          sourceTabCountAfterMove: getTabs(sourceTabList).length
        })
      ) {
        removePanel(sourcePanel);
      }

      animateDetachedWindowFromTab({
        panel: detachedWindow.panel,
        tabRect: sourceTabRect,
        frame: detachedWindow.frame
      });

      return 'detach';
    };

    if (completedState.mode === 'detached' && completedState.detachedPanel) {
      const panelRect = completedState.detachedPanel.getBoundingClientRect();
      animateDetachedWindowFromTab({
        panel: completedState.detachedPanel,
        tabRect: releasedProxyRect,
        frame: {
          width: panelRect.width,
          height: panelRect.height,
          left: panelRect.left,
          top: panelRect.top
        }
      });
    }

    const cleanupVisualState = () => {
      restoreDraggedTabStyles(completedState);
      removeDragProxy(completedState.dragProxy);
    };

    if (shouldDetachOnDrop(completedState)) {
      const dropDetachMode = detachOnDrop();

      if (dropDetachMode === 'detach') {
        cleanupVisualState();

        if (completedState.dragMoved) {
          suppressNextTabClick();
        }

        return;
      }
    }

    const settleAnimation = animateDragProxyToTarget(completedState);

    if (settleAnimation && typeof settleAnimation.addEventListener === 'function') {
      let didCleanup = false;
      const onAnimationSettled = () => {
        if (didCleanup) {
          return;
        }

        didCleanup = true;
        cleanupVisualState();
      };
      settleAnimation.addEventListener('finish', onAnimationSettled);
      settleAnimation.addEventListener('cancel', onAnimationSettled);
    } else {
      cleanupVisualState();
    }

    if (completedState.dragMoved) {
      suppressNextTabClick();
    }
  };

  const attachToTabList = (nextTabList, clientX, clientY) => {
    if (!dragState || dragState.mode !== 'detached' || !dragState.detachedPanel || !nextTabList) {
      return;
    }

    moveTabToPointerPosition({
      tabList: nextTabList,
      draggedTab: dragState.draggedTab,
      pointerClientX: clientX,
      animate: true
    });

    removeDetachedWindowIfEmpty(dragState.detachedPanel);
    dragState.mode = 'attached';
    dragState.currentTabList = nextTabList;
    dragState.detachOriginY = clientY;
    dragState.reattachArmed = false;
    dragState.detachedPanel = null;
    dragState.detachedPanelWidth = 0;
    dragState.detachedPanelHeight = 0;
    dragState.detachedAnchorOffsetX = 0;
    dragState.detachedAnchorOffsetY = 0;
    rebaseDragVisualAtPointer(dragState, clientX, clientY);
  };

  const applyAttachedDragSample = (clientX, clientY) => {
    if (!dragState) {
      return;
    }

    const deltaX = clientX - dragState.startX;
    const deltaY = clientY - dragState.startY;

    dragState.detachIntentActive = resolveDetachIntent({
      currentIntent: dragState.detachIntentActive,
      deltaY
    });

    if (dragState.dragProxy) {
      dragState.draggedTab.classList.toggle(dragSourceVisibleClassName, dragState.detachIntentActive);
    }

    const visualOffsetY = resolveDragVisualOffsetY({
      deltaY,
      detachIntentActive: dragState.detachIntentActive
    });
    setDragVisualTransform(dragState, deltaX, visualOffsetY);

    if (dragState.detachIntentActive) {
      return;
    }

    const moveResult = moveTabToPointerPosition({
      tabList: dragState.currentTabList,
      draggedTab: dragState.draggedTab,
      pointerClientX: clientX,
      animate: true
    });

    if (!dragState.dragProxy && moveResult.moved) {
      dragState.startX += moveResult.draggedBaseShiftX;
      setDragVisualTransform(dragState, clientX - dragState.startX, visualOffsetY);
    }
  };

  const applyDetachedDragSample = (clientX, clientY) => {
    if (!dragState || !dragState.detachedPanel) {
      return;
    }

    const detachedDeltaX = clientX - dragState.startX;
    const detachedDeltaY = clientY - dragState.startY;
    setDragVisualTransform(dragState, detachedDeltaX, detachedDeltaY);
    const frame = computeDetachedPanelFrame({
      pointerClientX: clientX,
      pointerClientY: clientY,
      panelWidth: dragState.detachedPanelWidth,
      panelHeight: dragState.detachedPanelHeight,
      anchorOffsetX: dragState.detachedAnchorOffsetX,
      anchorOffsetY: dragState.detachedAnchorOffsetY
    });

    applyPanelFrame(dragState.detachedPanel, frame);
    if (!dragState.reattachArmed) {
      dragState.reattachArmed = shouldArmReattach({
        clientY,
        detachOriginY: dragState.detachOriginY
      });
    }

    if (!dragState.reattachArmed) {
      return;
    }

    const attachTargetTabList = getAttachTargetTabList({
      clientX,
      clientY,
      excludedTabList: dragState.currentTabList
    });

    if (attachTargetTabList) {
      attachToTabList(attachTargetTabList, clientX, clientY);
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

    dragState.dragStarted = true;
    dragState.dragMoved = true;
    applyDragStyles(dragState);

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

    if (dragState.mode === 'detached') {
      applyDetachedDragSample(clientX, clientY);
      return;
    }

    applyAttachedDragSample(clientX, clientY);
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

    dragState = {
      pointerId: event.pointerId,
      draggedTab,
      currentTabList: tabList,
      detachedPanel: null,
      detachedPanelWidth: 0,
      detachedPanelHeight: 0,
      detachedAnchorOffsetX: 0,
      detachedAnchorOffsetY: 0,
      dragProxy: null,
      dragProxyBaseRect: null,
      dragStarted: false,
      dragMoved: false,
      detachIntentActive: false,
      mode: 'attached',
      startX: event.clientX,
      startY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      detachOriginY: event.clientY,
      reattachArmed: false,
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
    };

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  return true;
};
