export const isEventTargetElement = (target) =>
  Boolean(target) && typeof target === 'object' && typeof target.closest === 'function';

export const toRectSnapshot = (rect) => {
  const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  return {
    left: toNum(rect.left),
    top: toNum(rect.top),
    width: toNum(rect.width),
    height: toNum(rect.height)
  };
};
