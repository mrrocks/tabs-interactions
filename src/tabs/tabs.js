import { isEventTargetElement } from '../shared/dom';
import { tabListSelector, tabItemSelector, tabCloseSelector } from '../shared/selectors';
import {
  activeTabClassName,
  getInitialActiveIndex,
  getTabActivationState,
  inactiveTabClassName
} from './tabState';
import { consumeDragCompleted } from './tabDragSignal';
import { initializeTabLifecycle } from './tabCreation';
import { observeTabCompression } from './tabCompression';
import { initializeTabContextMenu } from './tabContextMenu';

export { tabListSelector };
export const tabSelector = tabItemSelector;
const initializedTabLists = new WeakSet();

const sampleTabContents = [
  { domain: 'starbucks.com', label: 'Starbucks Coffee Company', icon: 'https://www.starbucks.com/weblx/images/favicons/favicon-32x32.png' },
  { domain: 'google.com', label: 'Google', icon: 'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png' },
  { domain: 'facebook.com', label: 'Facebook - Log In or Sign Up', icon: 'https://static.xx.fbcdn.net/rsrc.php/v3/y0/r/eFHSyHqJbYw.png' },
  { domain: 'bsky.app', label: 'Bluesky', icon: 'https://bsky.app/static/favicon-32x32.png' },
  { domain: 'netflix.com', label: 'Netflix', icon: 'https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2016.png' },
  { domain: 'amazon.com', label: 'Amazon.com', icon: 'https://www.amazon.com/favicon.ico' },
  { domain: 'github.com', label: 'GitHub: Let\'s build from here', icon: 'https://github.githubassets.com/favicons/favicon.png' },
  { domain: 'nytimes.com', label: 'The New York Times - Breaking News, US News, World News and Videos', icon: 'https://www.nytimes.com/vi-assets/static-assets/apple-touch-icon-319373aaf4524d94d38aa599c56b8655.png' },
  { domain: 'youtube.com', label: 'YouTube', icon: 'https://www.youtube.com/s/desktop/177093bc/img/favicon_144x144.png' },
  { domain: 'linkedin.com', label: 'LinkedIn: Log In or Sign Up', icon: 'https://static.licdn.com/aero-v1/sc/h/al2o9zrvru7aqj8e1x2rzsrca' },
  { domain: 'duckduckgo.com', label: 'DuckDuckGo — Privacy, simplified.', icon: 'https://duckduckgo.com/favicon.ico' }
];

const getFallbackIconUrl = (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
const getIconUrl = (content) => content.icon || getFallbackIconUrl(content.domain);

// Eagerly preload all images so they are immediately available from browser cache on reload
if (typeof Image !== 'undefined') {
  sampleTabContents.forEach((content) => {
    const img = new Image();
    img.src = getIconUrl(content);
  });
}

const getUsedLabels = (excludeTab) => {
  if (typeof document === 'undefined') {
    return new Set();
  }

  return new Set(
    Array.from(document.querySelectorAll(tabSelector))
      .filter((t) => t !== excludeTab)
      .map((t) => t.querySelector('.tab--label')?.textContent)
      .filter((label) => label != null)
  );
};

export const randomizeTabContent = (tab) => {
  const usedLabels = getUsedLabels(tab);

  const availableContents = sampleTabContents.filter((c) => !usedLabels.has(c.label));
  const pool = availableContents.length > 0 ? availableContents : sampleTabContents;
  const content = pool[Math.floor(Math.random() * pool.length)];

  const faviconElement = tab.querySelector('.tab--favicon');
  const labelElement = tab.querySelector('.tab--label');

  if (faviconElement) {
    const iconUrl = getIconUrl(content);
    const setBackground = (url) => {
      faviconElement.style.background = `url('${url}') center / contain no-repeat transparent`;
    };

    faviconElement.textContent = '';
    setBackground(iconUrl);

    if (content.icon) {
      const img = new Image();
      img.onload = () => setBackground(iconUrl);
      img.onerror = () => setBackground(getFallbackIconUrl(content.domain));
      img.src = iconUrl;
    }
  }

  if (labelElement) {
    labelElement.textContent = content.label;
  }
};

export const getTabs = (tabList) => Array.from(tabList.querySelectorAll(tabSelector));

export const getActiveTabIndex = (tabList) =>
  getTabs(tabList).findIndex((tab) => tab.classList.contains(activeTabClassName));

const closeSuppressedClassName = 'tab--close-suppressed';
const narrowClassName = 'tab--narrow';

const suppressCloseUntilLeave = (tab) => {
  if (!tab.matches(':hover')) return;
  tab.classList.add(closeSuppressedClassName);
  tab.addEventListener('pointerleave', () => {
    tab.classList.remove(closeSuppressedClassName);
  }, { once: true });
};

export const setActiveTab = (tabList, tabIndex, shouldFocus = false) => {
  const tabs = getTabs(tabList);

  if (tabs.length === 0) {
    return;
  }

  const nextState = getTabActivationState(tabs.length, tabIndex);
  let activeTab = null;

  tabs.forEach((tab, index) => {
    const state = nextState[index];
    const wasInactive = tab.classList.contains(inactiveTabClassName);
    tab.classList.remove(activeTabClassName, inactiveTabClassName);
    tab.classList.add(state.stateClassName);
    tab.setAttribute('aria-selected', state.selected ? 'true' : 'false');
    tab.tabIndex = state.tabIndex;
    if (state.selected) {
      activeTab = tab;
      if (wasInactive && tab.classList.contains(narrowClassName)) {
        suppressCloseUntilLeave(tab);
      }
    }
  });

  if (shouldFocus && activeTab) {
    activeTab.focus();
  }
};

const initializeTabListState = (tabList) => {
  const tabs = getTabs(tabList);

  if (tabs.length === 0) {
    return;
  }

  tabs.forEach((tab) => {
    randomizeTabContent(tab);
    observeTabCompression(tab);
  });

  const initialActiveIndex = getInitialActiveIndex(
    tabs.map((tab) => tab.classList.contains(activeTabClassName))
  );

  setActiveTab(tabList, initialActiveIndex);
};

const onTabListClick = (tabList, event) => {
  if (consumeDragCompleted()) {
    return;
  }

  if (!isEventTargetElement(event.target)) {
    return;
  }

  if (event.target.closest(tabCloseSelector)) {
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
};

export const initializeTabList = (tabList) => {
  if (!tabList || initializedTabLists.has(tabList)) {
    return false;
  }

  initializedTabLists.add(tabList);
  initializeTabListState(tabList);
  initializeTabLifecycle(tabList);
  initializeTabContextMenu(tabList);
  tabList.addEventListener('click', (event) => {
    onTabListClick(tabList, event);
  });

  return true;
};

const queryTabLists = (root) => {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return [];
  }

  return Array.from(root.querySelectorAll(tabListSelector));
};

export const initializeTabs = (root = document) => {
  const tabLists = queryTabLists(root);

  tabLists.forEach((tabList) => {
    initializeTabList(tabList);
  });

  return tabLists;
};
