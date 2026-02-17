import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultMotionSlowdownFactor,
  getMotionSlowdownFactor,
  initializeMotionSlowdownControl,
  motionSlowdownCssVariableName,
  motionSlowdownRange,
  normalizeMotionSlowdownFactor,
  scaleDurationMs,
  setMotionSlowdownFactor
} from './motionSpeed';

const createRootElement = (initialFactor = String(defaultMotionSlowdownFactor)) => {
  const styleValues = new Map([[motionSlowdownCssVariableName, initialFactor]]);

  return {
    style: {
      setProperty: (name, value) => {
        styleValues.set(name, String(value));
      },
      getPropertyValue: (name) => styleValues.get(name) ?? ''
    }
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeMotionSlowdownFactor', () => {
  it('clamps values to configured slowdown range', () => {
    expect(normalizeMotionSlowdownFactor('0.5')).toBe(motionSlowdownRange.min);
    expect(normalizeMotionSlowdownFactor('4.25')).toBe(4.25);
    expect(normalizeMotionSlowdownFactor('99')).toBe(motionSlowdownRange.max);
  });

  it('falls back to default for invalid values', () => {
    expect(normalizeMotionSlowdownFactor('')).toBe(defaultMotionSlowdownFactor);
    expect(normalizeMotionSlowdownFactor('fast')).toBe(defaultMotionSlowdownFactor);
  });
});

describe('scaleDurationMs', () => {
  it('scales positive durations by slowdown factor', () => {
    expect(scaleDurationMs(200, 2.5)).toBe(500);
  });

  it('returns zero for non-positive or invalid durations', () => {
    expect(scaleDurationMs(0, 4)).toBe(0);
    expect(scaleDurationMs(-100, 4)).toBe(0);
    expect(scaleDurationMs('invalid', 4)).toBe(0);
  });
});

describe('motion slowdown css variable sync', () => {
  it('writes and reads the root css slowdown variable', () => {
    const rootElement = createRootElement('1');
    const getComputedStyle = vi.fn().mockReturnValue({
      getPropertyValue: (name) => rootElement.style.getPropertyValue(name)
    });
    vi.stubGlobal('window', { getComputedStyle });

    expect(setMotionSlowdownFactor('3.2', rootElement)).toBe(3.2);
    expect(rootElement.style.getPropertyValue(motionSlowdownCssVariableName)).toBe('3.2');
    expect(getMotionSlowdownFactor(rootElement)).toBe(3.2);
  });
});

describe('initializeMotionSlowdownControl', () => {
  it('syncs slider value and updates root css variable', () => {
    const rootElement = createRootElement('1');
    const sliderAttributes = new Map();
    let onInput = null;

    const sliderElement = {
      value: '2.4',
      min: '',
      max: '',
      step: '',
      setAttribute: (name, value) => {
        sliderAttributes.set(name, String(value));
      },
      addEventListener: (eventName, listener) => {
        if (eventName === 'input') {
          onInput = listener;
        }
      }
    };

    const valueElement = {
      textContent: ''
    };

    const querySelector = vi.fn((selector) => {
      if (selector === '[data-motion-slider]') {
        return sliderElement;
      }

      if (selector === '[data-motion-value]') {
        return valueElement;
      }

      return null;
    });

    const getComputedStyle = vi.fn().mockReturnValue({
      getPropertyValue: (name) => rootElement.style.getPropertyValue(name)
    });

    vi.stubGlobal('window', { getComputedStyle });
    vi.stubGlobal('document', {
      documentElement: rootElement,
      querySelector
    });

    initializeMotionSlowdownControl();

    expect(rootElement.style.getPropertyValue(motionSlowdownCssVariableName)).toBe('2.4');
    expect(sliderElement.min).toBe(String(motionSlowdownRange.min));
    expect(sliderElement.max).toBe(String(motionSlowdownRange.max));
    expect(sliderElement.step).toBe(String(motionSlowdownRange.step));
    expect(sliderAttributes.get('aria-valuenow')).toBe('2.4');
    expect(valueElement.textContent).toBe('2.4x');

    sliderElement.value = '5';
    onInput();

    expect(rootElement.style.getPropertyValue(motionSlowdownCssVariableName)).toBe('5');
    expect(sliderAttributes.get('aria-valuenow')).toBe('5.0');
    expect(valueElement.textContent).toBe('5.0x');
  });
});
