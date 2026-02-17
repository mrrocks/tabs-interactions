import {
  activeTabClassName,
  getArrowTargetIndex,
  getInitialActiveIndex,
  getTabActivationState,
  inactiveTabClassName
} from './tabState';

export const tabListSelector = '.tab--list';
export const tabSelector = '.tab--item';

const closeButtonSelector = '.tab--close';

const getTabs = (tabList) => Array.from(tabList.querySelectorAll(tabSelector));

const isEventTargetElement = (target) =>
  Boolean(target) && typeof target === 'object' && typeof target.closest === 'function';

export const setActiveTab = (tabList, tabIndex, shouldFocus = false) => {
  const tabs = getTabs(tabList);

  if (tabs.length === 0) {
    return;
  }

  const nextState = getTabActivationState(tabs.length, tabIndex);
  let activeTab = null;

  tabs.forEach((tab, index) => {
    const state = nextState[index];
    tab.classList.remove(activeTabClassName, inactiveTabClassName);
    tab.classList.add(state.stateClassName);
    tab.setAttribute('aria-selected', state.selected ? 'true' : 'false');
    tab.tabIndex = state.tabIndex;
    if (state.selected) {
      activeTab = tab;
    }
  });

  if (shouldFocus && activeTab) {
    activeTab.focus();
  }
};

export const initializeTabs = () => {
  const tabList = document.querySelector(tabListSelector);

  if (!tabList) {
    return;
  }

  const tabs = getTabs(tabList);

  if (tabs.length === 0) {
    return;
  }

  const initialActiveIndex = getInitialActiveIndex(
    tabs.map((tab) => tab.classList.contains(activeTabClassName))
  );

  setActiveTab(tabList, initialActiveIndex);

  tabList.addEventListener('click', (event) => {
    if (!isEventTargetElement(event.target)) {
      return;
    }

    if (event.target.closest(closeButtonSelector)) {
      return;
    }

    const tab = event.target.closest(tabSelector);

    if (!tab || !tabList.contains(tab)) {
      return;
    }

    const tabIndex = getTabs(tabList).indexOf(tab);

    if (tabIndex === -1) {
      return;
    }

    setActiveTab(tabList, tabIndex);
  });

  tabList.addEventListener('keydown', (event) => {
    if (!isEventTargetElement(event.target)) {
      return;
    }

    const tab = event.target.closest(tabSelector);

    if (!tab || !tabList.contains(tab)) {
      return;
    }

    const tabsList = getTabs(tabList);
    const tabIndex = tabsList.indexOf(tab);

    if (tabIndex === -1) {
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const nextIndex = getArrowTargetIndex({
        currentIndex: tabIndex,
        key: event.key,
        tabCount: tabsList.length
      });
      setActiveTab(tabList, nextIndex, true);
      return;
    }

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setActiveTab(tabList, tabIndex, true);
    }
  });
};
