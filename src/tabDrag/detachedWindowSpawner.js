import { toRectSnapshot, onAnimationSettled } from '../shared/dom';
import { panelSelector } from '../shared/selectors';
import { activeTabClassName } from '../tabs/tabState';
import { getTabs, setActiveTab } from '../tabs/tabs';
import {
  animateDetachedWindowFromTab,
  animatedRemovePanel,
  createDetachedWindow
} from '../window/windowManager';
import {
  shouldRemoveSourceWindowOnDetach,
  resolveSourceActivationIndexAfterDetach
} from './dragCalculations';
import {
  clearDragInlineStyles,
  applyProxyAttachedStyle,
  animateProxyActivation,
  cancelProxySubAnimations
} from './styleHelpers';
import {
  dragClassName,
  activeDragClassName,
  inactiveDragClassName,
  dragSourceClassName,
  noTransitionClassName
} from './dragClassNames';

export const captureSourceActivation = (draggedTab, sourceTabList) => {
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

export const spawnDetachedWindow = (ctx, deps) => {
  if (!ctx || ctx.detachedPanel) return;

  const { scaleDurationMs, initializePanelInteraction, initializeTabList,
    dragDomAdapter, hoverPreview, placeholderManager, visualWidth,
    fadeOutProxy, getCtx } = deps;

  const sourceTabList = ctx.currentTabList;
  const sourcePanel =
    sourceTabList && typeof sourceTabList.closest === 'function'
      ? sourceTabList.closest(panelSelector)
      : null;
  if (!sourcePanel) return;

  const isLastTab = shouldRemoveSourceWindowOnDetach(ctx.sourceTabCount);

  const tabScreenRect = toRectSnapshot(
    (ctx.dragProxy ?? ctx.draggedTab).getBoundingClientRect()
  );
  const activateInSource = captureSourceActivation(ctx.draggedTab, sourceTabList);

  const detachedWindow = createDetachedWindow({
    sourcePanel,
    sourceTabList,
    tabScreenRect
  });

  if (!detachedWindow) return;

  initializePanelInteraction(detachedWindow.panel);
  initializeTabList(detachedWindow.tabList);

  const tab = ctx.draggedTab;
  const proxy = ctx.dragProxy;
  let scaleInCompleted = false;

  const onScaleInComplete = () => {
    scaleInCompleted = true;
    clearTimeout(scaleInFallbackId);

    const liveCtx = getCtx();
    if (!liveCtx || liveCtx.dragProxy !== proxy) {
      tab.style.visibility = '';
      dragDomAdapter.removeDragProxy(proxy);
      return;
    }
    if (liveCtx.proxyParked || hoverPreview.previewTabList != null) {
      return;
    }

    const wasInactive = proxy.classList.contains(inactiveDragClassName);
    cancelProxySubAnimations(proxy);
    const activationAnim = wasInactive ? animateProxyActivation(proxy) : null;
    applyProxyAttachedStyle(proxy, { isActive: true });

    const swapAndPark = () => {
      const currentCtx = getCtx();
      tab.style.visibility = '';
      if (!currentCtx || currentCtx.dragProxy !== proxy) {
        dragDomAdapter.removeDragProxy(proxy);
        return;
      }
      if (currentCtx.proxyParked || hoverPreview.previewTabList != null) {
        return;
      }
      fadeOutProxy(currentCtx, currentCtx.lastClientX, currentCtx.lastClientY);
    };

    const morphAnim = activationAnim
      ?? proxy.querySelector('.tab--background')?.getAnimations?.()[0]
      ?? null;
    if (morphAnim) {
      onAnimationSettled(morphAnim, swapAndPark);
    } else {
      swapAndPark();
    }
  };

  const scaleInFallbackId = setTimeout(() => {
    if (!scaleInCompleted) onScaleInComplete();
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
      ctx.sourceWindowRemovedDuringDetach = true;
    }
  }
};

export const promotePanelToDetached = (ctx, deps) => {
  if (!ctx || ctx.detachedPanel) return;

  const { hoverPreview, visualWidth, parkProxy } = deps;

  const panel = ctx.currentTabList?.closest?.(panelSelector);
  if (!panel) return;

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
