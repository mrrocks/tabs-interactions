import { toRectSnapshot } from '../shared/dom';
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

  const swapAndPark = () => {
    scaleInCompleted = true;
    clearTimeout(scaleInFallbackId);

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

  const scaleInFallbackId = setTimeout(() => {
    if (!scaleInCompleted) swapAndPark();
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
    onComplete: swapAndPark
  });

  if (proxy) {
    const wasInactive = proxy.classList.contains(inactiveDragClassName);
    cancelProxySubAnimations(proxy);
    if (wasInactive) animateProxyActivation(proxy);
    applyProxyAttachedStyle(proxy, { isActive: true });
  }

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
