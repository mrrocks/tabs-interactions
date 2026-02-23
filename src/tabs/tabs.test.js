import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeTabClassName, inactiveTabClassName } from './tabState';
import { initializeTabs, setActiveTab, tabListSelector, tabSelector } from './tabs';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

const createClassList = (initialClassNames = []) => {
  const classNames = new Set(initialClassNames);

  return {
    add: (...tokens) => {
      tokens.forEach((token) => classNames.add(token));
    },
    remove: (...tokens) => {
      tokens.forEach((token) => classNames.delete(token));
    },
    contains: (token) => classNames.has(token)
  };
};

const createTab = ({ classNames = [], selected = false } = {}) => {
  const attributes = new Map([['aria-selected', selected ? 'true' : 'false']]);
  const classList = createClassList(classNames);
  const tab = {
    classList,
    tabIndex: selected ? 0 : -1,
    focused: false,
    style: {},
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    focus: () => {
      tab.focused = true;
    },
    closest: (selector) => (selector === tabSelector ? tab : null),
    querySelector: () => null
  };

  return tab;
};

const createTabList = (tabs) => {
  const listeners = new Map();

  return {
    querySelectorAll: (selector) => (selector === tabSelector ? tabs : []),
    addEventListener: (eventName, listener) => {
      listeners.set(eventName, listener);
    },
    contains: (node) => tabs.includes(node),
    dispatch: (eventName, event) => {
      const listener = listeners.get(eventName);
      if (listener) {
        listener(event);
      }
    }
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initializeTabs selectors', () => {
  it('queries tab list using data hook selector', () => {
    const querySelectorAll = vi.fn().mockReturnValue([]);
    vi.stubGlobal('document', { querySelectorAll });

    initializeTabs();

    expect(querySelectorAll).toHaveBeenCalledWith(tabListSelector);
  });

  it('initializes every tab list found by querySelectorAll', () => {
    const firstListFirstTab = createTab({ classNames: [activeTabClassName], selected: true });
    const firstListSecondTab = createTab({ classNames: [inactiveTabClassName], selected: false });
    const secondListFirstTab = createTab({ classNames: [inactiveTabClassName], selected: false });
    const secondListSecondTab = createTab({ classNames: [activeTabClassName], selected: true });
    const firstTabList = createTabList([firstListFirstTab, firstListSecondTab]);
    const secondTabList = createTabList([secondListFirstTab, secondListSecondTab]);

    vi.stubGlobal('document', {
      querySelectorAll: (selector) => {
        if (selector === tabListSelector) return [firstTabList, secondTabList];
        return [];
      }
    });

    initializeTabs();

    expect(firstListFirstTab.classList.contains(activeTabClassName)).toBe(true);
    expect(secondListSecondTab.classList.contains(activeTabClassName)).toBe(true);

    secondTabList.dispatch('click', { target: secondListFirstTab });

    expect(secondListFirstTab.classList.contains(activeTabClassName)).toBe(true);
    expect(secondListSecondTab.classList.contains(inactiveTabClassName)).toBe(true);
    expect(firstListFirstTab.classList.contains(activeTabClassName)).toBe(true);
  });
});

describe('setActiveTab', () => {
  it('synchronizes classes, aria-selected, and tabindex', () => {
    const firstTab = createTab({ classNames: [activeTabClassName], selected: true });
    const secondTab = createTab({ classNames: [inactiveTabClassName], selected: false });
    const tabList = createTabList([firstTab, secondTab]);

    setActiveTab(tabList, 1);

    expect(firstTab.classList.contains(activeTabClassName)).toBe(false);
    expect(firstTab.classList.contains(inactiveTabClassName)).toBe(true);
    expect(firstTab.getAttribute('aria-selected')).toBe('false');
    expect(firstTab.tabIndex).toBe(-1);

    expect(secondTab.classList.contains(activeTabClassName)).toBe(true);
    expect(secondTab.classList.contains(inactiveTabClassName)).toBe(false);
    expect(secondTab.getAttribute('aria-selected')).toBe('true');
    expect(secondTab.tabIndex).toBe(0);
  });
});

describe('initializeTabs activation', () => {
  it('uses active class as initial source of truth', () => {
    const firstTab = createTab({ classNames: [inactiveTabClassName], selected: true });
    const secondTab = createTab({ classNames: [activeTabClassName], selected: false });
    const tabList = createTabList([firstTab, secondTab]);
    vi.stubGlobal('document', {
      querySelectorAll: (selector) => (selector === tabListSelector ? [tabList] : [])
    });

    initializeTabs();

    expect(firstTab.classList.contains(activeTabClassName)).toBe(false);
    expect(firstTab.getAttribute('aria-selected')).toBe('false');
    expect(secondTab.classList.contains(activeTabClassName)).toBe(true);
    expect(secondTab.getAttribute('aria-selected')).toBe('true');
  });

  it('updates class and aria state on click activation', () => {
    const firstTab = createTab({ classNames: [activeTabClassName], selected: true });
    const secondTab = createTab({ classNames: [inactiveTabClassName], selected: false });
    const tabList = createTabList([firstTab, secondTab]);
    vi.stubGlobal('document', {
      querySelectorAll: (selector) => (selector === tabListSelector ? [tabList] : [])
    });

    initializeTabs();
    tabList.dispatch('click', { target: secondTab });

    expect(secondTab.classList.contains(activeTabClassName)).toBe(true);
    expect(secondTab.getAttribute('aria-selected')).toBe('true');
    expect(firstTab.classList.contains(inactiveTabClassName)).toBe(true);
    expect(firstTab.getAttribute('aria-selected')).toBe('false');
  });
});
