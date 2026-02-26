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

export const FLEX_LOCK_KEYS = ['flex', 'flexBasis', 'minWidth', 'maxWidth'];

export const clearFlexLock = (el) => {
  for (const key of FLEX_LOCK_KEYS) {
    el.style[key] = '';
  }
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

const STYLE_SUB_SELECTORS = ['.tab--background', '.tab--corner-left', '.tab--corner-right'];

const commitAndCancelAnimations = (el) => {
  const anims = el?.getAnimations?.();
  if (!anims?.length) return;
  for (const a of anims) {
    a.commitStyles();
    a.cancel();
  }
};

export const cancelProxySubAnimations = (proxy) => {
  for (const sel of STYLE_SUB_SELECTORS) {
    commitAndCancelAnimations(proxy.querySelector?.(sel));
  }
};

export const applyProxyDetachedStyle = (proxy, { isActive, durationMs, cancelExisting } = {}) => {
  if (cancelExisting) cancelProxySubAnimations(proxy);
  const d = durationMs ?? scaleDurationMs(dragTransitionDurationMs);
  if (isActive) {
    animateCornerClipOut(proxy, { durationMs: d });
    animateBackgroundRadiusToDetached(proxy, { durationMs: d });
  }
  animateDragShadowIn(proxy, { durationMs: d, isActive });
};

export const applyProxyAttachedStyle = (proxy, { isActive, durationMs, cancelExisting } = {}) => {
  if (cancelExisting) cancelProxySubAnimations(proxy);
  const d = durationMs ?? scaleDurationMs(dragTransitionDurationMs);
  const cornerDelay = Math.round(d * 0.3);
  animateCornerClipIn(proxy, { durationMs: d, delay: cornerDelay, fill: 'forwards' });
  animateBackgroundRadiusToAttached(proxy, { durationMs: d, fill: 'forwards' });
  animateDragShadowOut(proxy, {
    durationMs: durationMs ?? scaleDurationMs(dragShadowOutDurationMs),
    isActive
  });
};

export const animateProxyActivation = (proxy) => {
  const d = scaleDurationMs(dragTransitionDurationMs);
  const bg = proxy.querySelector?.('.tab--background');
  if (!bg) return null;
  const from = getComputedStyle(bg);
  const startOpacity = from.opacity;
  const startTransform = from.transform;
  return bg.animate(
    [
      { opacity: startOpacity, transform: startTransform },
      { opacity: '1', transform: 'translateY(0) scale(1)' }
    ],
    { duration: d, easing: 'ease', fill: 'forwards' }
  );
};
