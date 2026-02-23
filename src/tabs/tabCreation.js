import { scaleDurationMs } from '../motion/motionSpeed';
import { tabAddSelector, tabCloseSelector, panelSelector } from '../shared/selectors';
import { activeTabClassName, inactiveTabClassName } from './tabState';
import { randomizeTabContent, setActiveTab, getTabs, getActiveTabIndex, tabSelector } from './tabs';
import { animatedRemovePanel } from '../window/windowManager';
import { isEventTargetElement } from '../shared/dom';
import { observeTabCompression, unobserveTabCompression } from './tabCompression';
import { isPinned } from './tabPinning';
const noTransitionClassName = 'tab--no-transition';
const baseDurationMs = 250;
const animationEasing = 'ease';
const maskFadePx = 80;
const maskGradient = 'linear-gradient(to right, black calc(100% - var(--creation-reveal-size)), transparent 100%)';
const maskFadeRatio = 0.3;

const closingTabs = new WeakSet();

const createContentWrapper = () => {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '8px';
  wrapper.style.flex = '1 1 auto';
  wrapper.style.minWidth = '0';
  wrapper.style.overflow = 'hidden';
  return wrapper;
};

const createTabElement = () => {
  const tab = document.createElement('div');
  tab.className = 'tab--item';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');
  tab.tabIndex = -1;

  const background = document.createElement('span');
  background.className = 'tab--background';
  background.setAttribute('aria-hidden', 'true');
  background.innerHTML =
    '<svg class="tab--corner tab--corner-left" width="12" height="12" viewBox="0 0 12 12"><path d="M0 12h12V0C12 6.627 6.627 12 0 12Z" fill="currentColor"/></svg>' +
    '<svg class="tab--corner tab--corner-right" width="12" height="12" viewBox="0 0 12 12"><path d="M12 12H0V0C0 6.627 5.373 12 12 12Z" fill="currentColor"/></svg>';

  const wrapper = createContentWrapper();

  const favicon = document.createElement('span');
  favicon.className = 'tab--favicon';
  favicon.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'tab--label';

  wrapper.append(favicon, label);

  const close = document.createElement('button');
  close.className = 'tab--close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close tab');

  tab.append(background, wrapper, close);
  return { tab, wrapper };
};

const ensureContentWrapper = (tab) => {
  const favicon = tab.querySelector('.tab--favicon');
  if (favicon && favicon.parentElement !== tab) {
    const existing = favicon.parentElement;
    existing.style.overflow = 'hidden';
    return existing;
  }

  const wrapper = createContentWrapper();
  const label = tab.querySelector('.tab--label');
  const close = tab.querySelector(tabCloseSelector);

  if (favicon) wrapper.appendChild(favicon);
  if (label) wrapper.appendChild(label);

  tab.insertBefore(wrapper, close);
  return wrapper;
};

const constrainToZero = (tab) => {
  tab.style.minWidth = '0px';
  tab.style.maxWidth = '0px';
  tab.style.paddingLeft = '0px';
  tab.style.paddingRight = '0px';
};

const releaseSizeConstraints = (tab) => {
  tab.style.minWidth = '';
  tab.style.maxWidth = '';
  tab.style.paddingLeft = '';
  tab.style.paddingRight = '';
};

const measureNaturalWidth = (tab) => {
  releaseSizeConstraints(tab);

  const tabWidth = tab.getBoundingClientRect().width;
  const computed = getComputedStyle(tab);
  const paddingLeft = computed.paddingLeft;
  const paddingRight = computed.paddingRight;

  constrainToZero(tab);

  return { tabWidth, paddingLeft, paddingRight };
};

const applyMask = (el) => {
  el.style.maskImage = maskGradient;
  el.style.webkitMaskImage = maskGradient;
};

const clearMask = (el) => {
  el.style.maskImage = '';
  el.style.webkitMaskImage = '';
  el.style.removeProperty('--creation-reveal-size');
};

const animateTabOpen = (tab, wrapper) => {
  const { tabWidth, paddingLeft, paddingRight } = measureNaturalWidth(tab);
  if (tabWidth <= 0) {
    releaseSizeConstraints(tab);
    tab.classList.remove(noTransitionClassName);
    return;
  }

  wrapper.style.setProperty('--creation-reveal-size', `${maskFadePx}px`);
  applyMask(wrapper);

  const duration = scaleDurationMs(baseDurationMs);

  const widthAnim = tab.animate([
    { minWidth: '0px', maxWidth: '0px', paddingLeft: '0px', paddingRight: '0px' },
    { minWidth: `${tabWidth}px`, maxWidth: `${tabWidth}px`, paddingLeft, paddingRight }
  ], { duration, easing: animationEasing, fill: 'forwards' });

  wrapper.animate([
    { '--creation-reveal-size': `${maskFadePx}px` },
    { '--creation-reveal-size': '0px' }
  ], {
    duration: duration * maskFadeRatio,
    delay: duration * (1 - maskFadeRatio),
    easing: animationEasing,
    fill: 'forwards'
  });

  const bg = tab.querySelector('.tab--background');
  bg.animate([
    { opacity: 0 },
    { opacity: 1 }
  ], { duration, easing: animationEasing });

  const closeBtn = tab.querySelector(tabCloseSelector);
  const closeAnim = closeBtn?.animate([
    { opacity: 0, transform: 'translateY(-50%) scale(0.8)' },
    { opacity: 1, transform: 'translateY(-50%) scale(1)' }
  ], { duration: duration * 0.7, easing: animationEasing, delay: duration * 0.3, fill: 'both' });

  widthAnim.addEventListener('finish', () => {
    releaseSizeConstraints(tab);
    clearMask(wrapper);
    tab.classList.remove(noTransitionClassName);
    closeAnim?.cancel();
    widthAnim.cancel();
  });
};

const addTab = (tabList) => {
  const addButton = tabList.querySelector(tabAddSelector);
  if (!addButton) return;

  const { tab, wrapper } = createTabElement();

  const currentTabs = getTabs(tabList);
  const activeIndex = getActiveTabIndex(tabList);
  const insertBeforeNode = activeIndex >= 0 && activeIndex < currentTabs.length - 1
    ? currentTabs[activeIndex + 1]
    : addButton;
  tabList.insertBefore(tab, insertBeforeNode);

  const faviconReady = randomizeTabContent(tab);
  observeTabCompression(tab);
  constrainToZero(tab);

  tab.classList.add(noTransitionClassName);
  const tabs = getTabs(tabList);
  setActiveTab(tabList, tabs.indexOf(tab));

  if (faviconReady) {
    faviconReady.then(() => animateTabOpen(tab, wrapper));
  } else {
    animateTabOpen(tab, wrapper);
  }
};

const closeTab = (tabList, tab) => {
  if (closingTabs.has(tab)) return;
  if (isPinned(tab)) return;

  const tabs = getTabs(tabList);

  if (tabs.length <= 1) {
    const panel = tabList.closest(panelSelector);
    if (panel) {
      animatedRemovePanel(panel, { anchor: tab.querySelector(tabCloseSelector) });
    }
    return;
  }

  closingTabs.add(tab);
  const closingIndex = tabs.indexOf(tab);
  const wasActive = tab.classList.contains(activeTabClassName);

  if (wasActive) {
    const nextIndex = closingIndex < tabs.length - 1 ? closingIndex + 1 : closingIndex - 1;
    setActiveTab(tabList, nextIndex);
    tab.classList.remove(inactiveTabClassName);
    tab.classList.add(activeTabClassName);
  }

  const wrapper = ensureContentWrapper(tab);

  const currentTabWidth = tab.getBoundingClientRect().width;
  const computed = getComputedStyle(tab);
  const currentPaddingLeft = computed.paddingLeft;
  const currentPaddingRight = computed.paddingRight;

  tab.style.pointerEvents = 'none';
  applyMask(wrapper);

  const duration = scaleDurationMs(baseDurationMs);

  const widthAnim = tab.animate([
    { minWidth: `${currentTabWidth}px`, maxWidth: `${currentTabWidth}px`, paddingLeft: currentPaddingLeft, paddingRight: currentPaddingRight },
    { minWidth: '0px', maxWidth: '0px', paddingLeft: '0px', paddingRight: '0px' }
  ], { duration, easing: animationEasing, fill: 'forwards' });

  wrapper.animate([
    { '--creation-reveal-size': '0px' },
    { '--creation-reveal-size': `${maskFadePx}px` }
  ], {
    duration: duration * maskFadeRatio,
    easing: animationEasing,
    fill: 'forwards'
  });

  if (wasActive) {
    const bg = tab.querySelector('.tab--background');
    bg.animate([
      { opacity: 1 },
      { opacity: 0 }
    ], { duration, easing: animationEasing, fill: 'forwards' });
  }

  const closeBtn = tab.querySelector(tabCloseSelector);
  if (closeBtn) {
    closeBtn.animate([
      { opacity: 1, transform: 'translateY(-50%) scale(1)' },
      { opacity: 0, transform: 'translateY(-50%) scale(0.8)' }
    ], { duration: duration * 0.5, easing: animationEasing, fill: 'forwards' });
  }

  widthAnim.addEventListener('finish', () => {
    unobserveTabCompression(tab);
    tab.remove();
    closingTabs.delete(tab);
  });
};

export const initializeTabLifecycle = (tabList) => {
  tabList.addEventListener('click', (event) => {
    if (!isEventTargetElement(event.target)) return;

    if (event.target.closest(tabAddSelector)) {
      addTab(tabList);
      return;
    }

    const closeButton = event.target.closest(tabCloseSelector);
    if (!closeButton) return;

    const tab = closeButton.closest(tabSelector);
    if (tab && tabList.contains(tab)) {
      closeTab(tabList, tab);
    }
  });
};
