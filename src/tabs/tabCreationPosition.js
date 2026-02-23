export const TabCreationPosition = Object.freeze({
  NEXT_TO_ACTIVE: 'next-to-active',
  END: 'end'
});

let position = TabCreationPosition.NEXT_TO_ACTIVE;

const listeners = new Set();

export const getTabCreationPosition = () => position;

export const setTabCreationPosition = (value) => {
  if (value !== TabCreationPosition.NEXT_TO_ACTIVE && value !== TabCreationPosition.END) return;
  position = value;
  listeners.forEach((fn) => fn(position));
};

export const onTabCreationPositionChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const toggleSelector = '[data-tab-position-toggle]';
const labelSelector = '[data-tab-position-label]';

const labelText = (pos) =>
  pos === TabCreationPosition.NEXT_TO_ACTIVE ? 'Next to active' : 'At the end';

let initialized = false;

export const initializeTabCreationPositionControl = () => {
  if (initialized) return;
  initialized = true;

  const toggle = document.querySelector(toggleSelector);
  const label = document.querySelector(labelSelector);
  if (!toggle) return;

  toggle.checked = position === TabCreationPosition.NEXT_TO_ACTIVE;
  if (label) label.textContent = labelText(position);

  toggle.addEventListener('change', () => {
    const next = toggle.checked
      ? TabCreationPosition.NEXT_TO_ACTIVE
      : TabCreationPosition.END;
    setTabCreationPosition(next);
    if (label) label.textContent = labelText(next);
  });
};
