import { getArrowTargetIndex, getInitialActiveIndex, getTabActivationState } from './tabState';

const getTabs = (tabList) => Array.from(tabList.querySelectorAll('[role="tab"]'));

const setActiveTab = (tabList, tabIndex, shouldFocus = false) => {
  const tabs = getTabs(tabList);

  if (tabs.length === 0) {
    return;
  }

  const nextState = getTabActivationState(tabs.length, tabIndex);
  let activeTab = null;

  tabs.forEach((tab, index) => {
    const state = nextState[index];
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
  const tabList = document.querySelector('.tabs-container[role="tablist"]');

  if (!tabList) {
    return;
  }

  const tabs = getTabs(tabList);

  if (tabs.length === 0) {
    return;
  }

  const initialActiveIndex = getInitialActiveIndex(
    tabs.map((tab) => tab.getAttribute('aria-selected') === 'true')
  );

  setActiveTab(tabList, initialActiveIndex);

  tabList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (event.target.closest('.close')) {
      return;
    }

    const tab = event.target.closest('[role="tab"]');

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
    if (!(event.target instanceof Element)) {
      return;
    }

    const tab = event.target.closest('[role="tab"]');

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
