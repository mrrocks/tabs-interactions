import { scaleDurationMs } from './motionSpeed';
import { createWindowControlsElement, windowControlsSelector } from './windowControls';
import { bringToFront } from './windowFocus';

const defaultDetachAnchorX = 180;
const defaultDetachAnchorY = 20;
const detachedWindowEnterDurationMs = 180;

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const toFiniteNumber = (value, fallbackValue = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
};

const resolveViewportSize = (viewportWidth, viewportHeight) => {
  const hasWindow = typeof window !== 'undefined';
  const resolvedViewportWidth =
    viewportWidth === undefined ? (hasWindow ? window.innerWidth : Number.POSITIVE_INFINITY) : viewportWidth;
  const resolvedViewportHeight =
    viewportHeight === undefined ? (hasWindow ? window.innerHeight : Number.POSITIVE_INFINITY) : viewportHeight;

  return {
    viewportWidth: toFiniteNumber(resolvedViewportWidth, Number.POSITIVE_INFINITY),
    viewportHeight: toFiniteNumber(resolvedViewportHeight, Number.POSITIVE_INFINITY)
  };
};

export const computeDetachedPanelFrame = ({
  pointerClientX,
  pointerClientY,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
  anchorOffsetX = defaultDetachAnchorX,
  anchorOffsetY = defaultDetachAnchorY
}) => {
  const { viewportWidth: resolvedViewportWidth, viewportHeight: resolvedViewportHeight } = resolveViewportSize(
    viewportWidth,
    viewportHeight
  );
  const width = toFiniteNumber(panelWidth, 0);
  const height = toFiniteNumber(panelHeight, 0);
  const left = clamp(
    toFiniteNumber(pointerClientX, 0) - toFiniteNumber(anchorOffsetX, defaultDetachAnchorX),
    0,
    Math.max(0, resolvedViewportWidth - width)
  );
  const top = clamp(
    toFiniteNumber(pointerClientY, 0) - toFiniteNumber(anchorOffsetY, defaultDetachAnchorY),
    0,
    Math.max(0, resolvedViewportHeight - height)
  );

  return { width, height, left, top };
};

export const applyPanelFrame = (panel, frame) => {
  panel.style.width = `${frame.width}px`;
  panel.style.height = `${frame.height}px`;
  panel.style.left = `${frame.left}px`;
  panel.style.top = `${frame.top}px`;
};

const getDetachedWindowEnterDurationMs = () => scaleDurationMs(detachedWindowEnterDurationMs);

const createDetachedWindowAnimation = ({ tabRect, frame }) => {
  const scaleX = frame.width > 0 ? tabRect.width / frame.width : 1;
  const scaleY = frame.height > 0 ? tabRect.height / frame.height : 1;
  const translateX = tabRect.left - frame.left;
  const translateY = tabRect.top - frame.top;

  return [
    {
      transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
      opacity: '0.92'
    },
    {
      transform: 'translate(0px, 0px) scale(1, 1)',
      opacity: '1'
    }
  ];
};

export const animateDetachedWindowFromTab = ({ panel, tabRect, frame }) => {
  if (typeof panel.animate !== 'function') {
    return;
  }

  const animation = panel.animate(createDetachedWindowAnimation({ tabRect, frame }), {
    duration: getDetachedWindowEnterDurationMs(),
    easing: 'ease',
    fill: 'both'
  });

  if (animation && typeof animation.addEventListener === 'function') {
    animation.addEventListener('finish', () => {
      if (typeof animation.cancel === 'function') {
        animation.cancel();
      }
      panel.style.opacity = '';
      panel.style.transform = '';
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

  if (typeof panel.remove === 'function') {
    panel.remove();
  } else if (panel.parentNode && typeof panel.parentNode.removeChild === 'function') {
    panel.parentNode.removeChild(panel);
  }

  return true;
};

export const createDetachedWindow = ({
  sourcePanel,
  sourceTabList,
  draggedTab,
  pointerClientX,
  pointerClientY,
  viewportWidth,
  viewportHeight
}) => {
  if (typeof document === 'undefined') {
    return null;
  }

  const sourceRect = sourcePanel.getBoundingClientRect();
  const { panel, tabList } = createDetachedPanelElements({ sourcePanel, sourceTabList });
  const frame = computeDetachedPanelFrame({
    pointerClientX,
    pointerClientY,
    panelWidth: sourceRect.width,
    panelHeight: sourceRect.height,
    viewportWidth,
    viewportHeight
  });

  applyPanelFrame(panel, frame);
  const mountTarget = sourcePanel.parentElement ?? document.body;
  mountTarget.append(panel);
  bringToFront(panel);
  moveTabToList({ tab: draggedTab, tabList });

  return {
    panel,
    tabList,
    frame
  };
};
