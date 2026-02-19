import { toFiniteNumber } from '../shared/math';
import { resolveHoverPreviewWidthPx } from './dragCalculations';
import { dragTransitionEasing } from './dragAnimationConfig';

const ANIMATION_META_PROPS = new Set(['offset', 'easing', 'composite', 'computedOffset']);

export const createDragVisualWidthManager = ({ scaleDurationMs, hoverPreviewExpandDurationMs, tabItemClassName }) => {
  let activeAnimations = [];
  let animatingIn = false;
  let committedWidthPx = 0;

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

  const animateProxyAndTab = (session, targetWidthPx, animOptions) => {
    if (session.dragProxy) {
      const currentProxyWidth = toFiniteNumber(session.dragProxy.getBoundingClientRect?.().width, targetWidthPx);
      session.dragProxy.style.transition = 'none';
      trackAnimation(session.dragProxy, [
        { width: `${currentProxyWidth}px`, minWidth: `${currentProxyWidth}px`, maxWidth: `${currentProxyWidth}px` },
        { width: `${targetWidthPx}px`, minWidth: `${targetWidthPx}px`, maxWidth: `${targetWidthPx}px` }
      ], animOptions);
    }

    const currentTabWidth = toFiniteNumber(session.draggedTab.getBoundingClientRect?.().width, targetWidthPx);
    session.draggedTab.style.transition = 'none';
    trackAnimation(session.draggedTab, [
      { flexBasis: `${currentTabWidth}px`, minWidth: `${currentTabWidth}px`, maxWidth: `${currentTabWidth}px` },
      { flexBasis: `${targetWidthPx}px`, minWidth: `${targetWidthPx}px`, maxWidth: `${targetWidthPx}px` }
    ], animOptions);
  };

  const animateIn = (session, previewTab, { fromWidthPx = 0 } = {}) => {
    if (!previewTab || !session) {
      return;
    }

    cancelAll();

    previewTab.style.minWidth = '';
    previewTab.style.maxWidth = '';
    previewTab.style.flex = '';

    const settledWidthPx = previewTab.getBoundingClientRect().width;
    if (settledWidthPx <= 0) {
      return;
    }

    const startWidthPx = Math.min(toFiniteNumber(fromWidthPx, 0), settledWidthPx);

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
  };

  const animateOut = (previewTab, onRemoved) => {
    if (!previewTab) {
      return;
    }

    const tabList = previewTab.parentNode;
    const currentWidth = toFiniteNumber(previewTab.getBoundingClientRect?.().width, 0);

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
      const beforeLeftMap = new Map(siblings.map((s) => [s, s.getBoundingClientRect().left]));

      previewTab.remove();

      const displacements = siblings
        .map((tab) => ({ tab, deltaX: beforeLeftMap.get(tab) - tab.getBoundingClientRect().left }))
        .filter(({ deltaX }) => Math.abs(deltaX) >= 0.5);

      if (typeof onRemoved === 'function') {
        onRemoved(displacements);
      }
    };
    anim.addEventListener('finish', onDone);
    anim.addEventListener('cancel', onDone);
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

  const reset = (session) => {
    if (!session?.dragProxy) {
      return;
    }

    const baseWidthPx = resolveHoverPreviewWidthPx({
      dragProxyBaseRect: session.dragProxyBaseRect,
      draggedTab: session.draggedTab
    });
    if (baseWidthPx <= 0) {
      return;
    }

    session.dragProxy.style.width = `${baseWidthPx}px`;
    session.dragProxy.style.minWidth = `${baseWidthPx}px`;
    session.dragProxy.style.maxWidth = `${baseWidthPx}px`;
  };

  const animateToDetachedWidth = (session, targetWidthPx) => {
    if (!session?.dragProxy || !(targetWidthPx > 0)) {
      return;
    }

    const currentWidth = toFiniteNumber(session.dragProxy.getBoundingClientRect?.().width, 0);
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
    animateToDetachedWidth,
    cancelAll,
    reset,
    syncWidth
  };
};
