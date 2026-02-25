import { dragTransitionEasing } from './dragAnimationConfig';
import { setFlexLock } from './styleHelpers';

export const createDetachPlaceholderManager = ({ scaleDurationMs, detachCollapseDurationMs }) => {
  let placeholder = null;
  let collapsed = false;
  let hiddenTab = null;
  let logicalWidthPx = 0;

  const createPlaceholderElement = (widthPx) => {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.overflow = 'hidden';
    el.style.height = '0';
    setFlexLock(el, widthPx);
    return el;
  };

  const remove = () => {
    if (!placeholder) {
      return;
    }
    placeholder.remove();
    placeholder = null;
    collapsed = false;
    logicalWidthPx = 0;
  };

  const ensure = (tabList, draggedTab, widthPx) => {
    if (placeholder || typeof document === 'undefined') {
      return;
    }
    const el = createPlaceholderElement(widthPx);
    draggedTab.style.display = 'none';
    hiddenTab = draggedTab;
    tabList.insertBefore(el, draggedTab);
    placeholder = el;
    logicalWidthPx = widthPx;
  };

  const ensureAt = (existingElement, { draggedTab }, widthPx) => {
    remove();
    if (typeof document === 'undefined' || !existingElement) {
      return;
    }
    const el = createPlaceholderElement(widthPx);
    existingElement.replaceWith(el);
    draggedTab.style.display = 'none';
    hiddenTab = draggedTab;
    placeholder = el;
    logicalWidthPx = widthPx;
  };

  const replaceWith = (element) => {
    if (!placeholder || !element) {
      remove();
      return;
    }
    placeholder.replaceWith(element);
    placeholder = null;
    collapsed = false;
    logicalWidthPx = 0;
  };

  const sync = (shouldCollapse, { draggedTab, currentTabList, lockedTabWidthPx }) => {
    if (shouldCollapse) {
      ensure(currentTabList, draggedTab, lockedTabWidthPx);
      if (placeholder && !collapsed) {
        collapsed = true;
        logicalWidthPx = 0;
        placeholder.getBoundingClientRect();
        const durationMs = scaleDurationMs(detachCollapseDurationMs);
        const ease = `${durationMs}ms ${dragTransitionEasing}`;
        placeholder.style.transition = `flex-basis ${ease}, min-width ${ease}, max-width ${ease}`;
        setFlexLock(placeholder, 0);
      }
    } else if (placeholder && collapsed) {
      collapsed = false;
      logicalWidthPx = lockedTabWidthPx;
      setFlexLock(placeholder, lockedTabWidthPx);
    }
  };

  const currentWidthPx = () => {
    if (!placeholder || typeof placeholder.getBoundingClientRect !== 'function') {
      return 0;
    }
    return placeholder.getBoundingClientRect().width;
  };

  const restoreDisplay = (draggedTab) => {
    if (hiddenTab === draggedTab) {
      draggedTab.style.display = '';
      hiddenTab = null;
    }
    remove();
  };

  const targetWidthPx = () => placeholder ? logicalWidthPx : 0;

  return {
    get active() { return placeholder !== null; },
    currentWidthPx,
    targetWidthPx,
    ensureAt,
    remove,
    replaceWith,
    restoreDisplay,
    sync
  };
};
