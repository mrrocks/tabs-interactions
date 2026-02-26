import { panelSelector } from '../shared/selectors';

const initializedRoots = new WeakSet();
const focusedClass = 'browser--focused';
let topZIndex = 0;
let topPanel = null;

export const getOverlayZIndex = () => topZIndex + 1000;

export const bringToFront = (panel) => {
  if (!panel || panel === topPanel) {
    return;
  }

  if (topPanel) {
    topPanel.classList.remove(focusedClass);
  }

  topZIndex += 1;
  topPanel = panel;
  panel.style.zIndex = String(topZIndex);
  panel.classList.add(focusedClass);
};

export const initializeWindowFocus = (root = document) => {
  if (!root || initializedRoots.has(root)) {
    return;
  }

  initializedRoots.add(root);

  for (const panel of root.querySelectorAll(panelSelector)) {
    bringToFront(panel);
  }

  root.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const panel = event.target.closest(panelSelector);
      if (panel) {
        bringToFront(panel);
      }
    },
    true
  );
};
