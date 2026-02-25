import { isEventTargetElement, toRectSnapshot } from '../shared/dom';
import { scaleDurationMs } from '../motion/motionSpeed';
import { panelSelector, tabAddSelector, tabCloseSelector } from '../shared/selectors';
import { activeTabClassName } from '../tabs/tabState';
import { getTabs, setActiveTab, tabListSelector, tabSelector } from '../tabs/tabs';
import {
  animateDetachedWindowFromTab,
  createDetachedWindowToggle,
  animatedRemovePanel,
  applyPanelFrame,
  createDetachedWindow,
  moveTabToList,
  removePanel
} from '../window/windowManager';
import { bringToFront, getOverlayZIndex } from '../window/windowFocus';
import { DragPhase, createDragContext, transitionTo } from './DragContext';
import { createLayoutPipeline } from './layoutPipeline';
import { createDropResolver, isPointInsideRect } from './dropResolver';
import { createAnimationCoordinator } from './animationCoordinator';
import { createDragDomAdapter } from './dragDomAdapter';
import { clearDragCompleted, signalDragCompleted } from '../tabs/tabDragSignal';
import {
  dragActivationDistancePx,
  detachThresholdPx,
  longPressActivationDelayMs,
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
import { animateDragShadowOut } from './dragShadowAnimation';
import { createDetachTransitionManager } from './detachTransition';
import { dragTransitionDurationMs, dragShadowOutDurationMs } from './dragAnimationConfig';
import {
  measureAndLockFlexWidth,
  clearDragInlineStyles,
  applyProxyDetachedStyle,
  applyProxyAttachedStyle,
  applyTabAttachedStyle
} from './styleHelpers';
import { isPinned, pinnedClassName } from '../tabs/tabPinning';
import {
  resolveEdgeSnapZone,
  computeSnappedFrame,
  createEdgeSnapPreview,
  animatePanelToSnappedFrame,
  snappedPanelFrames
} from '../panel/panelEdgeSnap';

const dragClassName = 'tab--dragging';
const activeDragClassName = 'tab--dragging-active';
const inactiveDragClassName = 'tab--dragging-inactive';
const dragSourceClassName = 'tab--drag-source';
const dragProxyClassName = 'tab--drag-proxy';
const noTransitionClassName = 'tab--no-transition';
const dragHoverPreviewClassName = 'tab--drag-hover-preview';
const bodyDraggingClassName = 'body--tab-dragging';
const initializedRoots = new WeakSet();

const getDetachReferenceRect = (tabList) => {
  if (!tabList || typeof tabList.closest !== 'function') {
    return null;
  }

  const panel = tabList.closest(panelSelector);
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
  const constrainInsertionIndex = ({ index, draggedTab, siblingTabs }) => {
    const pinnedBoundary = siblingTabs.findIndex((t) => !isPinned(t));
    const pinnedCount = pinnedBoundary === -1 ? siblingTabs.length : pinnedBoundary;

    if (isPinned(draggedTab)) {
      return Math.min(index, pinnedCount);
    }
    return Math.max(index, pinnedCount);
  };

  const layoutPipeline = createLayoutPipeline({
    getTabs,
    getInsertionIndexFromCenters,
    moveTabToList,
    onBeforeMeasure: animationCoordinator.cancelAllSiblingAnimations,
    constrainInsertionIndex,
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

  let ctx = null;
  let frameRequestId = 0;
  let longPressTimerId = 0;
  let queuedClientX = 0;
  let queuedClientY = 0;
  let hasQueuedPointer = false;
  let sourceWindowRemovedDuringDetach = false;
  let pendingDetachSpawn = false;
  let detachWindowToggle = null;
  let detachEdgeSnapPreview = null;

  const preventSelectStart = (event) => {
    event.preventDefault();
  };

  const clearLongPressTimer = () => {
    if (longPressTimerId !== 0) {
      clearTimeout(longPressTimerId);
      longPressTimerId = 0;
    }
  };

  const clearGlobalListeners = () => {
    clearLongPressTimer();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('selectstart', preventSelectStart);
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

  const lockToNaturalFlexWidth = (tab) => {
    measureAndLockFlexWidth(tab);
  };

  const commitDropAttach = ({ draggedTab, attachTargetTabList, pointerClientX }) => {
    placeholderManager.restoreDisplay(draggedTab);

    const didCommitPreviewDrop = hoverPreview.commitDrop({
      draggedTab,
      attachTargetTabList
    });

    if (didCommitPreviewDrop) {
      lockToNaturalFlexWidth(draggedTab);
    } else {
      moveTabWithLayoutPipeline({
        tabList: attachTargetTabList,
        draggedTab,
        pointerClientX
      });
    }

    activateDraggedTabInTarget(draggedTab, attachTargetTabList);
  };

  const parkProxy = (state) => {
    const proxy = state.dragProxy;
    if (!proxy) return;
    proxy.getAnimations?.({ subtree: true })?.forEach((a) => a.cancel());
    proxy.style.visibility = 'hidden';
    proxy.style.pointerEvents = 'none';
    proxy.style.opacity = '';
    state.proxyParked = true;
  };

  const parkProxyWithOffset = (state, clientX, clientY) => {
    parkProxy(state);
    if (state.detachedPanelFrame) {
      state.detachedPointerOffset = {
        x: clientX - state.detachedPanelFrame.left,
        y: clientY - state.detachedPanelFrame.top
      };
    }
  };

  const unparkProxy = (state, clientX, clientY) => {
    const proxy = state.dragProxy;
    if (!proxy) return;
    proxy.getAnimations?.({ subtree: true })?.forEach((a) => a.cancel());

    const tabRect = state.draggedTab.getBoundingClientRect();
    proxy.style.transform = 'translate3d(0px, 0px, 0px)';
    proxy.style.left = `${tabRect.left}px`;
    proxy.style.top = `${tabRect.top}px`;
    proxy.style.visibility = '';
    proxy.style.pointerEvents = '';
    proxy.style.opacity = '0';
    state.proxyParked = false;
    dragDomAdapter.rebaseDragVisualAtPointer(state, clientX, clientY);

    const durationMs = scaleDurationMs(dragTransitionDurationMs);
    applyProxyDetachedStyle(proxy, { isActive: true, durationMs });
    proxy.animate(
      [{ opacity: '0' }, { opacity: '1' }],
      { duration: durationMs, easing: 'ease', fill: 'forwards' }
    );
  };

  const fadeOutProxy = (state, clientX, clientY) => {
    const proxy = state.dragProxy;
    if (!proxy || state.proxyParked) return;
    const currentOpacity = getComputedStyle(proxy).opacity;
    proxy.getAnimations().forEach((a) => a.cancel());
    proxy.style.opacity = currentOpacity;
    const durationMs = scaleDurationMs(dragTransitionDurationMs) * parseFloat(currentOpacity);
    const fadeOut = proxy.animate(
      [{ opacity: currentOpacity }, { opacity: '0' }],
      { duration: Math.max(durationMs, 16), easing: 'ease', fill: 'forwards' }
    );
    fadeOut.addEventListener('finish', () => {
      if (state.proxyParked) {
        proxy.style.visibility = 'hidden';
        proxy.style.opacity = '';
        proxy.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      }
    }, { once: true });
    proxy.style.pointerEvents = 'none';
    state.proxyParked = true;
    if (state.detachedPanelFrame) {
      state.detachedPointerOffset = {
        x: clientX - state.detachedPanelFrame.left,
        y: clientY - state.detachedPanelFrame.top
      };
    }
  };

  const spawnDetachedWindowDuringDrag = (clientX, clientY) => {
    if (!ctx || ctx.detachedPanel) {
      return;
    }

    const sourceTabList = ctx.currentTabList;
    const sourcePanel =
      sourceTabList && typeof sourceTabList.closest === 'function'
        ? sourceTabList.closest(panelSelector)
        : null;
    if (!sourcePanel) {
      return;
    }

    const isLastTab = shouldRemoveSourceWindowOnDetach(ctx.sourceTabCount);
    if (isLastTab) {
      ctx.sourcePanelRect = toRectSnapshot(sourcePanel.getBoundingClientRect());
    }

    const tabScreenRect = toRectSnapshot(
      (ctx.dragProxy ?? ctx.draggedTab).getBoundingClientRect()
    );
    const activateInSource = captureSourceActivation(ctx.draggedTab, sourceTabList);

    const detachedWindow = createDetachedWindow({
      sourcePanel,
      sourceTabList,
      tabScreenRect,
      sourcePanelRect: ctx.sourcePanelRect
    });

    if (!detachedWindow) {
      return;
    }

    initializePanelInteraction(detachedWindow.panel);
    initializeTabList(detachedWindow.tabList);

    const tab = ctx.draggedTab;
    const proxy = ctx.dragProxy;
    let scaleInCompleted = false;

    const onScaleInComplete = () => {
      scaleInCompleted = true;
      clearTimeout(scaleInFallbackId);
      tab.style.visibility = '';
      if (!ctx || ctx.dragProxy !== proxy) {
        dragDomAdapter.removeDragProxy(proxy);
        return;
      }
      if (ctx.proxyParked || hoverPreview.previewTabList != null) {
        return;
      }
      parkProxyWithOffset(ctx, ctx.lastClientX, ctx.lastClientY);
    };

    const scaleInFallbackId = setTimeout(() => {
      if (!scaleInCompleted) {
        onScaleInComplete();
      }
    }, scaleDurationMs(300));

    animateDetachedWindowFromTab({
      ...detachedWindow,
      draggedTab: tab,
      tabScreenRect,
      onTabInserted: () => {
        tab.classList.add(noTransitionClassName);
        placeholderManager.restoreDisplay(tab);
        tab.classList.remove(dragSourceClassName, dragClassName, activeDragClassName, inactiveDragClassName);
        clearDragInlineStyles(tab);
        tab.style.visibility = 'hidden';
        if (proxy) {
          const wasInactive = proxy.classList.contains(inactiveDragClassName);
          if (wasInactive) {
            proxy.classList.remove(dragClassName);
            proxy.getBoundingClientRect();
            proxy.classList.remove(inactiveDragClassName);
            proxy.classList.add(activeDragClassName);
          }
          applyProxyAttachedStyle(proxy, { isActive: true });
        }
        tab.getBoundingClientRect();
        tab.classList.remove(noTransitionClassName);
        setActiveTab(detachedWindow.tabList, 0);
      },
      onComplete: onScaleInComplete
    });

    ctx.detachedPanel = detachedWindow.panel;
    ctx.detachedTabList = detachedWindow.tabList;
    ctx.detachedPanelFrame = { ...detachedWindow.frame };
    ctx.detachedTabOffsetInPanel = { ...detachedWindow.tabOffsetInPanel };

    activateInSource?.();
    hoverPreview.clear();
    visualWidth.cancelAll();

    if (isLastTab) {
      if (animatedRemovePanel(sourcePanel)) {
        sourceWindowRemovedDuringDetach = true;
      }
    }
  };

  const promotePanelToDetached = () => {
    if (!ctx || ctx.detachedPanel) {
      return;
    }

    const panel = ctx.currentTabList?.closest?.(panelSelector);
    if (!panel) {
      return;
    }

    const panelRect = panel.getBoundingClientRect();
    const tabRect = ctx.draggedTab.getBoundingClientRect();

    ctx.detachedPanel = panel;
    ctx.detachedTabList = ctx.currentTabList;
    ctx.detachedPanelFrame = {
      width: panelRect.width,
      height: panelRect.height,
      left: panelRect.left,
      top: panelRect.top
    };
    ctx.detachedTabOffsetInPanel = {
      x: tabRect.left - panelRect.left,
      y: tabRect.top - panelRect.top
    };
    ctx.detachedPointerOffset = {
      x: ctx.startX - panelRect.left,
      y: ctx.startY - panelRect.top
    };

    ctx.draggedTab.classList.remove(dragSourceClassName, dragClassName, activeDragClassName, inactiveDragClassName);
    clearDragInlineStyles(ctx.draggedTab);

    if (ctx.dragProxy) {
      parkProxy(ctx);
    }

    hoverPreview.clear();
    visualWidth.cancelAll();
  };

  const syncDetachedPanelToProxy = (clientX) => {
    if (!ctx || !ctx.detachedPanel) {
      return;
    }

    const proxyRect = (ctx.dragProxy ?? ctx.draggedTab).getBoundingClientRect();
    const offset = ctx.detachedTabOffsetInPanel;
    const frame = ctx.detachedPanelFrame;

    frame.left = proxyRect.left - offset.x;
    frame.top = proxyRect.top - offset.y;
    applyPanelFrame(ctx.detachedPanel, frame);

    const snapZone = resolveEdgeSnapZone(clientX, window.innerWidth);
    if (snapZone) {
      if (!detachEdgeSnapPreview) detachEdgeSnapPreview = createEdgeSnapPreview();
      detachEdgeSnapPreview.show(snapZone);
    } else if (detachEdgeSnapPreview) {
      detachEdgeSnapPreview.hide();
    }
  };

  const attachToHoveredTabListFromAttachedDrag = (clientX, clientY) => {
    if (!ctx || ctx.phase !== DragPhase.reordering && ctx.phase !== DragPhase.detachIntent && ctx.phase !== DragPhase.detachedDragging) {
      return false;
    }

    const sourceTabList = ctx.currentTabList;
    const attachTarget = dropResolver.resolveAttachTargetTabList({
      clientX,
      clientY,
      excludedTabList: ctx.detachedTabList ?? (ctx.detachIntentActive ? null : sourceTabList),
      padding: windowAttachPaddingPx
    });

    if (attachTarget) {
      ctx.hoverAttachTabList = attachTarget;
      ctx.hoverAttachClientX = clientX;
      ctx.hoverAttachClientY = clientY;
    }

    if (!attachTarget) {
      const leavingSourceWhileDetached =
        ctx.detachIntentActive && !ctx.detachedPanel && hoverPreview.previewTabList === sourceTabList;

      if (leavingSourceWhileDetached && hoverPreview.previewTab) {
        const previewWidthPx = hoverPreview.previewTab.getBoundingClientRect().width;
        placeholderManager.ensureAt(hoverPreview.previewTab, ctx, previewWidthPx);
        hoverPreview.clear();
        visualWidth.cancelAll();
      } else {
        visualWidth.animateOut(hoverPreview.previewTab, (displacements) => {
          animationCoordinator.animateSiblingDisplacement(displacements);
        });
        hoverPreview.detach();
      }

      if (ctx.detachIntentActive && !isPinned(ctx.draggedTab)) {
        const panel = sourceTabList?.closest?.(panelSelector);
        visualWidth.animateToDetachedWidth(ctx, resolveDetachedTabWidth(panel) || ctx.detachedWidthPx);
      } else if (!ctx.detachIntentActive) {
        visualWidth.animateToBaseWidth(ctx);
      }
      return false;
    }

    if (!hoverPreview.previewTab || hoverPreview.previewTabList !== attachTarget) {
      const targetPanel = attachTarget.closest?.(panelSelector);
      if (targetPanel) {
        bringToFront(targetPanel);
      }
      if (ctx.detachedPanel) {
        bringToFront(ctx.detachedPanel);
        if (ctx.dragProxy) {
          ctx.dragProxy.style.zIndex = String(getOverlayZIndex());
        }
      }
      const replacingPlaceholder = attachTarget === sourceTabList && placeholderManager.active;
      const placeholderWidthPx = replacingPlaceholder ? placeholderManager.targetWidthPx() : 0;
      hoverPreview.createAndAttach(attachTarget);
      if (isPinned(ctx.draggedTab)) {
        hoverPreview.previewTab.classList.add(pinnedClassName);
      }
      if (replacingPlaceholder) {
        placeholderManager.replaceWith(hoverPreview.previewTab);
      }
      moveTabWithLayoutPipeline({
        tabList: attachTarget,
        draggedTab: hoverPreview.previewTab,
        pointerClientX: clientX
      });
      const { displacements } = visualWidth.animateIn(ctx, hoverPreview.previewTab, { fromWidthPx: placeholderWidthPx });
      if (displacements.length > 0) {
        animationCoordinator.animateSiblingDisplacement(displacements);
      }
    } else if (!visualWidth.animatingIn) {
      moveTabWithLayoutPipeline({
        tabList: attachTarget,
        draggedTab: hoverPreview.previewTab,
        pointerClientX: clientX
      });
      visualWidth.syncWidth(ctx, hoverPreview.previewTab);
    }

    return true;
  };

  const computeDetachState = (clientX, clientY) => {
    const refRect = getDetachReferenceRect(ctx.currentTabList);
    const overshootX = refRect
      ? computeOvershoot({ value: clientX, min: refRect.left, max: refRect.right, inset: resistanceOnsetInsetPx })
      : 0;
    const overshootY = refRect
      ? computeOvershoot({ value: clientY, min: refRect.top, max: refRect.bottom, inset: resistanceOnsetInsetPx })
      : 0;

    if (ctx.reattachArmed) {
      ctx.detachIntentActive = resolveDetachIntent({
        currentIntent: ctx.detachIntentActive,
        overshootX,
        overshootY
      });
    } else if (
      Math.abs(overshootX) < detachThresholdPx * 0.5 &&
      Math.abs(overshootY) < detachThresholdPx * 0.5
    ) {
      ctx.reattachArmed = true;
    }

    if (ctx.detachIntentActive) {
      const hoverTarget = dropResolver.resolveAttachTargetTabList({
        clientX,
        clientY,
        excludedTabList: ctx.currentTabList,
        padding: windowAttachPaddingPx
      });
      if (hoverTarget) {
        ctx.detachIntentActive = false;
      }
    }

    return { overshootX, overshootY };
  };

  const phases = {
    [DragPhase.pressed]: {
      enter() {
        longPressTimerId = setTimeout(activateDrag, scaleDurationMs(longPressActivationDelayMs));
      },
      frame(clientX, clientY) {
        const dx = clientX - ctx.startX;
        const dy = clientY - ctx.startY;
        if (Math.hypot(dx, dy) >= dragActivationDistancePx) {
          activateDrag();
        }
      },
      exit() {
        clearLongPressTimer();
      }
    },

    [DragPhase.reordering]: {
      enter() {},
      frame(clientX, clientY) {
        const deltaX = clientX - ctx.startX;
        const deltaY = clientY - ctx.startY;

        const { overshootX, overshootY } = computeDetachState(clientX, clientY);

        if (ctx.detachIntentActive) {
          setPhase(DragPhase.detachIntent);
          phases[DragPhase.detachIntent].beginDetach(clientX, clientY, overshootX, overshootY);
          return;
        }

        const correction = detachTransition.sample();
        const visualOffsetX = resolveDragVisualOffsetX({
          deltaX,
          overshootX,
          detachIntentActive: false
        }) + correction.x;
        const visualOffsetY = resolveDragVisualOffsetY({
          deltaY,
          overshootY,
          detachIntentActive: false
        }) + correction.y;
        dragDomAdapter.setDragVisualTransform(ctx, visualOffsetX, visualOffsetY);

        if (!detachTransition.active && attachToHoveredTabListFromAttachedDrag(clientX, clientY)) {
          return;
        }

        const moveResult = moveTabWithLayoutPipeline({
          tabList: ctx.currentTabList,
          draggedTab: ctx.draggedTab,
          pointerClientX: clientX,
          dragDirectionSign: Math.sign(deltaX)
        });

        if (!ctx.dragProxy && moveResult.moved) {
          ctx.startX += moveResult.draggedBaseShiftX;
          const updatedDeltaX = clientX - ctx.startX;
          const updatedVisualOffsetX = resolveDragVisualOffsetX({
            deltaX: updatedDeltaX,
            overshootX,
            detachIntentActive: false
          }) + correction.x;
          dragDomAdapter.setDragVisualTransform(ctx, updatedVisualOffsetX, visualOffsetY);
        }
      },
      exit() {}
    },

    [DragPhase.detachIntent]: {
      enter() {},
      beginDetach(clientX, clientY, overshootX, overshootY) {
        detachTransition.activate({ overshootX, overshootY });
        if (ctx.dragProxy && !isPinned(ctx.draggedTab)) {
          const panel = ctx.currentTabList?.closest?.(panelSelector);
          const detachedWidth = resolveDetachedTabWidth(panel);
          ctx.detachedWidthPx = detachedWidth;
          visualWidth.animateToDetachedWidth(ctx, detachedWidth);
        }
        pendingDetachSpawn = true;
      },
      frame(clientX, clientY) {
        const deltaX = clientX - ctx.startX;
        const deltaY = clientY - ctx.startY;

        const { overshootX, overshootY } = computeDetachState(clientX, clientY);

        if (pendingDetachSpawn && !detachTransition.active) {
          pendingDetachSpawn = false;
          spawnDetachedWindowDuringDrag(clientX, clientY);
          if (ctx.detachedPanel) {
            setPhase(DragPhase.detachedDragging);
            return;
          }
        }

        if (ctx.dragProxy) {
          const isLastTab = shouldRemoveSourceWindowOnDetach(ctx.sourceTabCount);

          if (isLastTab && !sourceWindowRemovedDuringDetach) {
            const sourcePanel =
              ctx.currentTabList && typeof ctx.currentTabList.closest === 'function'
                ? ctx.currentTabList.closest(panelSelector)
                : null;
            if (sourcePanel) {
              ctx.sourcePanelRect = toRectSnapshot(sourcePanel.getBoundingClientRect());
              if (animatedRemovePanel(sourcePanel)) {
                sourceWindowRemovedDuringDetach = true;
              }
            }
          }

          const previewOccupiesSource = hoverPreview.previewTabList === ctx.currentTabList;
          if (!isLastTab && !previewOccupiesSource) {
            const insideHeader = isPointerInsideCurrentHeader({
              tabList: ctx.currentTabList,
              clientX,
              clientY
            });
            placeholderManager.sync(!insideHeader, ctx);
          }
        }

        const correction = detachTransition.sample();
        const visualOffsetX = resolveDragVisualOffsetX({
          deltaX,
          overshootX,
          detachIntentActive: true
        }) + correction.x;
        const visualOffsetY = resolveDragVisualOffsetY({
          deltaY,
          overshootY,
          detachIntentActive: true
        }) + correction.y;
        dragDomAdapter.setDragVisualTransform(ctx, visualOffsetX, visualOffsetY);

        if (!detachTransition.active && attachToHoveredTabListFromAttachedDrag(clientX, clientY)) {
          return;
        }
      },
      exit() {}
    },

    [DragPhase.detachedDragging]: {
      enter() {},
      frame(clientX, clientY) {
        const deltaX = clientX - ctx.startX;
        const deltaY = clientY - ctx.startY;

        if (ctx.dragProxy && !ctx.proxyParked) {
          dragDomAdapter.setDragVisualTransform(ctx, deltaX, deltaY);
          syncDetachedPanelToProxy(clientX);
        } else if (ctx.detachedPointerOffset) {
          const frame = ctx.detachedPanelFrame;
          frame.left = clientX - ctx.detachedPointerOffset.x;
          frame.top = clientY - ctx.detachedPointerOffset.y;
          applyPanelFrame(ctx.detachedPanel, frame);

          const snapZone = resolveEdgeSnapZone(clientX, window.innerWidth);
          if (snapZone) {
            if (!detachEdgeSnapPreview) detachEdgeSnapPreview = createEdgeSnapPreview();
            detachEdgeSnapPreview.show(snapZone);
          } else if (detachEdgeSnapPreview) {
            detachEdgeSnapPreview.hide();
          }
        }

        if (!detachTransition.active) {
          const prevPointerEvents = ctx.detachedPanel.style.pointerEvents;
          ctx.detachedPanel.style.pointerEvents = 'none';
          const wasAttached = hoverPreview.previewTabList != null;
          const didAttach = attachToHoveredTabListFromAttachedDrag(clientX, clientY);
          ctx.detachedPanel.style.pointerEvents = prevPointerEvents;

          if (didAttach && !wasAttached) {
            enterHoverAttach(clientX, clientY);
          } else if (!didAttach && wasAttached) {
            leaveHoverAttach(clientX, clientY);
          }
        }
      },
      exit() {}
    },

    [DragPhase.hoverAttaching]: {
      enter() {},
      frame(clientX, clientY) {
        phases[DragPhase.detachedDragging].frame(clientX, clientY);
      },
      exit() {}
    },

    [DragPhase.settling]: {
      enter() {},
      frame() {},
      exit() {}
    }
  };

  const enterHoverAttach = (clientX, clientY) => {
    if (ctx.proxyParked && ctx.dragProxy) {
      unparkProxy(ctx, clientX, clientY);
    }
    ctx.draggedTab.classList.add(dragSourceClassName);
    if (!detachWindowToggle) {
      detachWindowToggle = createDetachedWindowToggle({
        panel: ctx.detachedPanel,
        tabOffsetInPanel: ctx.detachedTabOffsetInPanel,
        frame: ctx.detachedPanelFrame
      });
    }
    detachWindowToggle.collapse();
    if (detachEdgeSnapPreview) {
      detachEdgeSnapPreview.hide();
    }
  };

  const leaveHoverAttach = (clientX, clientY) => {
    ctx.draggedTab.classList.remove(dragSourceClassName);
    fadeOutProxy(ctx, clientX, clientY);
    if (detachWindowToggle) {
      detachWindowToggle.expand();
    }
  };

  const setPhase = (nextPhase) => {
    if (!ctx) return;
    const prev = ctx.phase;
    if (prev === nextPhase) return;
    phases[prev]?.exit?.();
    transitionTo(ctx, nextPhase);
    phases[nextPhase]?.enter?.();
  };

  const activateDrag = () => {
    if (!ctx || ctx.dragStarted) {
      return;
    }

    clearLongPressTimer();

    const wasActive = ctx.draggedTab.classList.contains(activeTabClassName);
    ctx.dragStarted = true;
    ctx.dragMoved = true;

    dragDomAdapter.applyDragStyles(ctx);

    if (ctx.dragProxy) {
      applyProxyDetachedStyle(ctx.dragProxy, { isActive: wasActive });
    }

    if (typeof document !== 'undefined' && document.body) {
      document.body.style.userSelect = 'none';
      document.body.classList.add(bodyDraggingClassName);
    }

    if (ctx.sourceTabCount <= 1) {
      promotePanelToDetached();
      setPhase(DragPhase.detachedDragging);
    } else {
      setPhase(DragPhase.reordering);
    }
  };

  const finishDrag = () => {
    if (!ctx) {
      return;
    }

    if (pendingDetachSpawn) {
      pendingDetachSpawn = false;
      spawnDetachedWindowDuringDrag(ctx.lastClientX, ctx.lastClientY);
    }

    const completedState = { ...ctx };
    setPhase(DragPhase.settling);
    ctx = null;
    hasQueuedPointer = false;
    sourceWindowRemovedDuringDetach = false;
    visualWidth.cancelAll();
    detachTransition.reset();
    clearGlobalListeners();

    if (detachEdgeSnapPreview && !completedState.detachedPanel) {
      detachEdgeSnapPreview.destroy();
      detachEdgeSnapPreview = null;
    }

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

    if (completedState.detachedPanel) {
      if (detachWindowToggle) {
        detachWindowToggle.destroy();
        detachWindowToggle = null;
      }

      const attachTarget = hoverPreview.previewTabList;

      if (attachTarget && hoverPreview.previewTab && completedState.dragProxy) {
        const tab = completedState.draggedTab;
        const proxy = completedState.dragProxy;

        tab.style.visibility = '';
        dragDomAdapter.restoreDraggedTabStyles(completedState);
        hoverPreview.commitDrop({ draggedTab: tab, attachTargetTabList: attachTarget });
        activateDraggedTabInTarget(tab, attachTarget);
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
        activateDraggedTabInTarget(tab, attachTarget);
        removePanel(completedState.detachedPanel);
      } else {
        completedState.draggedTab.style.visibility = '';
        dragDomAdapter.restoreDraggedTabStyles(completedState);
        dragDomAdapter.removeDragProxy(completedState.dragProxy);
      }

      if (!attachTarget && detachEdgeSnapPreview?.activeZone) {
        const zone = detachEdgeSnapPreview.activeZone;
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

      if (detachEdgeSnapPreview) {
        detachEdgeSnapPreview.destroy();
        detachEdgeSnapPreview = null;
      }

      hoverPreview.clear();
      visualWidth.cancelAll();

      if (completedState.dragMoved) {
        signalDragCompleted();
      }
      return;
    }

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
        toRectSnapshot: toRectSnapshot,
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

  const applyDragSample = () => {
    if (!ctx) {
      return;
    }

    if (!hasQueuedPointer && !detachTransition.active) {
      return;
    }

    const clientX = hasQueuedPointer ? queuedClientX : ctx.lastClientX;
    const clientY = hasQueuedPointer ? queuedClientY : ctx.lastClientY;
    ctx.lastClientX = clientX;
    ctx.lastClientY = clientY;

    const prevPhase = ctx.phase;
    phases[ctx.phase]?.frame?.(clientX, clientY);

    if (ctx && ctx.phase !== prevPhase && ctx.phase !== DragPhase.pressed && ctx.phase !== DragPhase.settling) {
      phases[ctx.phase]?.frame?.(clientX, clientY);
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
    if (!ctx || event.pointerId !== ctx.pointerId) {
      return;
    }

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    scheduleDragFrame();
  };

  const onPointerUp = (event) => {
    if (!ctx || event.pointerId !== ctx.pointerId) {
      return;
    }

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    flushDragFrame();
    finishDrag();
  };

  root.addEventListener('pointerdown', (event) => {
    if (ctx) {
      return;
    }

    if ((typeof event.button === 'number' && event.button !== 0) || !isEventTargetElement(event.target)) {
      return;
    }

    if (event.target.closest(tabCloseSelector)) {
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

    const sourcePanel = draggedTab.closest(panelSelector);
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

    ctx = createDragContext({
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

    phases[DragPhase.pressed].enter();

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('selectstart', preventSelectStart);
  });

  return true;
};
