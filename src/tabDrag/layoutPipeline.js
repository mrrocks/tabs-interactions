import { toFiniteNumber } from '../shared/math';
import { toRectSnapshot } from '../shared/dom';

const getSiblingTabs = (getTabs, tabList, draggedTab) => getTabs(tabList).filter((tab) => tab !== draggedTab);

export const createLayoutPipeline = ({
  getTabs,
  getInsertionIndexFromCenters,
  moveTabToList,
  tabAddSelector = '.tab--add'
}) => {
  let frameToken = 0;
  let measurementCache = new Map();

  const beginFrame = () => {
    frameToken += 1;
    measurementCache = new Map();
    return frameToken;
  };

  const clearFrameCache = () => {
    measurementCache.clear();
  };

  const measureRect = (element) => {
    if (!element || typeof element.getBoundingClientRect !== 'function') {
      return {
        left: 0,
        top: 0,
        width: 0,
        height: 0
      };
    }

    const cached = measurementCache.get(element);
    if (cached) {
      return cached;
    }

    const snapshot = toRectSnapshot(element.getBoundingClientRect());
    measurementCache.set(element, snapshot);
    return snapshot;
  };

  const getTabEndReference = (tabList) => tabList.querySelector(tabAddSelector) ?? null;

  const moveTabToPointerPosition = ({ tabList, draggedTab, pointerClientX }) => {
    const siblingTabs = getSiblingTabs(getTabs, tabList, draggedTab);
    const centers = siblingTabs.map((tab) => {
      const rect = measureRect(tab);
      return rect.left + rect.width / 2;
    });
    const targetIndex = getInsertionIndexFromCenters({ centers, pointerClientX });
    const currentTabs = getTabs(tabList);
    const currentIndex = currentTabs.indexOf(draggedTab);

    if (draggedTab.parentNode === tabList && currentIndex === targetIndex) {
      return {
        moved: false,
        draggedBaseShiftX: 0,
        displacements: []
      };
    }

    const beforeLeftMap = new Map(siblingTabs.map((tab) => [tab, measureRect(tab).left]));
    const draggedLeftBefore = measureRect(draggedTab).left;
    const referenceNode = siblingTabs[targetIndex] ?? getTabEndReference(tabList);

    moveTabToList({
      tab: draggedTab,
      tabList,
      beforeNode: referenceNode
    });

    clearFrameCache();

    const draggedLeftAfter = measureRect(draggedTab).left;
    const displacements = siblingTabs
      .map((tab) => {
        const beforeLeft = beforeLeftMap.get(tab);
        const afterLeft = measureRect(tab).left;

        return {
          tab,
          deltaX: toFiniteNumber(beforeLeft, 0) - afterLeft
        };
      })
      .filter(({ deltaX }) => Math.abs(deltaX) >= 0.5);

    return {
      moved: true,
      draggedBaseShiftX: draggedLeftAfter - draggedLeftBefore,
      displacements
    };
  };

  return {
    beginFrame,
    clearFrameCache,
    measureRect,
    moveTabToPointerPosition
  };
};
