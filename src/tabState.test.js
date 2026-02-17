import { describe, expect, it } from 'vitest';
import { getArrowTargetIndex, getInitialActiveIndex, getTabActivationState } from './tabState';

describe('getInitialActiveIndex', () => {
  it('returns the first selected index when multiple tabs are marked active', () => {
    expect(getInitialActiveIndex([true, true, false])).toBe(0);
  });

  it('falls back to the first tab when no tab is selected', () => {
    expect(getInitialActiveIndex([false, false, false])).toBe(0);
  });
});

describe('getTabActivationState', () => {
  it('produces a single active tab with roving tabindex', () => {
    expect(getTabActivationState(3, 1)).toEqual([
      { selected: false, tabIndex: -1 },
      { selected: true, tabIndex: 0 },
      { selected: false, tabIndex: -1 }
    ]);
  });

  it('clamps activation index to a valid tab', () => {
    expect(getTabActivationState(2, 9)).toEqual([
      { selected: false, tabIndex: -1 },
      { selected: true, tabIndex: 0 }
    ]);
  });
});

describe('getArrowTargetIndex', () => {
  it('wraps around for left and right arrow navigation', () => {
    expect(getArrowTargetIndex({ currentIndex: 0, key: 'ArrowLeft', tabCount: 3 })).toBe(2);
    expect(getArrowTargetIndex({ currentIndex: 2, key: 'ArrowRight', tabCount: 3 })).toBe(0);
  });
});
