import { scaleDurationMs } from '../motion/motionSpeed';
import { onAnimationSettled, toRectSnapshot } from '../shared/dom';
import {
  animateCornerClipIn,
  animateCornerClipOut,
  animateBackgroundRadiusToAttached,
  animateBackgroundRadiusToDetached
} from './cornerClipAnimation';
import { animateDragShadowIn, animateDragShadowOut } from './dragShadowAnimation';
import { dragTransitionDurationMs, dragShadowOutDurationMs } from './dragAnimationConfig';

export const setFlexLock = (el, widthPx) => {
  el.style.flex = `0 0 ${widthPx}px`;
  el.style.minWidth = `${widthPx}px`;
  el.style.maxWidth = `${widthPx}px`;
};

export const clearFlexLock = (el) => {
  el.style.flex = '';
  el.style.minWidth = '';
  el.style.maxWidth = '';
};

export const animateFlexWidthTransition = (el, { durationMs, easing }) => {
  const currentWidth = el.getBoundingClientRect().width;
  clearFlexLock(el);
  const settledRect = toRectSnapshot(el.getBoundingClientRect());

  if (settledRect.width <= 0 || Math.abs(currentWidth - settledRect.width) < 1) {
    return { animation: null, toWidth: settledRect.width, settledRect };
  }

  setFlexLock(el, currentWidth);

  const animation = el.animate(
    [
      { minWidth: `${currentWidth}px`, maxWidth: `${currentWidth}px` },
      { minWidth: `${settledRect.width}px`, maxWidth: `${settledRect.width}px` }
    ],
    { duration: durationMs, easing, fill: 'forwards' }
  );

  onAnimationSettled(animation, () => {
    animation.cancel();
    clearFlexLock(el);
  });
  return { animation, toWidth: settledRect.width, settledRect };
};

const DRAG_STYLE_KEYS = ['transform', 'transition', 'flex', 'flexBasis', 'minWidth', 'maxWidth', 'willChange', 'zIndex'];

export const clearDragInlineStyles = (tab) => {
  for (const key of DRAG_STYLE_KEYS) {
    tab.style[key] = '';
  }
};

export const restoreDragInlineStyles = (tab, initialInlineStyles) => {
  for (const key of DRAG_STYLE_KEYS) {
    tab.style[key] = initialInlineStyles[key] ?? '';
  }
};

export const applyProxyDetachedStyle = (proxy, { isActive, durationMs } = {}) => {
  const d = durationMs ?? scaleDurationMs(dragTransitionDurationMs);
  if (isActive) {
    animateCornerClipOut(proxy, { durationMs: d });
    animateBackgroundRadiusToDetached(proxy, { durationMs: d });
  }
  animateDragShadowIn(proxy, { durationMs: d, isActive });
};

export const applyProxyAttachedStyle = (proxy, { isActive, durationMs } = {}) => {
  const d = durationMs ?? scaleDurationMs(dragTransitionDurationMs);
  animateCornerClipIn(proxy, { durationMs: d, fill: 'forwards' });
  animateBackgroundRadiusToAttached(proxy, { durationMs: d, fill: 'forwards' });
  animateDragShadowOut(proxy, {
    durationMs: durationMs ?? scaleDurationMs(dragShadowOutDurationMs),
    isActive
  });
};

export const applyTabAttachedStyle = (tab, { durationMs } = {}) => {
  const d = durationMs ?? scaleDurationMs(dragTransitionDurationMs);
  animateCornerClipIn(tab, { durationMs: d });
  animateBackgroundRadiusToAttached(tab, { durationMs: d });
};
