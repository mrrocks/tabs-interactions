import { describe, expect, it, vi } from 'vitest';
import { closeWindowControlSelector, initializeWindowControls, removePanel } from './windowControls';

describe('removePanel', () => {
  it('removes panel through panel.remove when available', () => {
    const remove = vi.fn();
    const panel = { remove };

    expect(removePanel(panel)).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('removes panel through parentNode.removeChild fallback', () => {
    const removeChild = vi.fn();
    const panel = {
      parentNode: { removeChild }
    };

    expect(removePanel(panel)).toBe(true);
    expect(removeChild).toHaveBeenCalledWith(panel);
  });
});

describe('initializeWindowControls', () => {
  it('closes the clicked panel from close control', () => {
    let clickListener = null;
    const root = {
      addEventListener: (eventName, listener) => {
        if (eventName === 'click') {
          clickListener = listener;
        }
      }
    };
    const remove = vi.fn();
    const panel = { remove };
    const closeControl = {
      closest: (selector) => {
        if (selector === '.browser') {
          return panel;
        }
        return null;
      }
    };
    const target = {
      closest: (selector) => {
        if (selector === closeWindowControlSelector) {
          return closeControl;
        }
        return null;
      }
    };
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    expect(initializeWindowControls(root)).toBe(true);
    clickListener({ target, preventDefault, stopPropagation });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});
