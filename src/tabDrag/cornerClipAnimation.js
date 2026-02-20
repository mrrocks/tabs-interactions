import { dragTransitionEasing } from './dragAnimationConfig';

const CORNER_WIDTH_PX = 12;
const TRANSLATE_HIDDEN_BEFORE = `translateX(${CORNER_WIDTH_PX}px)`;
const TRANSLATE_HIDDEN_AFTER = `translateX(-${CORNER_WIDTH_PX}px)`;
const TRANSLATE_VISIBLE = 'translateX(0)';
const RADIUS_ATTACHED = '12px 12px 0 0';
const RADIUS_DETACHED = '12px';
const BACKGROUND_SELECTOR = '.tab--background';

const resolveBackground = (tab) => {
  if (!tab || typeof tab.querySelector !== 'function') {
    return null;
  }
  const bg = tab.querySelector(BACKGROUND_SELECTOR);
  return bg && typeof bg.animate === 'function' ? bg : null;
};

const animatePseudo = (bg, pseudo, keyframes, options) => {
  try {
    return bg.animate(keyframes, { ...options, pseudoElement: pseudo });
  } catch {
    return null;
  }
};

export const animateCornerClipIn = (tab, { durationMs, easing = dragTransitionEasing, fill = 'none' } = {}) => {
  const bg = resolveBackground(tab);
  if (!bg) {
    return [];
  }

  const options = { duration: durationMs, easing, fill };
  return [
    animatePseudo(bg, '::before', [{ transform: TRANSLATE_HIDDEN_BEFORE, opacity: 0 }, { transform: TRANSLATE_VISIBLE, opacity: 1 }], options),
    animatePseudo(bg, '::after', [{ transform: TRANSLATE_HIDDEN_AFTER, opacity: 0 }, { transform: TRANSLATE_VISIBLE, opacity: 1 }], options)
  ].filter(Boolean);
};

export const animateCornerClipOut = (tab, { durationMs, easing = dragTransitionEasing } = {}) => {
  const bg = resolveBackground(tab);
  if (!bg) {
    return [];
  }

  const options = { duration: durationMs, easing, fill: 'forwards' };
  return [
    animatePseudo(bg, '::before', [{ transform: TRANSLATE_VISIBLE, opacity: 1 }, { transform: TRANSLATE_HIDDEN_BEFORE, opacity: 0 }], options),
    animatePseudo(bg, '::after', [{ transform: TRANSLATE_VISIBLE, opacity: 1 }, { transform: TRANSLATE_HIDDEN_AFTER, opacity: 0 }], options)
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
