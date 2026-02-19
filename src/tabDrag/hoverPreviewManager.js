export const createHoverPreviewManager = ({
  tabItemClassName,
  dragHoverPreviewClassName
}) => {
  let previewTab = null;
  let previewTabList = null;

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

    previewTab = null;
    previewTabList = null;
  };

  const create = () => {
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

  const setPreview = (tab, tabList) => {
    previewTab = tab;
    previewTabList = tabList;
  };

  return {
    get previewTab() { return previewTab; },
    get previewTabList() { return previewTabList; },
    clear,
    create,
    commitDrop,
    setPreview
  };
};
