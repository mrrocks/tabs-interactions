import { toFiniteNumber } from '../shared/math';
import { onAnimationSettled } from '../shared/dom';
import { resolveHoverPreviewWidthPx, snapshotSiblingPositions, computeDisplacements } from './dragCalculations';
import { dragTransitionEasing } from './dragAnimationConfig';

const ANIMATION_META_PROPS = new Set(['offset', 'easing', 'composite', 'computedOffset']);

export const createDragVisualWidthManager = ({ scaleDurationMs, hoverPreviewExpandDurationMs, tabItemClassName }) => {
  let activeAnimations = [];
  let animatingIn = false;
  let committedWidthPx = 0;
  let lastProxyTargetWidthPx = 0;
  let lastTabTargetWidthPx = 0;

  const makeAnimOptions = () => ({
    duration: scaleDurationMs(hoverPreviewExpandDurationMs),
    easing: dragTransitionEasing,
    fill: 'forwards'
  });

  const commitStylesToElements = () => {
    for (const anim of activeAnimations) {
      const target = anim.effect?.target;
      if (!target || anim.playState === 'idle') {
        continue;
      }
      const keyframes = anim.effect.getKeyframes?.();
      if (!keyframes || keyframes.length < 2) {
        continue;
      }
      const last = keyframes[keyframes.length - 1];
      for (const prop of Object.keys(last)) {
        if (ANIMATION_META_PROPS.has(prop)) {
          continue;
        }
        target.style[prop] = last[prop];
      }
    }
  };

  const cancelAll = () => {
    commitStylesToElements();
    activeAnimations.forEach((anim) => anim.cancel());
    activeAnimations = [];
    animatingIn = false;
    committedWidthPx = 0;
    lastProxyTargetWidthPx = 0;
    lastTabTargetWidthPx = 0;
  };

  const trackAnimation = (element, keyframes, options) => {
    if (typeof element?.animate !== 'function') {
      return null;
    }
    const anim = element.animate(keyframes, options);
    if (anim && typeof anim.cancel === 'function') {
      activeAnimations.push(anim);
    }
    return anim;
  };

  const computeGrabRatio = (session) => {
    const baseLeft = toFiniteNumber(session.dragProxyBaseRect?.left, 0);
    const baseWidth = toFiniteNumber(session.dragProxyBaseRect?.width, 0);
    if (baseWidth <= 0) return 0;
    const grabOffset = toFiniteNumber(session.startX, 0) - baseLeft;
    return Math.max(0, Math.min(1, grabOffset / baseWidth));
  };

  const animateProxyAndTab = (session, targetWidthPx, animOptions) => {
    if (session.dragProxy) {
      const currentProxyWidth = lastProxyTargetWidthPx > 0
        ? lastProxyTargetWidthPx
        : toFiniteNumber(session.dragProxy.getBoundingClientRect?.().width, targetWidthPx);

      const grabRatio = computeGrabRatio(session);
      const leftDelta = grabRatio * (currentProxyWidth - targetWidthPx);
      const currentLeft = toFiniteNumber(parseFloat(session.dragProxy.style.left), 0);

      session.dragProxy.style.transition = 'none';
      trackAnimation(session.dragProxy, [
        { left: `${currentLeft}px`, width: `${currentProxyWidth}px`, minWidth: `${currentProxyWidth}px`, maxWidth: `${currentProxyWidth}px` },
        { left: `${currentLeft + leftDelta}px`, width: `${targetWidthPx}px`, minWidth: `${targetWidthPx}px`, maxWidth: `${targetWidthPx}px` }
      ], animOptions);
      lastProxyTargetWidthPx = targetWidthPx;
    }

    const currentTabWidth = lastTabTargetWidthPx > 0
      ? lastTabTargetWidthPx
      : toFiniteNumber(session.draggedTab.getBoundingClientRect?.().width, targetWidthPx);
    session.draggedTab.style.transition = 'none';
    trackAnimation(session.draggedTab, [
      { flexBasis: `${currentTabWidth}px`, minWidth: `${currentTabWidth}px`, maxWidth: `${currentTabWidth}px` },
      { flexBasis: `${targetWidthPx}px`, minWidth: `${targetWidthPx}px`, maxWidth: `${targetWidthPx}px` }
    ], animOptions);
    lastTabTargetWidthPx = targetWidthPx;
  };

  const getSiblings = (previewTab) => {
    const tabList = previewTab.parentNode;
    if (!tabList) {
      return [];
    }
    return Array.from(tabList.children).filter(
      (el) => el !== previewTab && el.classList?.contains(tabItemClassName)
    );
  };

  const measureNaturalWidthInList = (previewTab) => {
    const saved = { minWidth: previewTab.style.minWidth, maxWidth: previewTab.style.maxWidth };
    previewTab.style.minWidth = '';
    previewTab.style.maxWidth = '';
    const width = toFiniteNumber(previewTab.getBoundingClientRect().width, 0);
    previewTab.style.minWidth = saved.minWidth;
    previewTab.style.maxWidth = saved.maxWidth;
    return width;
  };

  const animateIn = (session, previewTab, { fromWidthPx = 0 } = {}) => {
    if (!previewTab || !session) {
      return { displacements: [] };
    }

    cancelAll();

    const naturalWidthPx = previewTab.parentNode ? measureNaturalWidthInList(previewTab) : 0;
    const fallbackWidthPx = resolveHoverPreviewWidthPx({
      dragProxyBaseRect: session.dragProxyBaseRect,
      draggedTab: session.draggedTab
    });
    const settledWidthPx = naturalWidthPx > 0 ? naturalWidthPx : fallbackWidthPx;
    if (settledWidthPx <= 0) {
      return { displacements: [] };
    }

    const siblings = getSiblings(previewTab);
    const snapshot = snapshotSiblingPositions(siblings);

    const startWidthPx = Math.min(toFiniteNumber(fromWidthPx, 0), settledWidthPx);

    previewTab.style.minWidth = `${startWidthPx}px`;
    previewTab.style.maxWidth = `${startWidthPx}px`;

    const displacements = computeDisplacements(siblings, snapshot);

    committedWidthPx = settledWidthPx;
    const animOptions = makeAnimOptions();

    animatingIn = true;

    const previewAnim = trackAnimation(previewTab, [
      { minWidth: `${startWidthPx}px`, maxWidth: `${startWidthPx}px` },
      { minWidth: `${settledWidthPx}px`, maxWidth: `${settledWidthPx}px` }
    ], animOptions);

    if (previewAnim) {
      previewAnim.addEventListener('finish', () => { animatingIn = false; });
    } else {
      animatingIn = false;
    }

    animateProxyAndTab(session, settledWidthPx, animOptions);

    return { displacements };
  };

  const animateOut = (previewTab, onRemoved) => {
    if (!previewTab) {
      return;
    }

    const tabList = previewTab.parentNode;
    const currentWidth = committedWidthPx > 0
      ? committedWidthPx
      : toFiniteNumber(previewTab.getBoundingClientRect?.().width, 0);

    cancelAll();

    if (currentWidth <= 0 || typeof previewTab.animate !== 'function') {
      previewTab.remove();
      return;
    }

    previewTab.style.minWidth = `${currentWidth}px`;
    previewTab.style.maxWidth = `${currentWidth}px`;

    const anim = previewTab.animate(
      [
        { minWidth: `${currentWidth}px`, maxWidth: `${currentWidth}px` },
        { minWidth: '0px', maxWidth: '0px' }
      ],
      makeAnimOptions()
    );

    const onDone = () => {
      const siblings = tabList
        ? Array.from(tabList.children).filter((el) => el !== previewTab && el.classList?.contains(tabItemClassName))
        : [];
      const snapshot = snapshotSiblingPositions(siblings);

      previewTab.remove();

      if (typeof onRemoved === 'function') {
        onRemoved(computeDisplacements(siblings, snapshot));
      }
    };
    onAnimationSettled(anim, onDone);
  };

  const syncWidth = (session, previewTab) => {
    if (animatingIn) {
      return;
    }

    if (!previewTab || !session || typeof previewTab.getBoundingClientRect !== 'function') {
      return;
    }

    const previewWidthPx = toFiniteNumber(previewTab.getBoundingClientRect().width, 0);
    if (previewWidthPx <= 0) {
      return;
    }

    if (committedWidthPx > 0 && Math.abs(previewWidthPx - committedWidthPx) < 1) {
      return;
    }

    committedWidthPx = previewWidthPx;
    cancelAll();

    animateProxyAndTab(session, previewWidthPx, makeAnimOptions());
  };

  const resolveBaseWidthPx = (session) => resolveHoverPreviewWidthPx({
    dragProxyBaseRect: session.dragProxyBaseRect,
    draggedTab: session.draggedTab
  });

  const reset = (session) => {
    if (!session?.dragProxy) {
      return;
    }

    const baseWidthPx = resolveBaseWidthPx(session);
    if (baseWidthPx <= 0) {
      return;
    }

    session.dragProxy.style.left = `${toFiniteNumber(session.dragProxyBaseRect?.left, 0)}px`;
    session.dragProxy.style.width = `${baseWidthPx}px`;
    session.dragProxy.style.minWidth = `${baseWidthPx}px`;
    session.dragProxy.style.maxWidth = `${baseWidthPx}px`;
  };

  const animateToBaseWidth = (session) => {
    if (!session?.dragProxy) {
      return;
    }

    const baseWidthPx = resolveBaseWidthPx(session);
    if (baseWidthPx <= 0) {
      return;
    }

    const currentWidth = lastProxyTargetWidthPx > 0
      ? lastProxyTargetWidthPx
      : toFiniteNumber(session.dragProxy.getBoundingClientRect?.().width, 0);
    if (currentWidth <= 0 || Math.abs(currentWidth - baseWidthPx) < 1) {
      return;
    }

    cancelAll();
    committedWidthPx = baseWidthPx;

    animateProxyAndTab(session, baseWidthPx, makeAnimOptions());
  };

  const animateToDetachedWidth = (session, targetWidthPx) => {
    if (!session?.dragProxy || !(targetWidthPx > 0)) {
      return;
    }

    const currentWidth = lastProxyTargetWidthPx > 0
      ? lastProxyTargetWidthPx
      : toFiniteNumber(session.dragProxy.getBoundingClientRect?.().width, 0);
    if (currentWidth <= 0 || Math.abs(currentWidth - targetWidthPx) < 1) {
      return;
    }

    cancelAll();
    committedWidthPx = targetWidthPx;

    animateProxyAndTab(session, targetWidthPx, makeAnimOptions());
  };

  return {
    get animatingIn() { return animatingIn; },
    animateIn,
    animateOut,
    animateToBaseWidth,
    animateToDetachedWidth,
    cancelAll,
    reset,
    syncWidth
  };
};
