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

    if (typeof previewTab.remove === 'function') {
      previewTab.remove();
    } else if (
      previewTab.parentNode &&
      typeof previewTab.parentNode.removeChild === 'function'
    ) {
      previewTab.parentNode.removeChild(previewTab);
    }

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
    tab.style.flex = '0 1 var(--tab-default-width)';
    tab.style.minWidth = '0';
    tab.style.maxWidth = '0';

    previewTab = tab;
    previewTabList = tabList;
    return tab;
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
    detach,
    createAndAttach,
    commitDrop
  };
};
