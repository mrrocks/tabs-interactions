import { toFiniteNumber } from '../shared/math';
import { scaleDurationMs } from '../motion/motionSpeed';
import { createWindowControlsElement, removePanel, windowControlsSelector } from './windowControls';
import { bringToFront } from './windowFocus';

const detachedWindowEnterDurationMs = 180;

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

const getDetachedWindowEnterDurationMs = () => scaleDurationMs(detachedWindowEnterDurationMs);

const initialDetachScale = 0.6;

export const animateDetachedWindowFromTab = ({ panel, draggedTab, tabList, placeholder, tabOffsetInPanel, tabScreenRect, frame, onTabInserted, onComplete }) => {
  if (placeholder && typeof placeholder.remove === 'function') {
    placeholder.remove();
  }
  moveTabToList({ tab: draggedTab, tabList });

  if (typeof onTabInserted === 'function') {
    onTabInserted();
  }

  if (typeof panel.animate !== 'function') {
    if (typeof onComplete === 'function') {
      onComplete();
    }
    return;
  }

  const tabCenterX = toFiniteNumber(tabOffsetInPanel.x, 0) + toFiniteNumber(tabScreenRect.width, 0) / 2;
  const tabCenterY = toFiniteNumber(tabOffsetInPanel.y, 0) + toFiniteNumber(tabScreenRect.height, 0) / 2;
  const originX = frame.width > 0 ? (tabCenterX / frame.width) * 100 : 50;
  const originY = frame.height > 0 ? (tabCenterY / frame.height) * 100 : 0;

  panel.style.transformOrigin = `${originX}% ${originY}%`;

  const animation = panel.animate(
    [
      { transform: `scale(${initialDetachScale})`, opacity: '0' },
      { transform: 'scale(1)', opacity: '1' }
    ],
    {
      duration: getDetachedWindowEnterDurationMs(),
      easing: 'ease',
      fill: 'both'
    }
  );

  if (animation && typeof animation.addEventListener === 'function') {
    animation.addEventListener('finish', () => {
      if (typeof animation.cancel === 'function') {
        animation.cancel();
      }
      panel.style.opacity = '';
      panel.style.transform = '';
      panel.style.transformOrigin = '';
      if (typeof onComplete === 'function') {
        onComplete();
      }
    });
  }
};

const createDetachedPanelElements = ({ sourcePanel, sourceTabList }) => {
  const panel = document.createElement('div');
  panel.className = 'browser browser--detached';
  panel.setAttribute('data-resizable', '');

  const tabRow = document.createElement('div');
  tabRow.className = 'tab--row';

  const sourceTabRow = sourcePanel.querySelector('.tab--row');
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

  const sourceAddButton = sourceTabList.querySelector('.tab--add');
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

const getTabEndReference = (tabList) => tabList.querySelector('.tab--add') ?? null;

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

export const getTabCount = (tabList) => tabList.querySelectorAll('.tab--item').length;

export const removeDetachedWindowIfEmpty = (panel) => {
  const tabList = panel.querySelector('.tab--list');
  if (!tabList) {
    return false;
  }

  if (getTabCount(tabList) > 0) {
    return false;
  }

  return removePanel(panel);
};

export const createDetachedWindow = ({
  sourcePanel,
  sourceTabList,
  tabScreenRect
}) => {
  if (typeof document === 'undefined') {
    return null;
  }

  const sourceRect = sourcePanel.getBoundingClientRect();
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
