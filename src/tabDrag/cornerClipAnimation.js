const CORNER_WIDTH_PX = 12;
const TRANSLATE_HIDDEN_BEFORE = `translateX(${CORNER_WIDTH_PX}px)`;
const TRANSLATE_HIDDEN_AFTER = `translateX(-${CORNER_WIDTH_PX}px)`;
const TRANSLATE_VISIBLE = 'translateX(0)';
const RADIUS_ATTACHED = '12px 12px 0 0';
const RADIUS_DETACHED = '12px';
const SHAPE_SELECTOR = '.tab--shape';

const resolveShape = (tab) => {
  if (!tab || typeof tab.querySelector !== 'function') {
    return null;
  }
  const shape = tab.querySelector(SHAPE_SELECTOR);
  return shape && typeof shape.animate === 'function' ? shape : null;
};

const animatePseudo = (shape, pseudo, keyframes, options) => {
  try {
    return shape.animate(keyframes, { ...options, pseudoElement: pseudo });
  } catch {
    return null;
  }
};

export const animateCornerClipIn = (tab, { durationMs, easing = 'ease' } = {}) => {
  const shape = resolveShape(tab);
  if (!shape) {
    return [];
  }

  const options = { duration: durationMs, easing, fill: 'none' };
  return [
    animatePseudo(shape, '::before', [{ transform: TRANSLATE_HIDDEN_BEFORE }, { transform: TRANSLATE_VISIBLE }], options),
    animatePseudo(shape, '::after', [{ transform: TRANSLATE_HIDDEN_AFTER }, { transform: TRANSLATE_VISIBLE }], options)
  ].filter(Boolean);
};

export const animateCornerClipOut = (tab, { durationMs, easing = 'ease' } = {}) => {
  const shape = resolveShape(tab);
  if (!shape) {
    return [];
  }

  const options = { duration: durationMs, easing, fill: 'forwards' };
  return [
    animatePseudo(shape, '::before', [{ transform: TRANSLATE_VISIBLE, opacity: 1 }, { transform: TRANSLATE_HIDDEN_BEFORE, opacity: 0 }], options),
    animatePseudo(shape, '::after', [{ transform: TRANSLATE_VISIBLE, opacity: 1 }, { transform: TRANSLATE_HIDDEN_AFTER, opacity: 0 }], options)
  ].filter(Boolean);
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

export const animateShapeRadiusToAttached = (tab, { durationMs, easing = 'ease' } = {}) => {
  const shape = resolveShape(tab);
  if (!shape) {
    return null;
  }

  return shape.animate(
    [{ borderRadius: RADIUS_DETACHED }, { borderRadius: RADIUS_ATTACHED }],
    { duration: durationMs, easing, fill: 'none' }
  );
};
