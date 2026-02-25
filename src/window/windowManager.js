import { toFiniteNumber } from '../shared/math';
import { scaleDurationMs } from '../motion/motionSpeed';
import { tabAddSelector, tabItemSelector, tabListSelector, tabRowSelector } from '../shared/selectors';
import { createWindowControlsElement, windowControlsSelector } from './windowControls';
import { bringToFront } from './windowFocus';

export const removePanel = (panel) => {
  if (!panel) {
    return false;
  }

  if (typeof panel.remove === 'function') {
    panel.remove();
    return true;
  }

  if (panel.parentNode && typeof panel.parentNode.removeChild === 'function') {
    panel.parentNode.removeChild(panel);
    return true;
  }

  return false;
};

const panelScaleTransitionMs = 250;
const panelDetachScale = 0.6;

export const computeFrameFromTabAnchor = ({
  tabScreenRect,
  tabOffsetInPanel,
  panelWidth,
  panelHeight
}) => {
  const width = toFiniteNumber(panelWidth, 0);
  const height = toFiniteNumber(panelHeight, 0);
  const left = toFiniteNumber(tabScreenRect.left, 0) - toFiniteNumber(tabOffsetInPanel.x, 0);
  const top = toFiniteNumber(tabScreenRect.top, 0) - toFiniteNumber(tabOffsetInPanel.y, 0);

  return { width, height, left, top };
};

export const applyPanelFrame = (panel, frame) => {
  panel.style.width = `${frame.width}px`;
  panel.style.height = `${frame.height}px`;
  panel.style.left = `${frame.left}px`;
  panel.style.top = `${frame.top}px`;
};

const getScaledPanelTransitionMs = () => scaleDurationMs(panelScaleTransitionMs);

const runPanelScaleAnimation = (panel, keyframes, onFinish) => {
  if (typeof panel.animate !== 'function') {
    onFinish?.();
    return null;
  }

  const animation = panel.animate(keyframes, {
    duration: getScaledPanelTransitionMs(),
    easing: 'ease',
    fill: 'both'
  });

  animation?.addEventListener?.('finish', () => {
    animation.cancel?.();
    onFinish?.();
  });

  return animation;
};

export const animateDetachedWindowScaleIn = ({ panel, tabOffsetInPanel, tabScreenRect, frame, onComplete }) => {
  const tabCenterX = toFiniteNumber(tabOffsetInPanel.x, 0) + toFiniteNumber(tabScreenRect.width, 0) / 2;
  const tabBottomY = toFiniteNumber(tabOffsetInPanel.y, 0) + toFiniteNumber(tabScreenRect.height, 0);
  const originX = frame.width > 0 ? (tabCenterX / frame.width) * 100 : 50;
  const originY = frame.height > 0 ? (tabBottomY / frame.height) * 100 : 0;

  panel.style.transformOrigin = `${originX}% ${originY}%`;

  runPanelScaleAnimation(
    panel,
    [
      { transform: `scale(${panelDetachScale})`, opacity: '0' },
      { transform: 'scale(1)', opacity: '1' }
    ],
    () => {
      panel.style.opacity = '';
      panel.style.transform = '';
      panel.style.transformOrigin = '';
      onComplete?.();
    }
  );
};

export const animateDetachedWindowFromTab = ({ panel, draggedTab, tabList, placeholder, tabOffsetInPanel, tabScreenRect, frame, onTabInserted, onComplete }) => {
  if (placeholder && typeof placeholder.remove === 'function') {
    placeholder.remove();
  }
  moveTabToList({ tab: draggedTab, tabList });
  onTabInserted?.();

  animateDetachedWindowScaleIn({ panel, tabOffsetInPanel, tabScreenRect, frame, onComplete });
};

const createDetachedPanelElements = ({ sourcePanel, sourceTabList }) => {
  const panel = document.createElement('div');
  panel.className = 'browser browser--detached';
  panel.setAttribute('data-resizable', '');

  const tabRow = document.createElement('div');
  tabRow.className = 'tab--row';

  const sourceTabRow = sourcePanel.querySelector(tabRowSelector);
  const controls = sourceTabRow ? sourceTabRow.querySelector(windowControlsSelector) : null;
  tabRow.append(controls ? controls.cloneNode(true) : createWindowControlsElement(document));

  const tabList = document.createElement('div');
  tabList.className = 'tab--list';
  tabList.setAttribute('role', sourceTabList.getAttribute('role') ?? 'tablist');
  const ariaLabel = sourceTabList.getAttribute('aria-label');
  if (ariaLabel) {
    tabList.setAttribute('aria-label', ariaLabel);
  }
  tabRow.append(tabList);

  const sourceAddButton = sourceTabList.querySelector(tabAddSelector);
  if (sourceAddButton) {
    tabList.append(sourceAddButton.cloneNode(true));
  }

  const bar = document.createElement('div');
  bar.className = 'bar';
  const body = document.createElement('div');
  body.className = 'body';

  panel.append(tabRow, bar, body);

  return { panel, tabList };
};

const getTabEndReference = (tabList) => tabList.querySelector(tabAddSelector) ?? null;

const createTabPlaceholder = (tabList, { width, height }) => {
  const el = document.createElement('div');
  el.style.flex = `0 0 ${width}px`;
  el.style.minWidth = `${width}px`;
  el.style.maxWidth = `${width}px`;
  el.style.height = `${height}px`;
  el.setAttribute('aria-hidden', 'true');
  tabList.insertBefore(el, getTabEndReference(tabList));
  return el;
};

export const moveTabToList = ({ tab, tabList, beforeNode = getTabEndReference(tabList) }) => {
  tabList.insertBefore(tab, beforeNode);
};

export const getTabCount = (tabList) => tabList.querySelectorAll(tabItemSelector).length;

export const removeDetachedWindowIfEmpty = (panel) => {
  const tabList = panel.querySelector(tabListSelector);
  if (!tabList) {
    return false;
  }

  if (getTabCount(tabList) > 0) {
    return false;
  }

  animatedRemovePanel(panel);
  return true;
};

const resolveAnchorOrigin = (panel, anchor) => {
  if (!anchor) {
    return '50% 0%';
  }
  const panelRect = panel.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const cx = anchorRect.left + anchorRect.width / 2 - panelRect.left;
  const cy = anchorRect.top + anchorRect.height / 2 - panelRect.top;
  const ox = panelRect.width > 0 ? (cx / panelRect.width) * 100 : 50;
  const oy = panelRect.height > 0 ? (cy / panelRect.height) * 100 : 0;
  return `${ox}% ${oy}%`;
};

export const createDetachedWindowToggle = ({ panel, tabOffsetInPanel, frame }) => {
  const tabCenterX = toFiniteNumber(tabOffsetInPanel.x, 0);
  const tabBottomY = toFiniteNumber(tabOffsetInPanel.y, 0);
  const originX = frame.width > 0 ? (tabCenterX / frame.width) * 100 : 50;
  const originY = frame.height > 0 ? (tabBottomY / frame.height) * 100 : 0;

  panel.style.transformOrigin = `${originX}% ${originY}%`;

  const keyframes = [
    { transform: 'scale(1)', opacity: '1' },
    { transform: `scale(${panelDetachScale})`, opacity: '0' }
  ];

  const animation = panel.animate(keyframes, {
    duration: getScaledPanelTransitionMs(),
    easing: 'ease',
    fill: 'forwards'
  });
  animation.pause();

  const clearStyles = () => {
    panel.style.pointerEvents = '';
    panel.style.transformOrigin = '';
    panel.style.transform = '';
    panel.style.opacity = '';
  };

  const collapse = () => {
    panel.style.pointerEvents = 'none';
    animation.playbackRate = 1;
    animation.play();
  };

  const expand = () => {
    panel.style.pointerEvents = '';
    animation.playbackRate = -1;
    animation.play();
  };

  const isCollapsed = () => {
    return animation.playState === 'finished' && animation.playbackRate > 0;
  };

  const destroy = () => {
    animation.cancel();
    clearStyles();
  };

  return { collapse, expand, isCollapsed, destroy, animation };
};

export const animatedRemovePanel = (panel, { anchor } = {}) => {
  if (!panel) {
    return false;
  }

  if (typeof panel.animate !== 'function') {
    return removePanel(panel);
  }

  panel.style.transformOrigin = resolveAnchorOrigin(panel, anchor);
  panel.style.pointerEvents = 'none';

  runPanelScaleAnimation(
    panel,
    [
      { transform: 'scale(1)', opacity: '1' },
      { transform: `scale(${panelDetachScale})`, opacity: '0' }
    ],
    () => removePanel(panel)
  );

  return true;
};

export const createDetachedWindow = ({
  sourcePanel,
  sourceTabList,
  tabScreenRect,
  sourcePanelRect
}) => {
  if (typeof document === 'undefined') {
    return null;
  }

  const liveRect = sourcePanel.getBoundingClientRect();
  const sourceRect = sourcePanelRect?.width > 0 && sourcePanelRect?.height > 0
    ? sourcePanelRect
    : liveRect.width > 0 && liveRect.height > 0
      ? liveRect
      : sourcePanelRect ?? liveRect;
  const { panel, tabList } = createDetachedPanelElements({ sourcePanel, sourceTabList });
  const panelWidth = sourceRect.width;
  const panelHeight = sourceRect.height;

  const mountTarget = sourcePanel.parentElement ?? document.body;
  panel.style.width = `${panelWidth}px`;
  panel.style.height = `${panelHeight}px`;
  panel.style.visibility = 'hidden';
  mountTarget.append(panel);

  const placeholder = createTabPlaceholder(tabList, tabScreenRect);

  const panelRect = panel.getBoundingClientRect();
  const placeholderRect = placeholder.getBoundingClientRect();
  const tabOffsetInPanel = {
    x: placeholderRect.left - panelRect.left,
    y: placeholderRect.top - panelRect.top
  };

  const frame = computeFrameFromTabAnchor({
    tabScreenRect,
    tabOffsetInPanel,
    panelWidth,
    panelHeight
  });

  applyPanelFrame(panel, frame);
  panel.style.visibility = '';
  bringToFront(panel);

  return {
    panel,
    tabList,
    frame,
    tabOffsetInPanel,
    placeholder
  };
};
