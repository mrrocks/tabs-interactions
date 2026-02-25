import { isEventTargetElement, toRectSnapshot } from '../shared/dom';
import { createPointerFrameLoop } from '../shared/pointerFrameLoop';
import { scaleDurationMs } from '../motion/motionSpeed';
import { panelSelector, tabAddSelector, tabCloseSelector } from '../shared/selectors';
import { activeTabClassName } from '../tabs/tabState';
import { getTabs, setActiveTab, tabListSelector, tabSelector } from '../tabs/tabs';
import {
  createDetachedWindowToggle,
  animatedRemovePanel,
  applyPanelFrame,
  moveTabToList,
  panelScaleTransitionMs
} from '../window/windowManager';
import { bringToFront, getOverlayZIndex } from '../window/windowFocus';
import { DragPhase, createDragContext, transitionTo } from './DragContext';
import { createLayoutPipeline } from './layoutPipeline';
import { createDropResolver, isPointInsideRect } from './dropResolver';
import { createAnimationCoordinator } from './animationCoordinator';
import { createDragDomAdapter } from './dragDomAdapter';
import { clearDragCompleted } from '../tabs/tabDragSignal';
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
  resolveDragVisualOffsetX,
  resolveDragVisualOffsetY,
  shouldRemoveSourceWindowOnDetach
} from './dragCalculations';
import { createHoverPreviewManager } from './hoverPreviewManager';
import { createDetachPlaceholderManager } from './detachPlaceholder';
import { createDragVisualWidthManager } from './dragVisualWidth';
import { createDetachTransitionManager } from './detachTransition';
import { dragTransitionDurationMs, dragTransitionEasing } from './dragAnimationConfig';
import {
  animateFlexWidthTransition,
  clearDragInlineStyles,
  applyProxyDetachedStyle,
  applyProxyAttachedStyle
} from './styleHelpers';
import { isPinned, pinnedClassName } from '../tabs/tabPinning';
import { spawnDetachedWindow, promotePanelToDetached } from './detachedWindowSpawner';
import { settleDetachedDrag, settleAttachedDrag } from './dragCompletion';
import {
  resolveEdgeSnapZone,
  createEdgeSnapPreview
} from '../panel/panelEdgeSnap';
import {
  dragSourceClassName,
  dragHoverPreviewClassName,
  bodyDraggingClassName
} from './dragClassNames';

const initializedRoots = new WeakSet();

const getDetachReferenceRect = (tabList) => {
  const panel = tabList?.closest?.(panelSelector);
  if (!panel) return null;
  const tabRow = panel.querySelector?.('.tab--row');
  const baseRect = (tabRow ?? tabList)?.getBoundingClientRect?.();
  if (!baseRect) return null;
  const paddingTop = parseFloat(globalThis.getComputedStyle?.(panel)?.paddingTop) || 0;
  return { left: baseRect.left, right: baseRect.right, top: baseRect.top - paddingTop, bottom: baseRect.bottom };
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

  const dragDomAdapter = createDragDomAdapter();
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
  let longPressTimerId = 0;

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

  const commitDropAttach = ({ draggedTab, attachTargetTabList, pointerClientX }) => {
    placeholderManager.restoreDisplay(draggedTab);

    const didCommitPreviewDrop = hoverPreview.commitDrop({
      draggedTab,
      attachTargetTabList
    });

    const flexResult = didCommitPreviewDrop
      ? animateFlexWidthTransition(draggedTab, {
        durationMs: scaleDurationMs(dragTransitionDurationMs),
        easing: dragTransitionEasing
      })
      : null;

    if (!didCommitPreviewDrop) {
      moveTabWithLayoutPipeline({
        tabList: attachTargetTabList,
        draggedTab,
        pointerClientX
      });
    }

    activateDraggedTabInTarget(draggedTab, attachTargetTabList);
    return flexResult ?? { toWidth: 0, settledRect: null };
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

  const spawnerDeps = {
    scaleDurationMs,
    initializePanelInteraction,
    initializeTabList,
    dragDomAdapter,
    hoverPreview,
    placeholderManager,
    visualWidth,
    parkProxyWithOffset,
    parkProxy,
    getCtx: () => ctx
  };

  const syncEdgeSnapPreview = (clientX) => {
    const snapZone = resolveEdgeSnapZone(clientX, window.innerWidth);
    if (snapZone) {
      if (!ctx.detachEdgeSnapPreview) ctx.detachEdgeSnapPreview = createEdgeSnapPreview();
      ctx.detachEdgeSnapPreview.show(snapZone);
    } else if (ctx.detachEdgeSnapPreview) {
      ctx.detachEdgeSnapPreview.hide();
    }
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

    syncEdgeSnapPreview(clientX);
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

      const reclaimed = visualWidth.reclaimOutgoing(attachTarget);
      if (reclaimed) {
        hoverPreview.restore(reclaimed.previewTab, attachTarget);
        moveTabWithLayoutPipeline({
          tabList: attachTarget,
          draggedTab: reclaimed.previewTab,
          pointerClientX: clientX
        });
        const { displacements } = visualWidth.animateIn(ctx, reclaimed.previewTab, { fromWidthPx: reclaimed.currentWidthPx });
        if (displacements.length > 0) {
          animationCoordinator.animateSiblingDisplacement(displacements);
        }
      } else {
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
        ctx.pendingDetachSpawn = true;
      },
      frame(clientX, clientY) {
        const deltaX = clientX - ctx.startX;
        const deltaY = clientY - ctx.startY;

        const { overshootX, overshootY } = computeDetachState(clientX, clientY);

        if (ctx.pendingDetachSpawn && !detachTransition.active) {
          ctx.pendingDetachSpawn = false;
          spawnDetachedWindow(ctx, spawnerDeps);
          if (ctx.detachedPanel) {
            setPhase(DragPhase.detachedDragging);
            return;
          }
        }

        if (ctx.dragProxy) {
          const isLastTab = shouldRemoveSourceWindowOnDetach(ctx.sourceTabCount);

          if (isLastTab && !ctx.sourceWindowRemovedDuringDetach) {
            const sourcePanel =
              ctx.currentTabList && typeof ctx.currentTabList.closest === 'function'
                ? ctx.currentTabList.closest(panelSelector)
                : null;
            if (sourcePanel) {
              ctx.sourcePanelRect = toRectSnapshot(sourcePanel.getBoundingClientRect());
              if (animatedRemovePanel(sourcePanel)) {
                ctx.sourceWindowRemovedDuringDetach = true;
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

          syncEdgeSnapPreview(clientX);
        }

        if (!detachTransition.active) {
          const prevPointerEvents = ctx.detachedPanel.style.pointerEvents;
          ctx.detachedPanel.style.pointerEvents = 'none';
          const hasActivePreview = hoverPreview.previewTabList != null;
          const hasReclaimablePreview = visualWidth.outgoingPreviewTab != null;
          const hadHoverPresence = hasActivePreview || hasReclaimablePreview;

          const shouldUnpark = !hadHoverPresence && ctx.proxyParked && ctx.dragProxy;
          if (shouldUnpark) {
            unparkProxy(ctx, clientX, clientY);
          }

          const didAttach = attachToHoveredTabListFromAttachedDrag(clientX, clientY);
          ctx.detachedPanel.style.pointerEvents = prevPointerEvents;

          const stillReclaimable = visualWidth.outgoingPreviewTab != null;
          const hoverPresenceLost = hadHoverPresence && !didAttach && !stillReclaimable && hoverPreview.previewTabList == null;

          if (didAttach && !hadHoverPresence) {
            enterHoverAttach(clientX, clientY);
          } else if (didAttach && hasReclaimablePreview && !hasActivePreview) {
            if (ctx.detachWindowToggle) {
              ctx.detachWindowToggle.collapse();
            }
            if (ctx.dragProxy) {
              const d = scaleDurationMs(panelScaleTransitionMs);
              applyProxyDetachedStyle(ctx.dragProxy, { isActive: true, durationMs: d, cancelExisting: true });
            }
          } else if (!didAttach && hasActivePreview && stillReclaimable) {
            if (ctx.detachWindowToggle) {
              ctx.detachWindowToggle.expand();
            }
            if (ctx.dragProxy) {
              const d = scaleDurationMs(panelScaleTransitionMs);
              applyProxyAttachedStyle(ctx.dragProxy, { isActive: true, durationMs: d, cancelExisting: true });
            }
            ctx.draggedTab.classList.remove(dragSourceClassName);
          } else if (hoverPresenceLost) {
            leaveHoverAttach(clientX, clientY);
          } else if (shouldUnpark && !didAttach) {
            parkProxy(ctx);
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
    ctx.draggedTab.classList.add(dragSourceClassName);
    if (!ctx.detachWindowToggle) {
      ctx.detachWindowToggle = createDetachedWindowToggle({
        panel: ctx.detachedPanel,
        tabOffsetInPanel: ctx.detachedTabOffsetInPanel,
        frame: ctx.detachedPanelFrame
      });
    }
    ctx.detachWindowToggle.collapse();
    if (ctx.dragProxy) {
      const d = scaleDurationMs(panelScaleTransitionMs);
      applyProxyDetachedStyle(ctx.dragProxy, { isActive: true, durationMs: d, cancelExisting: true });
    }
    if (ctx.detachEdgeSnapPreview) {
      ctx.detachEdgeSnapPreview.hide();
    }
  };

  const leaveHoverAttach = (clientX, clientY) => {
    ctx.draggedTab.classList.remove(dragSourceClassName);
    fadeOutProxy(ctx, clientX, clientY);
    if (ctx.detachWindowToggle) {
      ctx.detachWindowToggle.expand();
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
      promotePanelToDetached(ctx, spawnerDeps);
      setPhase(DragPhase.detachedDragging);
    } else {
      setPhase(DragPhase.reordering);
    }
  };

  const completeDrag = () => {
    if (!ctx) {
      return;
    }

    if (ctx.pendingDetachSpawn) {
      ctx.pendingDetachSpawn = false;
      spawnDetachedWindow(ctx, spawnerDeps);
    }

    const completedState = { ...ctx };
    setPhase(DragPhase.settling);
    ctx = null;
    pointerLoop.reset();
    detachTransition.reset();
    clearGlobalListeners();

    if (completedState.detachEdgeSnapPreview && !completedState.detachedPanel) {
      completedState.detachEdgeSnapPreview.destroy();
      completedState.detachEdgeSnapPreview = null;
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

    const completionDeps = {
      dragDomAdapter,
      hoverPreview,
      animationCoordinator,
      dropResolver,
      visualWidth,
      placeholderManager,
      activateDraggedTabInTarget,
      commitDropAttach,
      isPointerInsideCurrentHeader
    };

    if (completedState.detachedPanel) {
      settleDetachedDrag(completedState, completionDeps);
    } else {
      settleAttachedDrag(completedState, completionDeps);
    }
  };

  let deferredCompletion = false;

  const finishDrag = () => {
    if (!ctx) {
      return;
    }

    if (ctx.pendingDetachSpawn && detachTransition.active) {
      deferredCompletion = true;
      clearGlobalListeners();
      pointerLoop.schedule();
      return;
    }

    completeDrag();
  };

  const pointerLoop = createPointerFrameLoop({
    onSample(clientX, clientY) {
      if (!ctx) return;
      if (!pointerLoop.hasQueued && !detachTransition.active) return;

      const cx = pointerLoop.hasQueued ? clientX : ctx.lastClientX;
      const cy = pointerLoop.hasQueued ? clientY : ctx.lastClientY;
      ctx.lastClientX = cx;
      ctx.lastClientY = cy;

      const prevPhase = ctx.phase;
      phases[ctx.phase]?.frame?.(cx, cy);

      if (ctx && ctx.phase !== prevPhase && ctx.phase !== DragPhase.pressed && ctx.phase !== DragPhase.settling) {
        phases[ctx.phase]?.frame?.(cx, cy);
      }

      if (deferredCompletion && !detachTransition.active) {
        deferredCompletion = false;
        completeDrag();
        return;
      }

      if (detachTransition.active) {
        pointerLoop.schedule();
      }
    }
  });

  const onPointerMove = (event) => {
    if (!ctx || event.pointerId !== ctx.pointerId) return;
    pointerLoop.queue(event.clientX, event.clientY);
    pointerLoop.schedule();
  };

  const onPointerUp = (event) => {
    if (!ctx || event.pointerId !== ctx.pointerId) return;
    pointerLoop.queue(event.clientX, event.clientY);
    pointerLoop.flush();
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

    pointerLoop.queue(event.clientX, event.clientY);
    visualWidth.cancelAll();

    phases[DragPhase.pressed].enter();

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('selectstart', preventSelectStart);
  });

  return true;
};
