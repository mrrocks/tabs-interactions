import { describe, expect, it, vi } from 'vitest';
import { shouldCloseSourcePanelAfterTransfer } from './dragCalculations';
import { initializeTabDrag } from './tabDrag';
import { createLayoutPipeline } from './layoutPipeline';
import { createDropResolver } from './dropResolver';

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

let panelZCounter = 0;

const createPanel = (tabList) => {
  panelZCounter += 1;
  const panel = {
    tabList,
    style: { zIndex: String(panelZCounter) },
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
  it('resolves attach target from panel hover region', () => {
    const sourceTabList = createTabList(['tab-a'], { left: 40, top: 20 });
    const targetTabList = createTabList(['tab-b', 'tab-c'], { left: 400, top: 20 });
    const sourcePanel = createPanel(sourceTabList);
    const targetPanel = createPanel(targetTabList);
    const panelHoverElement = {
      closest: (selector) => (selector === '.browser' ? targetPanel : null)
    };
    const dropResolver = createDropResolver({
      tabListSelector: '.tab--list',
      defaultAttachPaddingPx: 16
    });
    const documentRef = {
      querySelectorAll: (selector) =>
        selector === '.browser' ? [sourcePanel, targetPanel] : [sourceTabList, targetTabList],
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

  it('does not resolve attach target when pointer is occluded by higher panel', () => {
    const targetTabList = createTabList(['tab-c'], { left: 80, top: 20 });
    const sourceTabList = createTabList(['tab-a', 'tab-b'], { left: 40, top: 20 });
    const targetPanel = createPanel(targetTabList);
    const sourcePanel = createPanel(sourceTabList);
    const sourcePanelHit = {
      closest: (selector) => {
        if (selector === '.browser') return sourcePanel;
        return null;
      }
    };
    const dropResolver = createDropResolver({
      tabListSelector: '.tab--list',
      defaultAttachPaddingPx: 16
    });
    const documentRef = {
      querySelectorAll: (selector) =>
        selector === '.browser' ? [targetPanel, sourcePanel] : [sourceTabList, targetTabList],
      elementsFromPoint: () => [sourcePanelHit]
    };

    const attachTarget = dropResolver.resolveAttachTargetTabList({
      clientX: 100,
      clientY: 30,
      excludedTabList: sourceTabList,
      documentRef
    });

    expect(attachTarget).toBeNull();
  });

  it('resolves foreground panel tab list when panels overlap during detached drag', () => {
    const backgroundTabList = createTabList(['tab-x'], { left: 100, top: 20 });
    const foregroundTabList = createTabList(['tab-a', 'tab-b'], { left: 60, top: 20 });
    const backgroundPanel = createPanel(backgroundTabList);
    const foregroundPanel = createPanel(foregroundTabList);
    const foregroundPanelHit = {
      closest: (selector) => {
        if (selector === '.browser') return foregroundPanel;
        return null;
      }
    };
    const dropResolver = createDropResolver({
      tabListSelector: '.tab--list',
      defaultAttachPaddingPx: 16
    });
    const documentRef = {
      querySelectorAll: (selector) =>
        selector === '.browser'
          ? [backgroundPanel, foregroundPanel]
          : [backgroundTabList, foregroundTabList],
      elementsFromPoint: () => [foregroundPanelHit]
    };

    const attachTarget = dropResolver.resolveAttachTargetTabList({
      clientX: 140,
      clientY: 30,
      excludedTabList: null,
      documentRef
    });

    expect(attachTarget).toBe(foregroundTabList);
  });

  it('blocks background window when foreground panel occludes during detached drag', () => {
    const backgroundTabList = createTabList(['tab-x'], { left: 100, top: 20 });
    const foregroundTabList = createTabList(['tab-a', 'tab-b'], { left: 60, top: 20 });
    const backgroundPanel = createPanel(backgroundTabList);
    const foregroundPanel = createPanel(foregroundTabList);
    const foregroundPanelHit = {
      closest: (selector) => {
        if (selector === '.browser') return foregroundPanel;
        return null;
      }
    };
    const dropResolver = createDropResolver({
      tabListSelector: '.tab--list',
      defaultAttachPaddingPx: 16
    });
    const documentRef = {
      querySelectorAll: (selector) =>
        selector === '.browser'
          ? [backgroundPanel, foregroundPanel]
          : [backgroundTabList, foregroundTabList],
      elementsFromPoint: () => [foregroundPanelHit]
    };

    const attachTarget = dropResolver.resolveAttachTargetTabList({
      clientX: 140,
      clientY: 30,
      excludedTabList: foregroundTabList,
      documentRef
    });

    expect(attachTarget).toBeNull();
  });

  it('does not resolve attach target from panel body', () => {
    const sourceTabList = createTabList(['tab-a'], { left: 40, top: 20 });
    const targetTabList = createTabList(['tab-b', 'tab-c'], { left: 400, top: 20 });
    const sourcePanel = createPanel(sourceTabList);
    const targetPanel = createPanel(targetTabList);
    const documentRef = {
      querySelectorAll: (selector) =>
        selector === '.browser' ? [sourcePanel, targetPanel] : [sourceTabList, targetTabList],
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

  it('keeps cross-window hover as preview until pointer release', () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;

    const createClassList = (initialNames = []) => {
      const names = new Set(initialNames);
      return {
        add: (...classNames) => {
          classNames.forEach((name) => names.add(name));
        },
        remove: (...classNames) => {
          classNames.forEach((name) => names.delete(name));
        },
        contains: (className) => names.has(className),
        toggle: (className, force) => {
          if (force === true) {
            names.add(className);
            return true;
          }
          if (force === false) {
            names.delete(className);
            return false;
          }
          if (names.has(className)) {
            names.delete(className);
            return false;
          }
          names.add(className);
          return true;
        }
      };
    };

    const tabWidthPx = 120;
    const tabHeightPx = 40;
    const getTabNodes = (tabList) =>
      tabList.children.filter((node) => {
        const className = typeof node.className === 'string' ? node.className : '';
        return className.split(' ').includes('tab--item') || node.classList?.contains?.('tab--item');
      });
    const resolveTabWidthPx = (tabList) => (getTabNodes(tabList).length >= 3 ? 92 : tabWidthPx);

    const syncTabLayout = (tabList) => {
      let leftOffset = 0;
      const tabWidth = resolveTabWidthPx(tabList);
      tabList.children.forEach((node) => {
        if (!getTabNodes(tabList).includes(node)) {
          return;
        }
        node.width = tabWidth;
        node.left = tabList.left + leftOffset;
        node.top = tabList.top;
        leftOffset += tabWidth;
      });
    };

    const createTabListStub = ({ left, top }) => {
      const addButton = { className: 'tab--add', parentNode: null, cloneNode: () => ({ className: 'tab--add' }) };
      const tabList = {
        left,
        top,
        isConnected: true,
        panel: null,
        children: [],
        querySelectorAll: (selector) => (selector === '.tab--item' ? getTabNodes(tabList) : []),
        querySelector: (selector) => (selector === '.tab--add' ? addButton : null),
        getAttribute: () => null,
        getBoundingClientRect: () => {
          const width = Math.max(
            getTabNodes(tabList).reduce((total, node) => total + (node.width ?? tabWidthPx), 0),
            tabWidthPx
          );
          return {
            left: tabList.left,
            right: tabList.left + width,
            top: tabList.top,
            bottom: tabList.top + tabHeightPx,
            width,
            height: tabHeightPx
          };
        },
        closest: (selector) => (selector === '.browser' ? tabList.panel : null),
        insertBefore: (node, beforeNode) => {
          if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
            node.parentNode.removeChild(node);
          }
          const insertionIndex = beforeNode ? tabList.children.indexOf(beforeNode) : tabList.children.length;
          const safeIndex = insertionIndex === -1 ? tabList.children.length : insertionIndex;
          tabList.children.splice(safeIndex, 0, node);
          node.parentNode = tabList;
          syncTabLayout(tabList);
        },
        removeChild: (node) => {
          const index = tabList.children.indexOf(node);
          if (index === -1) {
            return;
          }
          tabList.children.splice(index, 1);
          node.parentNode = null;
          syncTabLayout(tabList);
        }
      };
      addButton.parentNode = tabList;
      tabList.children.push(addButton);
      return tabList;
    };

    let panelStubZCounter = 0;
    const allPanelStubs = [];
    const createPanelStub = (tabList) => {
      panelStubZCounter += 1;
      const panelHeight = 320;
      const getPanelWidth = () => Math.max(getTabNodes(tabList).length, 1) * tabWidthPx + 160;
      const panel = {
        tabList,
        parentElement: null,
        style: { zIndex: String(panelStubZCounter) },
        querySelector: (selector) => {
          if (selector === '.tab--list') {
            return tabList;
          }
          if (selector === '.tab--row') {
            return {
              querySelector: () => null,
              getBoundingClientRect: () => ({
                left: tabList.left,
                right: tabList.left + Math.max(getTabNodes(tabList).length, 1) * tabWidthPx + 120,
                top: tabList.top,
                bottom: tabList.top + tabHeightPx,
                width: Math.max(getTabNodes(tabList).length, 1) * tabWidthPx + 120,
                height: tabHeightPx
              })
            };
          }
          return null;
        },
        getBoundingClientRect: () => {
          const width = getPanelWidth();
          return {
            left: tabList.left,
            right: tabList.left + width,
            top: tabList.top,
            bottom: tabList.top + panelHeight,
            width,
            height: panelHeight
          };
        },
        remove: () => {}
      };
      tabList.panel = panel;
      allPanelStubs.push(panel);
      return panel;
    };

    const createTabStub = ({ id }) => {
      const tab = {
        id,
        className: 'tab--item',
        classList: createClassList(['tab--item']),
        style: {
          transform: '',
          transition: '',
          flex: '',
          minWidth: '',
          maxWidth: '',
          willChange: '',
          zIndex: ''
        },
        left: 0,
        top: 0,
        width: tabWidthPx,
        parentNode: null,
        animate: vi.fn(() => ({})),
        getBoundingClientRect: () => ({
          left: tab.left,
          right: tab.left + tab.width,
          top: tab.top,
          bottom: tab.top + tabHeightPx,
          width: tab.width,
          height: tabHeightPx
        }),
        closest: (selector) => {
          if (selector === '.tab--item') {
            return tab;
          }
          if (selector === '.tab--list') {
            return tab.parentNode;
          }
          if (selector === '.browser') {
            return tab.parentNode?.panel ?? null;
          }
          return null;
        },
        setPointerCapture: () => {},
        releasePointerCapture: () => {}
      };
      return tab;
    };

    const createDragProxyStub = (tab) => ({
      className: 'tab--item',
      classList: createClassList(['tab--item']),
      style: {
        left: '',
        top: '',
        width: '',
        height: '',
        minWidth: '',
        maxWidth: '',
        transform: '',
        willChange: ''
      },
      getBoundingClientRect: () => tab.getBoundingClientRect(),
      remove: () => {}
    });

    const sourceTabList = createTabListStub({ left: 40, top: 20 });
    const targetTabList = createTabListStub({ left: 460, top: 20 });
    createPanelStub(sourceTabList);
    createPanelStub(targetTabList);

    const sourceDraggedTab = createTabStub({ id: 'tab-a' });
    const sourceSiblingTab = createTabStub({ id: 'tab-x' });
    const sourceDragProxy = createDragProxyStub(sourceDraggedTab);
    sourceDraggedTab.cloneNode = () => sourceDragProxy;
    sourceSiblingTab.cloneNode = () => createDragProxyStub(sourceSiblingTab);
    sourceTabList.insertBefore(sourceDraggedTab, sourceTabList.querySelector('.tab--add'));
    sourceTabList.insertBefore(sourceSiblingTab, sourceTabList.querySelector('.tab--add'));

    const targetTabA = createTabStub({ id: 'tab-b' });
    const targetTabB = createTabStub({ id: 'tab-c' });
    targetTabA.cloneNode = () => createDragProxyStub(targetTabA);
    targetTabB.cloneNode = () => createDragProxyStub(targetTabB);
    targetTabList.insertBefore(targetTabA, targetTabList.querySelector('.tab--add'));
    targetTabList.insertBefore(targetTabB, targetTabList.querySelector('.tab--add'));

    const windowListeners = new Map();
    const rootListeners = new Map();
    const windowStub = {
      addEventListener: (type, listener) => {
        windowListeners.set(type, listener);
      },
      removeEventListener: (type) => {
        windowListeners.delete(type);
      },
      requestAnimationFrame: (callback) => {
        callback();
        return 1;
      },
      cancelAnimationFrame: () => {},
      innerWidth: 1400,
      innerHeight: 900
    };

    const createDocumentElementStub = () => {
      const element = {
        className: '',
        classList: createClassList(),
        style: {},
        parentNode: null,
        left: 0,
        top: 0,
        width: tabWidthPx,
        tabIndex: 0,
        setAttribute: () => {},
        getAttribute: () => null,
        addEventListener: () => {},
        append: () => {},
        insertBefore: () => {},
        querySelector: () => null,
        querySelectorAll: () => [],
        cloneNode: () => createDocumentElementStub(),
        closest: (selector) => {
          if (selector === '.tab--list') {
            return element.parentNode;
          }
          if (selector === '.browser') {
            return element.parentNode?.panel ?? null;
          }
          return null;
        },
        getBoundingClientRect: () => ({
          ...(() => {
            const width = element.className.split(' ').includes('tab--drag-hover-preview') ? 92 : element.width;
            return {
              right: element.left + width,
              width
            };
          })(),
          left: element.left,
          top: element.top,
          bottom: element.top + tabHeightPx,
          height: tabHeightPx
        }),
        remove: () => {
          if (element.parentNode && typeof element.parentNode.removeChild === 'function') {
            element.parentNode.removeChild(element);
          }
        },
        animate: () => ({ addEventListener: () => {}, cancel: () => {} })
      };
      return element;
    };

    const documentStub = {
      body: {
        style: {
          userSelect: ''
        },
        classList: createClassList(),
        append: () => {}
      },
      createElement: () => createDocumentElementStub(),
      querySelectorAll: (selector) => {
        if (selector === '.tab--list') return [sourceTabList, targetTabList];
        if (selector === '.browser') return allPanelStubs;
        return [];
      },
      elementsFromPoint: (clientX, clientY) => {
        const targetRect = targetTabList.getBoundingClientRect();
        if (
          clientX >= targetRect.left &&
          clientX <= targetRect.right &&
          clientY >= targetRect.top &&
          clientY <= targetRect.bottom
        ) {
          return [targetTabList];
        }
        return [sourceTabList];
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    const root = {
      addEventListener: (type, listener) => {
        rootListeners.set(type, listener);
      }
    };

    class ElementStub {}

    const previousRAF = globalThis.requestAnimationFrame;
    const previousCAF = globalThis.cancelAnimationFrame;

    globalThis.window = windowStub;
    globalThis.document = documentStub;
    globalThis.Element = ElementStub;
    globalThis.requestAnimationFrame = windowStub.requestAnimationFrame;
    globalThis.cancelAnimationFrame = windowStub.cancelAnimationFrame;

    try {
      initializeTabDrag({ root });

      rootListeners.get('pointerdown')({
        button: 0,
        target: sourceDraggedTab,
        pointerId: 7,
        clientX: 80,
        clientY: 30
      });
      windowListeners.get('pointermove')({
        pointerId: 7,
        clientX: 110,
        clientY: 30
      });
      windowListeners.get('pointermove')({
        pointerId: 7,
        clientX: 560,
        clientY: 30
      });

      expect(sourceDraggedTab.parentNode).toBe(sourceTabList);
      expect(
        getTabNodes(targetTabList)
          .map((tab) => tab.id)
          .filter(Boolean)
      ).toEqual(['tab-b', 'tab-c']);

      windowListeners.get('pointerup')({
        pointerId: 7,
        clientX: 560,
        clientY: 30
      });

      expect(sourceDraggedTab.parentNode).toBe(targetTabList);
      expect(
        getTabNodes(sourceTabList)
          .map((tab) => tab.id)
          .filter(Boolean)
      ).toEqual(['tab-x']);
      expect(
        getTabNodes(targetTabList)
          .map((tab) => tab.id)
          .filter(Boolean)
      ).toContain('tab-a');
      expect(getTabNodes(targetTabList).every((tab) => Boolean(tab.id))).toBe(true);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.requestAnimationFrame = previousRAF;
      globalThis.cancelAnimationFrame = previousCAF;
    }
  });

  it('skips tab drag for single-tab windows', () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;

    const createClassList = (initialNames = []) => {
      const names = new Set(initialNames);
      return {
        add: (...classNames) => {
          classNames.forEach((name) => names.add(name));
        },
        remove: (...classNames) => {
          classNames.forEach((name) => names.delete(name));
        },
        contains: (className) => names.has(className),
        toggle: (className, force) => {
          if (force === true) {
            names.add(className);
            return true;
          }
          if (force === false) {
            names.delete(className);
            return false;
          }
          if (names.has(className)) {
            names.delete(className);
            return false;
          }
          names.add(className);
          return true;
        }
      };
    };

    const windowListeners = new Map();
    const rootListeners = new Map();
    let frameToken = 0;
    let queuedFrameCallback = null;

    const flushAnimationFrame = () => {
      if (!queuedFrameCallback) {
        return;
      }

      const callback = queuedFrameCallback;
      queuedFrameCallback = null;
      callback();
    };

    const windowStub = {
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener: (type, listener) => {
        windowListeners.set(type, listener);
      },
      removeEventListener: (type) => {
        windowListeners.delete(type);
      },
      requestAnimationFrame: (callback) => {
        frameToken += 1;
        queuedFrameCallback = callback;
        return frameToken;
      },
      cancelAnimationFrame: () => {
        queuedFrameCallback = null;
      }
    };

    const sourcePanel = {
      style: {
        width: '',
        height: '',
        left: '',
        top: '',
        zIndex: '1'
      },
      parentElement: null,
      removed: false,
      getBoundingClientRect: () => ({
        left: 60,
        top: 320,
        width: 520,
        height: 300
      }),
      querySelector: (selector) => {
        if (selector === '.tab--row') {
          return {
            querySelector: () => null,
            getBoundingClientRect: () => ({
              left: 60,
              right: 580,
              top: 320,
              bottom: 360,
              width: 520,
              height: 40
            })
          };
        }
        if (selector === '.tab--list') {
          return tabList;
        }
        return null;
      },
      remove: () => {
        sourcePanel.removed = true;
      }
    };

    const tabList = {
      querySelectorAll: (selector) => (selector === '.tab--item' ? [draggedTab] : []),
      querySelector: (selector) => (selector === '.tab--add' ? addButton : null),
      getAttribute: () => null,
      getBoundingClientRect: () => ({
        left: 100,
        right: 260,
        top: 320,
        bottom: 360,
        width: 160,
        height: 40
      }),
      closest: (selector) => (selector === '.browser' ? sourcePanel : null),
      insertBefore: () => {}
    };

    const addButton = { cloneNode: () => ({}) };
    const dragProxy = {
      classList: createClassList(['tab--item']),
      style: {
        left: '',
        top: '',
        width: '',
        height: '',
        minWidth: '',
        maxWidth: '',
        transform: '',
        willChange: ''
      },
      getBoundingClientRect: () => ({
        left: 100,
        top: 320,
        width: 120,
        height: 40
      }),
      remove: () => {}
    };

    const draggedTab = {
      style: {
        transform: '',
        transition: '',
        flex: '',
        flexBasis: '',
        minWidth: '',
        maxWidth: '',
        willChange: '',
        zIndex: '',
        visibility: ''
      },
      tabIndex: 0,
      classList: createClassList(['tab--item', 'tab--active']),
      parentNode: tabList,
      setAttribute: () => {},
      getBoundingClientRect: () => ({
        left: 100,
        top: 320,
        width: 120,
        height: 40
      }),
      cloneNode: () => dragProxy,
      closest: (selector) => {
        if (selector === '.tab--item') {
          return draggedTab;
        }
        if (selector === '.tab--list') {
          return tabList;
        }
        if (selector === '.browser') {
          return sourcePanel;
        }
        return null;
      },
      setPointerCapture: () => {},
      releasePointerCapture: () => {}
    };

    const createDetachedElement = () => {
      const el = {
        className: '',
        style: {},
        children: [],
        parentNode: null,
        setAttribute: () => {},
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        append: (...nodes) => { el.children.push(...nodes); },
        insertBefore: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
        remove: () => { el.parentNode = null; },
        animate: () => ({ addEventListener: () => {}, cancel: () => {} })
      };
      return el;
    };

    const documentStub = {
      body: {
        style: {
          userSelect: ''
        },
        classList: createClassList(),
        appendChild: () => {},
        append: () => {}
      },
      createElement: () => createDetachedElement(),
      querySelectorAll: (selector) => {
        if (selector === '.tab--list') return [tabList];
        if (selector === '.browser') return [sourcePanel];
        return [];
      },
      elementsFromPoint: () => [],
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    const root = {
      addEventListener: (type, listener) => {
        rootListeners.set(type, listener);
      }
    };

    class ElementStub {}

    globalThis.window = windowStub;
    globalThis.document = documentStub;
    globalThis.Element = ElementStub;

    try {
      initializeTabDrag({ root });
      rootListeners.get('pointerdown')({
        button: 0,
        target: draggedTab,
        pointerId: 1,
        clientX: 120,
        clientY: 340
      });

      expect(windowListeners.has('pointermove')).toBe(false);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
    }
  });
});
