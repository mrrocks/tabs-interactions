import { describe, expect, it, vi } from 'vitest';
import {
  computeDetachedPanelFrame,
  moveTabToList,
  removeDetachedWindowIfEmpty
} from './windowManager';

describe('computeDetachedPanelFrame', () => {
  it('positions detached panel near pointer and keeps it in viewport', () => {
    expect(
      computeDetachedPanelFrame({
        pointerClientX: 620,
        pointerClientY: 420,
        panelWidth: 300,
        panelHeight: 180,
        viewportWidth: 700,
        viewportHeight: 500,
        anchorOffsetX: 180,
        anchorOffsetY: 20
      })
    ).toEqual({
      width: 300,
      height: 180,
      left: 400,
      top: 320
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
