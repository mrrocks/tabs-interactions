export const dragTransitionDurationMs = 150;
export const dragShadowOutDurationMs = 150;
export const dragTransitionEasing = 'ease';

const sampleAxis = (p1, p2, t) => {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
};

const solveT = (x1, x2, x, tolerance = 1e-6) => {
  let lo = 0;
  let hi = 1;
  while (hi - lo > tolerance) {
    const mid = (lo + hi) / 2;
    if (sampleAxis(x1, x2, mid) < x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
};

export const cubicBezier = (progress, x1 = 0.25, y1 = 0.1, x2 = 0.25, y2 = 1.0) => {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const t = solveT(x1, x2, progress);
  return sampleAxis(y1, y2, t);
};
