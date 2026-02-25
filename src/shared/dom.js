import { toFiniteNumber } from './math';

export const isEventTargetElement = (target) =>
  Boolean(target) && typeof target === 'object' && typeof target.closest === 'function';

export const toRectSnapshot = (rect) => ({
  left: toFiniteNumber(rect.left),
  top: toFiniteNumber(rect.top),
  width: toFiniteNumber(rect.width),
  height: toFiniteNumber(rect.height)
});
