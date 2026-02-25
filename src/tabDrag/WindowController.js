import { toRectSnapshot } from '../shared/dom';
import {
  createDetachedWindow,
  animateDetachedWindowFromTab,
  animateDetachedWindowScaleIn,
  createDetachedWindowToggle,
  applyPanelFrame,
  moveTabToList,
  removePanel,
  animatedRemovePanel
} from '../window/windowManager';
import { bringToFront } from '../window/windowFocus';
import { setActiveTab } from '../tabs/tabs';

export const createWindowController = () => {
  let panel = null;
  let tabList = null;
  let frame = null;
  let tabOffsetInPanel = null;
  let pointerOffset = null;
  let toggle = null;
  let scaleInComplete = false;
  let onScaleInComplete = null;

  const spawn = ({
    sourcePanel,
    sourceTabList,
    tabScreenRect,
    sourcePanelRect,
    draggedTab,
    proxy,
    placeholderManager,
    initializePanelInteraction,
    initializeTabList: initTabList,
    onTabInserted,
    onComplete
  }) => {
    const win = createDetachedWindow({
      sourcePanel,
      sourceTabList,
      tabScreenRect,
      sourcePanelRect
    });

    if (!win) return false;

    initializePanelInteraction(win.panel);
    initTabList(win.tabList);

    panel = win.panel;
    tabList = win.tabList;
    frame = { ...win.frame };
    tabOffsetInPanel = { ...win.tabOffsetInPanel };
    scaleInComplete = false;

    animateDetachedWindowFromTab({
      ...win,
      draggedTab,
      tabScreenRect,
      onTabInserted,
      onComplete: () => {
        scaleInComplete = true;
        onComplete?.();
        onScaleInComplete?.();
        onScaleInComplete = null;
      }
    });

    return true;
  };

  const promote = (existingPanel, existingTabList, draggedTab, pointerX, pointerY) => {
    const panelRect = existingPanel.getBoundingClientRect();
    const tabRect = draggedTab.getBoundingClientRect();

    panel = existingPanel;
    tabList = existingTabList;
    frame = {
      width: panelRect.width,
      height: panelRect.height,
      left: panelRect.left,
      top: panelRect.top
    };
    tabOffsetInPanel = {
      x: tabRect.left - panelRect.left,
      y: tabRect.top - panelRect.top
    };
    pointerOffset = {
      x: pointerX - panelRect.left,
      y: pointerY - panelRect.top
    };
    scaleInComplete = true;
  };

  const destroy = () => {
    if (toggle) {
      toggle.destroy();
      toggle = null;
    }
    if (panel) {
      removePanel(panel);
      panel = null;
    }
    tabList = null;
    frame = null;
    tabOffsetInPanel = null;
    pointerOffset = null;
    scaleInComplete = false;
    onScaleInComplete = null;
  };

  const animatedDestroy = () => {
    if (toggle) {
      toggle.destroy();
      toggle = null;
    }
    if (panel) {
      animatedRemovePanel(panel);
      panel = null;
    }
    tabList = null;
    frame = null;
    tabOffsetInPanel = null;
    pointerOffset = null;
    scaleInComplete = false;
    onScaleInComplete = null;
  };

  const detachPanel = () => {
    const p = panel;
    if (toggle) {
      toggle.destroy();
      toggle = null;
    }
    panel = null;
    tabList = null;
    frame = null;
    tabOffsetInPanel = null;
    pointerOffset = null;
    scaleInComplete = false;
    onScaleInComplete = null;
    return p;
  };

  const collapse = () => {
    if (!panel || !tabOffsetInPanel || !frame) return;
    if (!toggle) {
      toggle = createDetachedWindowToggle({ panel, tabOffsetInPanel, frame });
    }
    toggle.collapse();
  };

  const expand = () => {
    if (!toggle) return;
    toggle.expand();
  };

  const syncToProxy = (proxyRect) => {
    if (!panel || !tabOffsetInPanel || !frame) return;
    frame.left = proxyRect.left - tabOffsetInPanel.x;
    frame.top = proxyRect.top - tabOffsetInPanel.y;
    applyPanelFrame(panel, frame);
  };

  const syncToPointer = (clientX, clientY) => {
    if (!panel || !pointerOffset || !frame) return;
    frame.left = clientX - pointerOffset.x;
    frame.top = clientY - pointerOffset.y;
    applyPanelFrame(panel, frame);
  };

  const setPointerOffset = (clientX, clientY) => {
    if (!frame) return;
    pointerOffset = {
      x: clientX - frame.left,
      y: clientY - frame.top
    };
  };

  const bringPanelToFront = () => {
    if (panel) bringToFront(panel);
  };

  return {
    get panel() { return panel; },
    get tabList() { return tabList; },
    get frame() { return frame; },
    get tabOffsetInPanel() { return tabOffsetInPanel; },
    get pointerOffset() { return pointerOffset; },
    get collapsed() { return toggle?.isCollapsed?.() ?? false; },
    get scaleInComplete() { return scaleInComplete; },
    set onScaleInComplete(fn) { onScaleInComplete = fn; },

    spawn,
    promote,
    destroy,
    animatedDestroy,
    detachPanel,
    collapse,
    expand,
    syncToProxy,
    syncToPointer,
    setPointerOffset,
    bringPanelToFront
  };
};
