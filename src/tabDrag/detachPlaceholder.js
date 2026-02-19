export const createDetachPlaceholderManager = ({ scaleDurationMs, detachCollapseDurationMs }) => {
  let placeholder = null;
  let collapsed = false;
  let hiddenTab = null;

  const setFlexWidth = (el, widthPx) => {
    el.style.flex = `0 0 ${widthPx}px`;
    el.style.minWidth = `${widthPx}px`;
    el.style.maxWidth = `${widthPx}px`;
  };

  const remove = () => {
    if (!placeholder) {
      return;
    }
    placeholder.remove();
    placeholder = null;
    collapsed = false;
  };

  const ensure = (tabList, draggedTab, widthPx) => {
    if (placeholder) {
      return;
    }
    if (typeof document === 'undefined') {
      return;
    }
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.overflow = 'hidden';
    el.style.height = '0';
    setFlexWidth(el, widthPx);
    draggedTab.style.display = 'none';
    hiddenTab = draggedTab;
    tabList.insertBefore(el, draggedTab);
    placeholder = el;
  };

  const sync = (shouldCollapse, { draggedTab, currentTabList, lockedTabWidthPx }) => {
    if (shouldCollapse) {
      ensure(currentTabList, draggedTab, lockedTabWidthPx);
      if (placeholder && !collapsed) {
        collapsed = true;
        placeholder.getBoundingClientRect();
        const durationMs = scaleDurationMs(detachCollapseDurationMs);
        const ease = `${durationMs}ms ease`;
        placeholder.style.transition = `flex-basis ${ease}, min-width ${ease}, max-width ${ease}`;
        setFlexWidth(placeholder, 0);
      }
    } else if (placeholder && collapsed) {
      collapsed = false;
      setFlexWidth(placeholder, lockedTabWidthPx);
    }
  };

  return {
    get active() { return placeholder !== null; },
    remove,
    sync,
    restoreDisplay(draggedTab) {
      if (hiddenTab === draggedTab) {
        draggedTab.style.display = '';
        hiddenTab = null;
      }
      remove();
    }
  };
};
