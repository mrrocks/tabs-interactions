import { dragTransitionEasing } from './dragAnimationConfig';

const SHADOW_NONE = '0 0 0 rgba(0, 0, 0, 0), 0 0 0 rgba(0, 0, 0, 0)';
const SHADOW_DRAG = '0 4px 12px rgba(0, 0, 0, 0.06), 0 0px 2px rgba(0, 0, 0, 0.02)';
const SHAPE_SELECTOR = '.tab--shape';

const resolveTarget = (element, isActive) => {
  if (!element) {
    return null;
  }

  if (isActive) {
    const shape = typeof element.querySelector === 'function'
      ? element.querySelector(SHAPE_SELECTOR)
      : null;
    return shape && typeof shape.animate === 'function'
      ? { target: shape }
      : null;
  }

  return typeof element.animate === 'function'
    ? { target: element, pseudo: '::before' }
    : null;
};

const animateShadow = (target, keyframes, options) => {
  try {
    return target.animate(keyframes, options);
  } catch {
    return null;
  }
};

export const animateDragShadowIn = (element, { durationMs, easing = dragTransitionEasing, isActive } = {}) => {
  const resolved = resolveTarget(element, isActive);
  if (!resolved) {
    return null;
  }

  const options = { duration: durationMs, easing, fill: 'forwards' };
  if (resolved.pseudo) {
    options.pseudoElement = resolved.pseudo;
  }

  return animateShadow(
    resolved.target,
    [{ boxShadow: SHADOW_NONE }, { boxShadow: SHADOW_DRAG }],
    options
  );
};

export const animateDragShadowOut = (element, { durationMs, easing = dragTransitionEasing, isActive } = {}) => {
  const resolved = resolveTarget(element, isActive);
  if (!resolved) {
    return null;
  }

  const options = { duration: durationMs, easing, fill: 'forwards' };
  if (resolved.pseudo) {
    options.pseudoElement = resolved.pseudo;
  }

  return animateShadow(
    resolved.target,
    [{ boxShadow: SHADOW_DRAG }, { boxShadow: SHADOW_NONE }],
    options
  );
};
