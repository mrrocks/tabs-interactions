import { pinTab, unpinTab, isPinned } from './tabPinning';
import { tabSelector } from './tabs';

const menuClassName = 'tab-context-menu';
const itemClassName = 'tab-context-menu--item';

let activeMenu = null;

const dismiss = () => {
  if (!activeMenu) return;
  activeMenu.remove();
  activeMenu = null;
  document.removeEventListener('pointerdown', onDismissPointer, true);
  document.removeEventListener('keydown', onDismissKey, true);
  window.removeEventListener('blur', dismiss);
};

const onDismissPointer = (e) => {
  if (activeMenu && !activeMenu.contains(e.target)) {
    dismiss();
  }
};

const onDismissKey = (e) => {
  if (e.key === 'Escape') {
    dismiss();
  }
};

const createMenu = (x, y, label, onSelect) => {
  dismiss();

  const menu = document.createElement('div');
  menu.className = menuClassName;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const item = document.createElement('div');
  item.className = itemClassName;
  item.textContent = label;
  item.addEventListener('click', () => {
    dismiss();
    onSelect();
  });

  menu.appendChild(item);
  document.body.appendChild(menu);
  activeMenu = menu;

  document.addEventListener('pointerdown', onDismissPointer, true);
  document.addEventListener('keydown', onDismissKey, true);
  window.addEventListener('blur', dismiss);
};

export const initializeTabContextMenu = (tabList) => {
  tabList.addEventListener('contextmenu', (e) => {
    const tab = e.target.closest(tabSelector);
    if (!tab || !tabList.contains(tab)) return;

    e.preventDefault();

    const pinned = isPinned(tab);
    const label = pinned ? 'Unpin tab' : 'Pin tab';

    createMenu(e.clientX, e.clientY, label, () => {
      if (pinned) {
        unpinTab(tabList, tab);
      } else {
        pinTab(tabList, tab);
      }
    });
  });
};
