import { safeRemoveElement } from '../shared/dom';

export const createHoverPreviewManager = ({
  tabItemClassName,
  dragHoverPreviewClassName
}) => {
  let previewTab = null;
  let previewTabList = null;

  const detach = () => {
    previewTab = null;
    previewTabList = null;
  };

  const clear = () => {
    if (!previewTab) {
      return;
    }

    safeRemoveElement(previewTab);
    detach();
  };

  const createAndAttach = (tabList) => {
    clear();

    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null;
    }

    const tab = document.createElement('div');
    tab.className = `${tabItemClassName} ${dragHoverPreviewClassName}`;
    tab.setAttribute('aria-hidden', 'true');
    tab.tabIndex = -1;
    tab.style.opacity = '0';
    tab.style.pointerEvents = 'none';
    tab.style.transition = 'none';
    tab.style.overflow = 'hidden';
    tab.style.padding = '0';
    tab.style.gap = '0';
    tab.style.flex = '0 1 var(--tab-default-width)';
    tab.style.minWidth = '0';
    tab.style.maxWidth = '0';

    previewTab = tab;
    previewTabList = tabList;
    return tab;
  };

  const restore = (tab, tabList) => {
    previewTab = tab;
    previewTabList = tabList;
  };

  const commitDrop = ({ draggedTab, attachTargetTabList }) => {
    if (!previewTab || previewTabList !== attachTargetTabList) {
      return false;
    }

    if (!attachTargetTabList || typeof attachTargetTabList.insertBefore !== 'function') {
      clear();
      return false;
    }

    if (previewTab.parentNode !== attachTargetTabList) {
      clear();
      return false;
    }

    attachTargetTabList.insertBefore(draggedTab, previewTab);
    clear();
    return true;
  };

  return {
    get previewTab() { return previewTab; },
    get previewTabList() { return previewTabList; },
    clear,
    commitDrop,
    createAndAttach,
    detach,
    restore
  };
};
