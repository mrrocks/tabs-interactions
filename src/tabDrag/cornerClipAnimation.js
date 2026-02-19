const CLIP_HIDDEN = 'inset(100% 0 0 0)';
const CLIP_VISIBLE = 'inset(0 0 0 0)';
const RADIUS_ATTACHED = '12px 12px 0 0';
const RADIUS_DETACHED = '12px';
const SHAPE_SELECTOR = '.tab--shape';
const CORNER_PSEUDOS = ['::before', '::after'];

const resolveShape = (tab) => {
  if (!tab || typeof tab.querySelector !== 'function') {
    return null;
  }
  const shape = tab.querySelector(SHAPE_SELECTOR);
  return shape && typeof shape.animate === 'function' ? shape : null;
};

const animatePseudos = (shape, keyframes, options) =>
  CORNER_PSEUDOS.map((pseudo) => {
    try {
      return shape.animate(keyframes, { ...options, pseudoElement: pseudo });
    } catch {
      return null;
    }
  }).filter(Boolean);

export const animateCornerClipIn = (tab, { durationMs, easing = 'ease' } = {}) => {
  const shape = resolveShape(tab);
  if (!shape) {
    return [];
  }

  return animatePseudos(shape, [
    { clipPath: CLIP_HIDDEN },
    { clipPath: CLIP_VISIBLE }
  ], { duration: durationMs, easing, fill: 'none' });
};

export const animateCornerClipOut = (tab, { durationMs, easing = 'ease' } = {}) => {
  const shape = resolveShape(tab);
  if (!shape) {
    return [];
  }

  return animatePseudos(shape, [
    { clipPath: CLIP_VISIBLE, opacity: 1 },
    { clipPath: CLIP_HIDDEN, opacity: 0 }
  ], { duration: durationMs, easing, fill: 'forwards' });
};

export const animateShapeRadiusToDetached = (tab, { durationMs, easing = 'ease' } = {}) => {
  const shape = resolveShape(tab);
  if (!shape) {
    return null;
  }

  return shape.animate(
    [{ borderRadius: RADIUS_ATTACHED }, { borderRadius: RADIUS_DETACHED }],
    { duration: durationMs, easing, fill: 'forwards' }
  );
};
