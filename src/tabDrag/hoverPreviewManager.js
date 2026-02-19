import { toFiniteNumber } from '../shared/math';

export const createHoverPreviewManager = ({
  scaleDurationMs,
  hoverPreviewExpandDurationMs,
  tabItemClassName,
  dragHoverPreviewClassName
}) => {
  let previewTab = null;
  let previewTabList = null;
  let expanding = false;
  let animation = null;
  let collapsingElement = null;

  const cancelAnimation = () => {
    if (animation) {
      animation.cancel();
      animation = null;
    }
  };

  const removeCollapsing = () => {
    if (!collapsingElement) {
      return;
    }
    const el = collapsingElement;
    collapsingElement = null;
    el.getAnimations?.().forEach((a) => a.cancel());
    el.remove();
  };

  const clear = () => {
    removeCollapsing();

    if (!previewTab) {
      return;
    }

    cancelAnimation();

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
    expanding = false;
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
    tab.style.overflow = 'hidden';
    tab.style.transition = 'none';
    tab.style.flex = '0 1 var(--tab-default-width)';
    tab.style.minWidth = '0';
    tab.style.maxWidth = '0';

    return tab;
  };

  const expand = () => {
    if (!previewTab) {
      return null;
    }

    expanding = true;
    cancelAnimation();

    const tab = previewTab;
    const durationMs = scaleDurationMs(hoverPreviewExpandDurationMs);

    tab.style.minWidth = '';
    tab.style.maxWidth = '';
    tab.style.flex = '';

    if (typeof tab.animate !== 'function') {
      expanding = false;
      return null;
    }

    const settledWidthPx = tab.getBoundingClientRect().width;
    if (settledWidthPx <= 0) {
      expanding = false;
      return null;
    }

    animation = tab.animate(
      [
        { minWidth: '0px', maxWidth: '0px' },
        { minWidth: `${settledWidthPx}px`, maxWidth: `${settledWidthPx}px` }
      ],
      { duration: durationMs, easing: 'ease', fill: 'forwards' }
    );

    const onFinish = () => {
      if (previewTab !== tab) {
        return;
      }
      expanding = false;
      animation = null;
      tab.style.maxWidth = '';
      tab.style.minWidth = '';
    };

    animation.addEventListener('finish', onFinish);
    animation.addEventListener('cancel', onFinish);

    return { targetWidthPx: settledWidthPx, durationMs };
  };

  const collapseAndRemove = () => {
    if (!previewTab) {
      return;
    }

    const tab = previewTab;
    const currentWidth = toFiniteNumber(tab.getBoundingClientRect?.().width, 0);

    previewTab = null;
    previewTabList = null;
    expanding = false;
    cancelAnimation();
    removeCollapsing();

    tab.className = dragHoverPreviewClassName;

    const durationMs = scaleDurationMs(hoverPreviewExpandDurationMs);

    if (currentWidth <= 0 || typeof tab.animate !== 'function') {
      tab.remove();
      return;
    }

    tab.style.minWidth = `${currentWidth}px`;
    tab.style.maxWidth = `${currentWidth}px`;

    collapsingElement = tab;

    const collapseAnim = tab.animate(
      [
        { minWidth: `${currentWidth}px`, maxWidth: `${currentWidth}px` },
        { minWidth: '0px', maxWidth: '0px' }
      ],
      { duration: durationMs, easing: 'ease', fill: 'forwards' }
    );

    const onDone = () => {
      if (collapsingElement === tab) {
        collapsingElement = null;
      }
      tab.remove();
    };
    collapseAnim.addEventListener('finish', onDone);
    collapseAnim.addEventListener('cancel', onDone);
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
    get expanding() { return expanding; },
    set expanding(value) { expanding = value; },
    cancelAnimation,
    clear,
    create,
    expand,
    collapseAndRemove,
    commitDrop,
    setPreview
  };
};
