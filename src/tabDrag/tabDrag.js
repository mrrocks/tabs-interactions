import { isEventTargetElement } from '../shared/dom';
import { scaleDurationMs } from '../motion/motionSpeed';
import { activeTabClassName } from '../tabs/tabState';
import { getTabs, setActiveTab, tabListSelector, tabSelector } from '../tabs/tabs';
import {
  animateDetachedWindowFromTab,
  animatedRemovePanel,
  createDetachedWindow,
  moveTabToList
} from '../window/windowManager';
import { bringToFront } from '../window/windowFocus';
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
  resistanceOnsetInsetPx,
  windowAttachPaddingPx,
  computeOvershoot,
  getInsertionIndexFromCenters,
  getProxySettleDelta,
  resolveDetachIntent,
  resolveDetachedTabWidth,
  resolveDropAttachTarget,
  resolveDropDetachIntent,
  resolveDragVisualOffsetX,
  resolveDragVisualOffsetY,
  resolveSourceActivationIndexAfterDetach,
  shouldCloseSourcePanelAfterTransfer,
  shouldDetachOnDrop,
  shouldRemoveSourceWindowOnDetach
} from './dragCalculations';
import { createHoverPreviewManager } from './hoverPreviewManager';
import { createDetachPlaceholderManager } from './detachPlaceholder';
import { createDragVisualWidthManager } from './dragVisualWidth';
import {
  animateCornerClipIn,
  animateCornerClipOut,
  animateShapeRadiusToAttached,
  animateShapeRadiusToDetached
} from './cornerClipAnimation';
import { animateDragShadowIn, animateDragShadowOut } from './dragShadowAnimation';
import { createDetachTransitionManager } from './detachTransition';
import { dragTransitionDurationMs, dragShadowOutDurationMs } from './dragAnimationConfig';

export {
  dragActivationDistancePx,
  detachThresholdPx,
  reentryPaddingPx,
  resistanceFactor,
  resistanceMaxPx,
  resistanceOnsetInsetPx,
  windowAttachPaddingPx,
  applyResistance,
  computeOvershoot,
  shouldDetachFromOvershoot,
  getInsertionIndexFromCenters,
  getProxySettleDelta,
  resolveDetachIntent,
  resolveDropAttachTarget,
  resolveDropDetachIntent,
  resolveDragVisualOffsetX,
  resolveDragVisualOffsetY,
  resolveHoverPreviewWidthPx,
  resolveSourceActivationIndexAfterDetach,
  shouldCloseSourcePanelAfterTransfer,
  shouldDetachOnDrop,
  shouldRemoveSourceWindowOnDetach
} from './dragCalculations';

const dragClassName = 'tab--dragging';
const activeDragClassName = 'tab--dragging-active';
const inactiveDragClassName = 'tab--dragging-inactive';
const dragSourceClassName = 'tab--drag-source';
const dragProxyClassName = 'tab--drag-proxy';
const noTransitionClassName = 'tab--no-transition';
const dragHoverPreviewClassName = 'tab--drag-hover-preview';
const bodyDraggingClassName = 'body--tab-dragging';
const tabAddSelector = '.tab--add';
const closeButtonSelector = '.tab--close';
const initializedRoots = new WeakSet();

const getDetachReferenceRect = (tabList) => {
  if (!tabList || typeof tabList.closest !== 'function') {
    return null;
  }

  const panel = tabList.closest('.browser');
  if (!panel) {
    return null;
  }

  const tabRow = typeof panel.querySelector === 'function' ? panel.querySelector('.tab--row') : null;
  const baseRect =
    tabRow && typeof tabRow.getBoundingClientRect === 'function'
      ? tabRow.getBoundingClientRect()
      : typeof tabList.getBoundingClientRect === 'function'
        ? tabList.getBoundingClientRect()
        : null;

  if (!baseRect) {
    return null;
  }

  const paddingTop = typeof globalThis.getComputedStyle === 'function'
    ? parseFloat(getComputedStyle(panel).paddingTop) || 0
    : 0;

  return {
    left: baseRect.left,
    right: baseRect.right,
    top: baseRect.top - paddingTop,
    bottom: baseRect.bottom
  };
};

const isPointerInsideCurrentHeader = ({ tabList, clientX, clientY, padding = windowAttachPaddingPx }) => {
  const headerRect = getDetachReferenceRect(tabList);
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
    dragProxyClassName,
    noTransitionClassName
  });
  const animationCoordinator = createAnimationCoordinator({
    scaleDurationMs,
    getProxySettleDelta,
    dragProxySettleDurationMs: dragTransitionDurationMs
  });
  const layoutPipeline = createLayoutPipeline({
    getTabs,
    getInsertionIndexFromCenters,
    moveTabToList,
    onBeforeMeasure: animationCoordinator.cancelAllSiblingAnimations,
    tabAddSelector
  });
  const dropResolver = createDropResolver({
    tabListSelector,
    defaultAttachPaddingPx: reentryPaddingPx
  });
  const hoverPreview = createHoverPreviewManager({
    tabItemClassName: tabSelector.slice(1),
    dragHoverPreviewClassName
  });
  const placeholderManager = createDetachPlaceholderManager({
    scaleDurationMs,
    detachCollapseDurationMs: dragTransitionDurationMs
  });
  const visualWidth = createDragVisualWidthManager({
    scaleDurationMs,
    hoverPreviewExpandDurationMs: dragTransitionDurationMs,
    tabItemClassName: tabSelector.slice(1)
  });
  const detachTransition = createDetachTransitionManager({
    scaleDurationMs,
    transitionDurationMs: dragTransitionDurationMs
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

  const moveTabWithLayoutPipeline = ({ tabList, draggedTab, pointerClientX, dragDirectionSign }) => {
    layoutPipeline.beginFrame();
    const moveResult = layoutPipeline.moveTabToPointerPosition({
      tabList,
      draggedTab,
      pointerClientX,
      dragDirectionSign
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
    placeholderManager.restoreDisplay(draggedTab);

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
    visualWidth.cancelAll();
    detachTransition.reset();
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
      hoverPreview.clear();
      visualWidth.reset(completedState);
      return;
    }

    const cleanupVisualState = () => {
      dragDomAdapter.cleanupVisualState(completedState);
      if (completedState.draggedTab.classList.contains(activeTabClassName)) {
        const durationMs = scaleDurationMs(dragTransitionDurationMs);
        animateCornerClipIn(completedState.draggedTab, { durationMs });
        animateShapeRadiusToAttached(completedState.draggedTab, { durationMs });
      }
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
    } else if (dropDestination === 'detach' && sourceTabList && sourcePanel) {
      const tabScreenRect = dragDomAdapter.toRectSnapshot(
        (completedState.dragProxy ?? completedState.draggedTab).getBoundingClientRect()
      );
      const activateInSource = captureSourceActivation(completedState.draggedTab, sourceTabList);
      const detachedWindow = createDetachedWindow({
        sourcePanel,
        sourceTabList,
        tabScreenRect,
        sourcePanelRect: completedState.sourcePanelRect
      });

      if (detachedWindow) {
        initializePanelInteraction(detachedWindow.panel);
        initializeTabList(detachedWindow.tabList);

        animateDetachedWindowFromTab({
          ...detachedWindow,
          draggedTab: completedState.draggedTab,
          tabScreenRect,
          onTabInserted: () => {
            const tab = completedState.draggedTab;
            const proxy = completedState.dragProxy;
            tab.classList.add(noTransitionClassName);
            placeholderManager.restoreDisplay(tab);
            tab.classList.remove(dragSourceClassName, dragClassName, activeDragClassName, inactiveDragClassName);
            tab.style.transform = '';
            tab.style.transition = '';
            tab.style.flex = '';
            tab.style.flexBasis = '';
            tab.style.minWidth = '';
            tab.style.maxWidth = '';
            tab.style.willChange = '';
            tab.style.zIndex = '';
            tab.style.visibility = 'hidden';
            if (proxy) {
              const wasInactive = proxy.classList.contains(inactiveDragClassName);
              if (wasInactive) {
                proxy.classList.remove(dragClassName);
                proxy.getBoundingClientRect();
                proxy.classList.remove(inactiveDragClassName);
                proxy.classList.add(activeDragClassName);
              }
              const durationMs = scaleDurationMs(dragTransitionDurationMs);
              animateCornerClipIn(proxy, { durationMs, fill: 'forwards' });
              animateShapeRadiusToAttached(proxy, { durationMs, fill: 'forwards' });
              animateDragShadowOut(proxy, {
                durationMs: scaleDurationMs(dragShadowOutDurationMs),
                isActive: true
              });
            }
            tab.getBoundingClientRect();
            tab.classList.remove(noTransitionClassName);
            setActiveTab(detachedWindow.tabList, 0);
          },
          onComplete: () => {
            completedState.draggedTab.style.visibility = '';
            dragDomAdapter.removeDragProxy(completedState.dragProxy);
            if (shouldCloseSourcePanelAfterTransfer({ sourceTabCountAfterMove: getTabs(sourceTabList).length })) {
              animatedRemovePanel(sourcePanel);
            }
          }
        });
        activateInSource?.();
        hoverPreview.clear();
        visualWidth.cancelAll();

        if (completedState.dragMoved) {
          signalDragCompleted();
        }

        return;
      }
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

  const applyAttachedDragSample = (clientX, clientY) => {
    if (!dragState) {
      return;
    }

    const deltaX = clientX - dragState.startX;
    const deltaY = clientY - dragState.startY;
    const wasDetached = dragState.detachIntentActive;

    const refRect = getDetachReferenceRect(dragState.currentTabList);
    const overshootX = refRect
      ? computeOvershoot({ value: clientX, min: refRect.left, max: refRect.right, inset: resistanceOnsetInsetPx })
      : 0;
    const overshootY = refRect
      ? computeOvershoot({ value: clientY, min: refRect.top, max: refRect.bottom, inset: resistanceOnsetInsetPx })
      : 0;

    if (dragState.reattachArmed) {
      dragState.detachIntentActive = resolveDetachIntent({
        currentIntent: dragState.detachIntentActive,
        overshootX,
        overshootY
      });
    } else if (
      Math.abs(overshootX) < detachThresholdPx * 0.5 &&
      Math.abs(overshootY) < detachThresholdPx * 0.5
    ) {
      dragState.reattachArmed = true;
    }

    if (!wasDetached && dragState.detachIntentActive) {
      detachTransition.activate({ overshootX, overshootY });
      if (dragState.dragProxy) {
        const panel = dragState.currentTabList?.closest?.('.browser');
        visualWidth.animateToDetachedWidth(dragState, resolveDetachedTabWidth(panel));
      }
    }

    if (dragState.dragProxy) {
      const isLastTab = shouldRemoveSourceWindowOnDetach(dragState.sourceTabCount);

      if (dragState.detachIntentActive && isLastTab && !sourceWindowRemovedDuringDetach) {
        const sourcePanel =
          dragState.currentTabList && typeof dragState.currentTabList.closest === 'function'
            ? dragState.currentTabList.closest('.browser')
            : null;

        if (sourcePanel) {
          dragState.sourcePanelRect = dragDomAdapter.toRectSnapshot(sourcePanel.getBoundingClientRect());
          if (animatedRemovePanel(sourcePanel)) {
            sourceWindowRemovedDuringDetach = true;
          }
        }
      }

      const previewOccupiesSource = hoverPreview.previewTabList === dragState.currentTabList;
      if (!isLastTab && dragState.detachIntentActive && !previewOccupiesSource) {
        const insideHeader = isPointerInsideCurrentHeader({
          tabList: dragState.currentTabList,
          clientX,
          clientY
        });
        placeholderManager.sync(!insideHeader, dragState);
      }
    }

    const correction = detachTransition.sample();
    const visualOffsetX = resolveDragVisualOffsetX({
      deltaX,
      overshootX,
      detachIntentActive: dragState.detachIntentActive
    }) + correction.x;
    const visualOffsetY = resolveDragVisualOffsetY({
      deltaY,
      overshootY,
      detachIntentActive: dragState.detachIntentActive
    }) + correction.y;
    dragDomAdapter.setDragVisualTransform(dragState, visualOffsetX, visualOffsetY);

    if (!detachTransition.active && attachToHoveredTabListFromAttachedDrag(clientX, clientY)) {
      return;
    }

    if (dragState.detachIntentActive) {
      return;
    }

    const moveResult = moveTabWithLayoutPipeline({
      tabList: dragState.currentTabList,
      draggedTab: dragState.draggedTab,
      pointerClientX: clientX,
      dragDirectionSign: Math.sign(deltaX)
    });

    if (!dragState.dragProxy && moveResult.moved) {
      dragState.startX += moveResult.draggedBaseShiftX;
      const updatedDeltaX = clientX - dragState.startX;
      const updatedVisualOffsetX = resolveDragVisualOffsetX({
        deltaX: updatedDeltaX,
        overshootX,
        detachIntentActive: dragState.detachIntentActive
      }) + correction.x;
      dragDomAdapter.setDragVisualTransform(dragState, updatedVisualOffsetX, visualOffsetY);
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
      excludedTabList: dragState.detachIntentActive ? null : sourceTabList,
      padding: windowAttachPaddingPx
    });

    if (attachTarget) {
      dragState.hoverAttachTabList = attachTarget;
      dragState.hoverAttachClientX = clientX;
      dragState.hoverAttachClientY = clientY;
    }

    if (!attachTarget) {
      const leavingSourceWhileDetached =
        dragState.detachIntentActive && hoverPreview.previewTabList === sourceTabList;

      if (leavingSourceWhileDetached && hoverPreview.previewTab) {
        const previewWidthPx = hoverPreview.previewTab.getBoundingClientRect().width;
        placeholderManager.ensureAt(hoverPreview.previewTab, dragState, previewWidthPx);
        hoverPreview.clear();
        visualWidth.cancelAll();
      } else {
        visualWidth.animateOut(hoverPreview.previewTab, (displacements) => {
          animationCoordinator.animateSiblingDisplacement(displacements);
        });
        hoverPreview.detach();
      }

      if (dragState.detachIntentActive) {
        const panel = sourceTabList?.closest?.('.browser');
        visualWidth.animateToDetachedWidth(dragState, resolveDetachedTabWidth(panel));
      } else {
        visualWidth.reset(dragState);
      }
      return false;
    }

    if (!hoverPreview.previewTab || hoverPreview.previewTabList !== attachTarget) {
      const targetPanel = attachTarget.closest?.('.browser');
      if (targetPanel) {
        bringToFront(targetPanel);
      }
      const replacingPlaceholder = attachTarget === sourceTabList && placeholderManager.active;
      const placeholderWidthPx = replacingPlaceholder ? placeholderManager.targetWidthPx() : 0;
      hoverPreview.createAndAttach(attachTarget);
      if (replacingPlaceholder) {
        placeholderManager.replaceWith(hoverPreview.previewTab);
      }
      moveTabWithLayoutPipeline({
        tabList: attachTarget,
        draggedTab: hoverPreview.previewTab,
        pointerClientX: clientX
      });
      const { displacements } = visualWidth.animateIn(dragState, hoverPreview.previewTab, { fromWidthPx: placeholderWidthPx });
      if (displacements.length > 0) {
        animationCoordinator.animateSiblingDisplacement(displacements);
      }
    } else if (!visualWidth.animatingIn) {
      moveTabWithLayoutPipeline({
        tabList: attachTarget,
        draggedTab: hoverPreview.previewTab,
        pointerClientX: clientX
      });
      visualWidth.syncWidth(dragState, hoverPreview.previewTab);
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

    const wasActive = dragState.draggedTab.classList.contains(activeTabClassName);
    dragState = markSessionAsActivated(dragState);
    dragDomAdapter.applyDragStyles(dragState);

    if (wasActive && dragState.dragProxy) {
      const durationMs = scaleDurationMs(dragTransitionDurationMs);
      animateCornerClipOut(dragState.dragProxy, { durationMs });
      animateShapeRadiusToDetached(dragState.dragProxy, { durationMs });
    }

    if (dragState.dragProxy) {
      animateDragShadowIn(dragState.dragProxy, {
        durationMs: scaleDurationMs(dragTransitionDurationMs),
        isActive: wasActive
      });
    }

    if (typeof document !== 'undefined' && document.body) {
      document.body.style.userSelect = 'none';
      document.body.classList.add(bodyDraggingClassName);
    }
  };

  const applyDragSample = () => {
    if (!dragState) {
      return;
    }

    if (!hasQueuedPointer && !detachTransition.active) {
      return;
    }

    const clientX = hasQueuedPointer ? queuedClientX : dragState.lastClientX;
    const clientY = hasQueuedPointer ? queuedClientY : dragState.lastClientY;
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
    if (detachTransition.active) {
      scheduleDragFrame();
    }
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
        flexBasis: draggedTab.style.flexBasis,
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
    visualWidth.cancelAll();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  return true;
};
