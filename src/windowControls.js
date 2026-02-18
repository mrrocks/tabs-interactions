export const closeWindowControlSelector = '[data-window-control="close"]';
export const windowControlsSelector = '.window--controls';
const windowPanelSelector = '.browser';
const initializedRoots = new WeakSet();

const isEventTargetElement = (target) =>
  Boolean(target) && typeof target === 'object' && typeof target.closest === 'function';

export const removePanel = (panel) => {
  if (!panel) {
    return false;
  }

  if (typeof panel.remove === 'function') {
    panel.remove();
    return true;
  }

  if (panel.parentNode && typeof panel.parentNode.removeChild === 'function') {
    panel.parentNode.removeChild(panel);
    return true;
  }

  return false;
};

export const createWindowControlsElement = (documentRef = document) => {
  const controls = documentRef.createElement('div');
  controls.className = 'window--controls';
  controls.setAttribute('aria-label', 'Window controls');

  const closeControl = documentRef.createElement('button');
  closeControl.className = 'window--control window--control-close';
  closeControl.type = 'button';
  closeControl.setAttribute('aria-label', 'Close window');
  closeControl.setAttribute('data-window-control', 'close');

  const minimizeControl = documentRef.createElement('span');
  minimizeControl.className = 'window--control window--control-minimize';
  minimizeControl.setAttribute('aria-hidden', 'true');

  const expandControl = documentRef.createElement('span');
  expandControl.className = 'window--control window--control-expand';
  expandControl.setAttribute('aria-hidden', 'true');

  controls.append(closeControl, minimizeControl, expandControl);
  return controls;
};

export const initializeWindowControls = (root = document) => {
  if (!root || initializedRoots.has(root) || typeof root.addEventListener !== 'function') {
    return false;
  }

  initializedRoots.add(root);

  root.addEventListener('click', (event) => {
    if (!isEventTargetElement(event.target)) {
      return;
    }

    const closeControl = event.target.closest(closeWindowControlSelector);
    if (!closeControl) {
      return;
    }

    const panel = closeControl.closest(windowPanelSelector);
    if (!panel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    removePanel(panel);
  });

  return true;
};
