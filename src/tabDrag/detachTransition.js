import { applyResistance } from './dragCalculations';
import { cubicBezier } from './dragAnimationConfig';

const zeroSample = { x: 0, y: 0 };

export const createDetachTransitionManager = ({ scaleDurationMs, transitionDurationMs }) => {
  let correctionX = 0;
  let correctionY = 0;
  let startTime = 0;
  let durationMs = 0;
  let active = false;

  const activate = ({ overshootX, overshootY }) => {
    correctionX = applyResistance(overshootX) - overshootX;
    correctionY = applyResistance(overshootY) - overshootY;
    durationMs = scaleDurationMs(transitionDurationMs);
    startTime = performance.now();
    active = true;
  };

  const sample = () => {
    if (!active) {
      return zeroSample;
    }

    const progress = Math.min((performance.now() - startTime) / durationMs, 1);

    if (progress >= 1) {
      active = false;
      return zeroSample;
    }

    const decay = 1 - cubicBezier(progress);
    return { x: correctionX * decay, y: correctionY * decay };
  };

  const reset = () => {
    active = false;
  };

  return {
    get active() { return active; },
    activate,
    sample,
    reset
  };
};
