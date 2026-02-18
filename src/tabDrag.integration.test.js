import { describe, expect, it, vi } from 'vitest';
import { shouldCloseSourcePanelAfterTransfer } from './tabDrag';
import { createLayoutPipeline } from './tabDrag/layoutPipeline';
import { createDropResolver } from './tabDrag/dropResolver';
import { createWindowLifecycle } from './tabDrag/windowLifecycle';

const tabWidth = 120;
const tabHeight = 40;

const createTab = (id) => {
  const tab = {
    id,
    left: 0,
    top: 0,
    width: tabWidth,
    height: tabHeight,
    parentNode: null,
    measureCalls: 0,
    animate: vi.fn(),
    getBoundingClientRect: () => {
      tab.measureCalls += 1;

      return {
        left: tab.left,
        top: tab.top,
        width: tab.width,
        height: tab.height
      };
    }
  };

  return tab;
};

const createTabList = (tabIds, { left = 0, top = 0 } = {}) => {
  const addButton = { id: 'add' };
  const tabList = {
    tabs: [],
    left,
    top,
    panel: null,
    isConnected: true,
    querySelector: (selector) => (selector === '.tab--add' ? addButton : null),
    querySelectorAll: (selector) => (selector === '.tab--item' ? tabList.tabs : []),
    getBoundingClientRect: () => ({
      left: tabList.left,
      right: tabList.left + Math.max(tabList.tabs.length, 1) * tabWidth,
      top: tabList.top,
      bottom: tabList.top + tabHeight,
      width: Math.max(tabList.tabs.length, 1) * tabWidth,
      height: tabHeight
    }),
    closest: (selector) => {
      if (selector === '.tab--list') {
        return tabList;
      }

      if (selector === '.browser') {
        return tabList.panel;
      }

      return null;
    },
    removeTab: (tab) => {
      const tabIndex = tabList.tabs.indexOf(tab);
      if (tabIndex === -1) {
        return;
      }

      tabList.tabs.splice(tabIndex, 1);
      tab.parentNode = null;
      tabList.syncLayout();
    },
    syncLayout: () => {
      tabList.tabs.forEach((tab, index) => {
        tab.left = tabList.left + index * tabWidth;
        tab.top = tabList.top;
        tab.parentNode = tabList;
      });
    },
    insertBefore: (tab, beforeNode) => {
      if (tab.parentNode && tab.parentNode !== tabList && typeof tab.parentNode.removeTab === 'function') {
        tab.parentNode.removeTab(tab);
      } else if (tab.parentNode === tabList) {
        tabList.removeTab(tab);
      }

      const targetIndex = beforeNode ? tabList.tabs.indexOf(beforeNode) : tabList.tabs.length;
      const insertionIndex = targetIndex === -1 ? tabList.tabs.length : targetIndex;
      tabList.tabs.splice(insertionIndex, 0, tab);
      tabList.syncLayout();
    }
  };

  tabList.tabs = tabIds.map((id) => createTab(id));
  tabList.syncLayout();

  return tabList;
};

const createPanel = (tabList) => {
  const panel = {
    tabList,
    tabRow: {
      getBoundingClientRect: () => ({
        left: tabList.left,
        right: tabList.left + Math.max(tabList.tabs.length, 1) * tabWidth + 120,
        top: tabList.top,
        bottom: tabList.top + tabHeight,
        width: Math.max(tabList.tabs.length, 1) * tabWidth + 120,
        height: tabHeight
      })
    },
    removed: false,
    querySelector: (selector) => {
      if (selector === '.tab--list') {
        return tabList;
      }

      if (selector === '.tab--row') {
        return panel.tabRow;
      }

      return null;
    },
    getBoundingClientRect: () => ({
      left: tabList.left,
      right: tabList.left + Math.max(tabList.tabs.length, 1) * tabWidth + 120,
      top: tabList.top,
      bottom: tabList.top + tabHeight + 220,
      width: Math.max(tabList.tabs.length, 1) * tabWidth + 120,
      height: tabHeight + 220
    }),
    remove: () => {
      panel.removed = true;
      tabList.isConnected = false;
    }
  };

  tabList.panel = panel;

  return panel;
};

const createLayoutPipelineHarness = () =>
  createLayoutPipeline({
    getTabs: (tabList) => tabList.tabs.slice(),
    getInsertionIndexFromCenters: ({ centers, pointerClientX }) => {
      for (let index = 0; index < centers.length; index += 1) {
        if (pointerClientX < centers[index]) {
          return index;
        }
      }

      return centers.length;
    },
    moveTabToList: ({ tab, tabList, beforeNode }) => {
      tabList.insertBefore(tab, beforeNode ?? null);
    },
    tabAddSelector: '.tab--add'
  });

describe('tab drag integration flows', () => {
  it('creates detached window on drop outside tab lists and closes empty source window', () => {
    const sourceTabList = createTabList(['tab-a']);
    const sourcePanel = createPanel(sourceTabList);
    const detachedTabList = createTabList([]);
    const detachedPanel = createPanel(detachedTabList);
    const initializePanelInteraction = vi.fn();
    const initializeTabList = vi.fn();
    const animateDetachedWindowEnter = vi.fn();
    const removePanel = vi.fn((panel) => {
      panel.remove();
      return true;
    });
    const createDetachedWindow = vi.fn(({ draggedTab }) => {
      detachedTabList.insertBefore(draggedTab, null);

      return {
        panel: detachedPanel,
        tabList: detachedTabList,
        frame: {
          left: 400,
          top: 240,
          width: 320,
          height: 200
        }
      };
    });

    const lifecycle = createWindowLifecycle({
      getTabs: (tabList) => tabList.tabs.slice(),
      createDetachedWindow,
      removeDetachedWindowIfEmpty: () => false,
      removePanel,
      shouldCloseSourcePanelAfterTransfer,
      initializePanelInteraction,
      initializeTabList,
      animateDetachedWindowEnter
    });

    const sourceTabRect = {
      left: 24,
      top: 20,
      width: tabWidth,
      height: tabHeight
    };
    const detachedWindow = lifecycle.createDetachedWindowFromDrop({
      sourcePanel,
      sourceTabList,
      draggedTab: sourceTabList.tabs[0],
      pointerClientX: 500,
      pointerClientY: 320,
      sourceTabRect
    });

    expect(detachedWindow).toBeTruthy();
    expect(createDetachedWindow).toHaveBeenCalledOnce();
    expect(initializePanelInteraction).toHaveBeenCalledWith(detachedPanel);
    expect(initializeTabList).toHaveBeenCalledWith(detachedTabList);
    expect(animateDetachedWindowEnter).toHaveBeenCalledWith({
      panel: detachedPanel,
      tabRect: sourceTabRect,
      frame: detachedWindow.frame
    });
    expect(removePanel).toHaveBeenCalledWith(sourcePanel);
    expect(sourcePanel.removed).toBe(true);
    expect(detachedTabList.tabs).toHaveLength(1);
  });

  it('attaches detached tab to a target window on hover and removes empty detached window', () => {
    const detachedTabList = createTabList(['tab-a'], { left: 40, top: 20 });
    const targetTabList = createTabList(['tab-b', 'tab-c'], { left: 400, top: 20 });
    const detachedPanel = createPanel(detachedTabList);
    const dropResolver = createDropResolver({
      tabListSelector: '.tab--list',
      defaultAttachPaddingPx: 16
    });
    const layoutPipeline = createLayoutPipelineHarness();
    const documentRef = {
      querySelectorAll: () => [detachedTabList, targetTabList],
      elementsFromPoint: () => [targetTabList]
    };
    const lifecycle = createWindowLifecycle({
      getTabs: (tabList) => tabList.tabs.slice(),
      createDetachedWindow: () => null,
      removeDetachedWindowIfEmpty: (panel) => {
        if (panel.querySelector('.tab--list').tabs.length > 0) {
          return false;
        }

        panel.remove();
        return true;
      },
      removePanel: () => true,
      shouldCloseSourcePanelAfterTransfer,
      initializePanelInteraction: () => {},
      initializeTabList: () => {},
      animateDetachedWindowEnter: () => {}
    });

    const attachTarget = dropResolver.resolveAttachTargetTabList({
      clientX: 460,
      clientY: 30,
      excludedTabList: detachedTabList,
      documentRef
    });
    layoutPipeline.beginFrame();
    layoutPipeline.moveTabToPointerPosition({
      tabList: attachTarget,
      draggedTab: detachedTabList.tabs[0],
      pointerClientX: 460
    });
    const removed = lifecycle.maybeRemoveDetachedPanel(detachedPanel);

    expect(attachTarget).toBe(targetTabList);
    expect(removed).toBe(true);
    expect(detachedPanel.removed).toBe(true);
    expect(targetTabList.tabs.map((tab) => tab.id)).toContain('tab-a');
    expect(detachedTabList.tabs).toHaveLength(0);
  });

  it('resolves attach target from panel hover region', () => {
    const sourceTabList = createTabList(['tab-a'], { left: 40, top: 20 });
    const targetTabList = createTabList(['tab-b', 'tab-c'], { left: 400, top: 20 });
    const targetPanel = createPanel(targetTabList);
    createPanel(sourceTabList);
    const panelHoverElement = {
      closest: (selector) => (selector === '.browser' ? targetPanel : null)
    };
    const dropResolver = createDropResolver({
      tabListSelector: '.tab--list',
      defaultAttachPaddingPx: 16
    });
    const documentRef = {
      querySelectorAll: () => [sourceTabList, targetTabList],
      elementsFromPoint: () => [panelHoverElement]
    };

    const attachTarget = dropResolver.resolveAttachTargetTabList({
      clientX: 520,
      clientY: 30,
      excludedTabList: sourceTabList,
      documentRef
    });

    expect(attachTarget).toBe(targetTabList);
  });

  it('does not resolve attach target from panel body', () => {
    const sourceTabList = createTabList(['tab-a'], { left: 40, top: 20 });
    const targetTabList = createTabList(['tab-b', 'tab-c'], { left: 400, top: 20 });
    const targetPanel = createPanel(targetTabList);
    createPanel(sourceTabList);
    const documentRef = {
      querySelectorAll: () => [sourceTabList, targetTabList],
      elementsFromPoint: () => []
    };
    const dropResolver = createDropResolver({
      tabListSelector: '.tab--list',
      defaultAttachPaddingPx: 16
    });

    const attachTarget = dropResolver.resolveAttachTargetTabList({
      clientX: targetPanel.getBoundingClientRect().left + 24,
      clientY: targetPanel.getBoundingClientRect().top + tabHeight + 80,
      excludedTabList: sourceTabList,
      documentRef
    });

    expect(attachTarget).toBeNull();
  });

  it('closes source window when the last tab leaves', () => {
    const sourceTabList = createTabList([]);
    const sourcePanel = createPanel(sourceTabList);
    const removePanel = vi.fn((panel) => {
      panel.remove();
      return true;
    });
    const lifecycle = createWindowLifecycle({
      getTabs: (tabList) => tabList.tabs.slice(),
      createDetachedWindow: () => null,
      removeDetachedWindowIfEmpty: () => false,
      removePanel,
      shouldCloseSourcePanelAfterTransfer,
      initializePanelInteraction: () => {},
      initializeTabList: () => {},
      animateDetachedWindowEnter: () => {}
    });

    const didClose = lifecycle.closeSourcePanelIfEmpty({
      sourcePanel,
      sourceTabList
    });

    expect(didClose).toBe(true);
    expect(removePanel).toHaveBeenCalledWith(sourcePanel);
    expect(sourcePanel.removed).toBe(true);
  });

  it('keeps source window when tabs remain after transfer', () => {
    const sourceTabList = createTabList(['tab-a']);
    const sourcePanel = createPanel(sourceTabList);
    const removePanel = vi.fn(() => true);
    const lifecycle = createWindowLifecycle({
      getTabs: (tabList) => tabList.tabs.slice(),
      createDetachedWindow: () => null,
      removeDetachedWindowIfEmpty: () => false,
      removePanel,
      shouldCloseSourcePanelAfterTransfer,
      initializePanelInteraction: () => {},
      initializeTabList: () => {},
      animateDetachedWindowEnter: () => {}
    });

    const didClose = lifecycle.closeSourcePanelIfEmpty({
      sourcePanel,
      sourceTabList
    });

    expect(didClose).toBe(false);
    expect(removePanel).not.toHaveBeenCalled();
    expect(sourcePanel.removed).toBe(false);
  });

  it('reorders tabs and yields sibling displacement for hover space-making', () => {
    const tabList = createTabList(['tab-a', 'tab-b', 'tab-c']);
    const layoutPipeline = createLayoutPipelineHarness();
    const draggedTab = tabList.tabs[0];

    layoutPipeline.beginFrame();
    const result = layoutPipeline.moveTabToPointerPosition({
      tabList,
      draggedTab,
      pointerClientX: 1000
    });

    expect(result.moved).toBe(true);
    expect(result.displacements.length).toBeGreaterThan(0);
    expect(tabList.tabs.map((tab) => tab.id)).toEqual(['tab-b', 'tab-c', 'tab-a']);
  });

  it('batches geometry reads per move cycle for stable performance', () => {
    const tabList = createTabList(['tab-a', 'tab-b', 'tab-c', 'tab-d']);
    const layoutPipeline = createLayoutPipelineHarness();
    const draggedTab = tabList.tabs[0];

    layoutPipeline.beginFrame();
    layoutPipeline.moveTabToPointerPosition({
      tabList,
      draggedTab,
      pointerClientX: 1200
    });

    const maxMeasureCalls = Math.max(...tabList.tabs.map((tab) => tab.measureCalls));
    expect(maxMeasureCalls).toBeLessThanOrEqual(2);
  });
});
