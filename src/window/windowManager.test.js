import { describe, expect, it, vi } from 'vitest';
import {
  computeFrameFromTabAnchor,
  moveTabToList,
  removeDetachedWindowIfEmpty
} from './windowManager';

describe('computeFrameFromTabAnchor', () => {
  it('positions panel so tab slot aligns with the tab screen rect', () => {
    expect(
      computeFrameFromTabAnchor({
        tabScreenRect: { left: 250, top: 200, width: 140, height: 36 },
        tabOffsetInPanel: { x: 90, y: 8 },
        panelWidth: 300,
        panelHeight: 180
      })
    ).toEqual({
      width: 300,
      height: 180,
      left: 160,
      top: 192
    });
  });

  it('allows panel to extend beyond the viewport', () => {
    expect(
      computeFrameFromTabAnchor({
        tabScreenRect: { left: 30, top: 5, width: 140, height: 36 },
        tabOffsetInPanel: { x: 90, y: 8 },
        panelWidth: 300,
        panelHeight: 180
      })
    ).toEqual({
      width: 300,
      height: 180,
      left: -60,
      top: -3
    });
  });
});

describe('moveTabToList', () => {
  it('moves a tab before provided reference node', () => {
    const insertBefore = vi.fn();
    const tabList = {
      insertBefore,
      querySelector: () => null
    };
    const tab = { id: 'tab-a' };
    const referenceNode = { id: 'tab-b' };

    moveTabToList({ tab, tabList, beforeNode: referenceNode });

    expect(insertBefore).toHaveBeenCalledWith(tab, referenceNode);
  });
});

describe('removeDetachedWindowIfEmpty', () => {
  it('removes detached panel when no tabs remain', () => {
    const remove = vi.fn();
    const tabList = {
      querySelectorAll: () => []
    };
    const panel = {
      querySelector: (selector) => (selector === '.tab--list' ? tabList : null),
      remove
    };

    expect(removeDetachedWindowIfEmpty(panel)).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('keeps detached panel when tab list still has tabs', () => {
    const remove = vi.fn();
    const tabList = {
      querySelectorAll: () => [{ id: 'tab-a' }]
    };
    const panel = {
      querySelector: (selector) => (selector === '.tab--list' ? tabList : null),
      remove
    };

    expect(removeDetachedWindowIfEmpty(panel)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
