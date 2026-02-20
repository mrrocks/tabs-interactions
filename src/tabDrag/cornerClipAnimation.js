import { dragTransitionEasing } from './dragAnimationConfig';

const CORNER_WIDTH_PX = 12;
const TRANSLATE_HIDDEN_LEFT = `translateX(${CORNER_WIDTH_PX}px)`;
const TRANSLATE_HIDDEN_RIGHT = `translateX(-${CORNER_WIDTH_PX}px)`;
const TRANSLATE_VISIBLE = 'translateX(0)';
const RADIUS_ATTACHED = '12px 12px 0 0';
const RADIUS_DETACHED = '12px';
const BACKGROUND_SELECTOR = '.tab--background';
const CORNER_LEFT_SELECTOR = '.tab--corner-left';
const CORNER_RIGHT_SELECTOR = '.tab--corner-right';

const resolveBackground = (tab) => {
  if (!tab || typeof tab.querySelector !== 'function') {
    return null;
  }
  const bg = tab.querySelector(BACKGROUND_SELECTOR);
  return bg && typeof bg.animate === 'function' ? bg : null;
};

const resolveCorners = (tab) => {
  if (!tab || typeof tab.querySelector !== 'function') {
    return null;
  }
  const left = tab.querySelector(CORNER_LEFT_SELECTOR);
  const right = tab.querySelector(CORNER_RIGHT_SELECTOR);
  if (!left || !right) {
    return null;
  }
  return { left, right };
};

const safeAnimate = (element, keyframes, options) => {
  try {
    return element.animate(keyframes, options);
  } catch {
    return null;
  }
};

export const animateCornerClipIn = (tab, { durationMs, easing = dragTransitionEasing, fill = 'none' } = {}) => {
  const corners = resolveCorners(tab);
  if (!corners) {
    return [];
  }

  const options = { duration: durationMs, easing, fill };
  return [
    safeAnimate(corners.left, [{ transform: TRANSLATE_HIDDEN_LEFT, opacity: 0 }, { transform: TRANSLATE_VISIBLE, opacity: 1 }], options),
    safeAnimate(corners.right, [{ transform: TRANSLATE_HIDDEN_RIGHT, opacity: 0 }, { transform: TRANSLATE_VISIBLE, opacity: 1 }], options)
  ].filter(Boolean);
};

export const animateCornerClipOut = (tab, { durationMs, easing = dragTransitionEasing } = {}) => {
  const corners = resolveCorners(tab);
  if (!corners) {
    return [];
  }

  const options = { duration: durationMs, easing, fill: 'forwards' };
  return [
    safeAnimate(corners.left, [{ transform: TRANSLATE_VISIBLE, opacity: 1 }, { transform: TRANSLATE_HIDDEN_LEFT, opacity: 0 }], options),
    safeAnimate(corners.right, [{ transform: TRANSLATE_VISIBLE, opacity: 1 }, { transform: TRANSLATE_HIDDEN_RIGHT, opacity: 0 }], options)
  ].filter(Boolean);
};

const animateBackgroundRadius = (tab, from, to, { durationMs, easing = dragTransitionEasing, fill = 'none' } = {}) => {
  const bg = resolveBackground(tab);
  if (!bg) {
    return null;
  }

  return bg.animate(
    [{ borderRadius: from }, { borderRadius: to }],
    { duration: durationMs, easing, fill }
  );
};

export const animateBackgroundRadiusToDetached = (tab, options) =>
  animateBackgroundRadius(tab, RADIUS_ATTACHED, RADIUS_DETACHED, { ...options, fill: 'forwards' });

export const animateBackgroundRadiusToAttached = (tab, options) =>
  animateBackgroundRadius(tab, RADIUS_DETACHED, RADIUS_ATTACHED, options);
