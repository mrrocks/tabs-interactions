import { toFiniteNumber } from './math';

export const isEventTargetElement = (target) =>
  Boolean(target) && typeof target === 'object' && typeof target.closest === 'function';

export const toRectSnapshot = (rect) => ({
  left: toFiniteNumber(rect.left),
  top: toFiniteNumber(rect.top),
  width: toFiniteNumber(rect.width),
  height: toFiniteNumber(rect.height)
});

export const onAnimationSettled = (animation, callback) => {
  if (!animation || typeof animation.addEventListener !== 'function') {
    callback();
    return;
  }
  let fired = false;
  const settle = () => {
    if (fired) return;
    fired = true;
    callback();
  };
  animation.addEventListener('finish', settle);
  animation.addEventListener('cancel', settle);
};

export const safeRemoveElement = (element) => {
  if (!element) return false;
  if (typeof element.remove === 'function') {
    element.remove();
    return true;
  }
  if (element.parentNode && typeof element.parentNode.removeChild === 'function') {
    element.parentNode.removeChild(element);
    return true;
  }
  return false;
};
