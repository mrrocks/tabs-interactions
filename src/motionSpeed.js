export const motionSlowdownCssVariableName = '--motion-slowdown-factor';
export const defaultMotionSlowdownFactor = 1;

export const motionSlowdownRange = Object.freeze({
  min: 1,
  max: 6,
  step: 0.1
});

const motionSliderSelector = '[data-motion-slider]';
const motionValueSelector = '[data-motion-value]';

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const toFiniteNumber = (value) => {
  const parsedValue = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

export const normalizeMotionSlowdownFactor = (value) => {
  const parsedValue = toFiniteNumber(value);

  if (parsedValue === null) {
    return defaultMotionSlowdownFactor;
  }

  return clamp(parsedValue, motionSlowdownRange.min, motionSlowdownRange.max);
};

const getRootElement = () => {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.documentElement;
};

export const setMotionSlowdownFactor = (value, rootElement = getRootElement()) => {
  const normalizedFactor = normalizeMotionSlowdownFactor(value);

  if (rootElement) {
    rootElement.style.setProperty(motionSlowdownCssVariableName, String(normalizedFactor));
  }

  return normalizedFactor;
};

export const getMotionSlowdownFactor = (rootElement = getRootElement()) => {
  if (!rootElement) {
    return defaultMotionSlowdownFactor;
  }

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const rawFactor = window.getComputedStyle(rootElement).getPropertyValue(motionSlowdownCssVariableName);
    return normalizeMotionSlowdownFactor(rawFactor);
  }

  const rawFactor = rootElement.style.getPropertyValue(motionSlowdownCssVariableName);
  return normalizeMotionSlowdownFactor(rawFactor);
};

export const scaleDurationMs = (durationMs, slowdownFactor = getMotionSlowdownFactor()) => {
  const parsedDuration = Number(durationMs);

  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    return 0;
  }

  return parsedDuration * normalizeMotionSlowdownFactor(slowdownFactor);
};

const isSliderControl = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  'value' in value &&
  typeof value.addEventListener === 'function';

const formatSlowdownLabel = (factor) => `${factor.toFixed(1)}x`;

const syncSliderAccessibility = (sliderElement, factor) => {
  sliderElement.setAttribute('aria-valuemin', String(motionSlowdownRange.min));
  sliderElement.setAttribute('aria-valuemax', String(motionSlowdownRange.max));
  sliderElement.setAttribute('aria-valuenow', factor.toFixed(1));
};

export const initializeMotionSlowdownControl = () => {
  const rootElement = getRootElement();

  if (!rootElement || typeof document === 'undefined') {
    return;
  }

  const sliderElement = document.querySelector(motionSliderSelector);
  const valueElement = document.querySelector(motionValueSelector);

  let initialFactor = getMotionSlowdownFactor(rootElement);

  if (isSliderControl(sliderElement)) {
    sliderElement.min = String(motionSlowdownRange.min);
    sliderElement.max = String(motionSlowdownRange.max);
    sliderElement.step = String(motionSlowdownRange.step);
    initialFactor = normalizeMotionSlowdownFactor(sliderElement.value || initialFactor);
    sliderElement.value = initialFactor.toFixed(1);
    syncSliderAccessibility(sliderElement, initialFactor);
  }

  const appliedFactor = setMotionSlowdownFactor(initialFactor, rootElement);

  if (valueElement) {
    valueElement.textContent = formatSlowdownLabel(appliedFactor);
  }

  if (!isSliderControl(sliderElement)) {
    return;
  }

  sliderElement.addEventListener('input', () => {
    const nextFactor = setMotionSlowdownFactor(sliderElement.value, rootElement);
    sliderElement.value = nextFactor.toFixed(1);
    syncSliderAccessibility(sliderElement, nextFactor);

    if (valueElement) {
      valueElement.textContent = formatSlowdownLabel(nextFactor);
    }
  });
};
