import { isEventTargetElement } from '../shared/dom';
import { panelSelector, windowControlsSelector } from '../shared/selectors';
import { animatedRemovePanel } from './windowManager';

export { windowControlsSelector };
export const closeWindowControlSelector = '[data-window-control="close"]';
const initializedRoots = new WeakSet();

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

    const panel = closeControl.closest(panelSelector);
    if (!panel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    animatedRemovePanel(panel, { anchor: closeControl });
  });

  return true;
};
