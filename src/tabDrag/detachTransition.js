import { applyVerticalResistance } from './dragCalculations';
import { cubicBezier } from './dragAnimationConfig';

export const createDetachTransitionManager = ({ scaleDurationMs, transitionDurationMs }) => {
  let correctionY = 0;
  let startTime = 0;
  let durationMs = 0;
  let active = false;

  const activate = (rawDeltaY) => {
    correctionY = applyVerticalResistance(rawDeltaY) - rawDeltaY;
    durationMs = scaleDurationMs(transitionDurationMs);
    startTime = performance.now();
    active = true;
  };

  const sample = () => {
    if (!active) {
      return 0;
    }

    const progress = Math.min((performance.now() - startTime) / durationMs, 1);

    if (progress >= 1) {
      active = false;
      return 0;
    }

    return correctionY * (1 - cubicBezier(progress));
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
