const clampIndex = (index, tabCount) => {
  if (tabCount <= 0) {
    return -1;
  }

  return Math.min(Math.max(index, 0), tabCount - 1);
};

export const activeTabClassName = 'tab--active';
export const inactiveTabClassName = 'tab--inactive';

export const getInitialActiveIndex = (selectionState) => {
  if (!Array.isArray(selectionState) || selectionState.length === 0) {
    return 0;
  }

  const selectedIndex = selectionState.findIndex(Boolean);

  return selectedIndex === -1 ? 0 : selectedIndex;
};

export const getTabActivationState = (tabCount, activeIndex) => {
  if (tabCount <= 0) {
    return [];
  }

  const resolvedIndex = clampIndex(activeIndex, tabCount);

  return Array.from({ length: tabCount }, (_, index) => {
    const selected = index === resolvedIndex;

    return {
      selected,
      tabIndex: selected ? 0 : -1,
      stateClassName: selected ? activeTabClassName : inactiveTabClassName
    };
  });
};

export const getArrowTargetIndex = ({ currentIndex, key, tabCount }) => {
  if (tabCount <= 0) {
    return -1;
  }

  const resolvedIndex = clampIndex(currentIndex, tabCount);

  if (key === 'ArrowLeft') {
    return resolvedIndex === 0 ? tabCount - 1 : resolvedIndex - 1;
  }

  if (key === 'ArrowRight') {
    return resolvedIndex === tabCount - 1 ? 0 : resolvedIndex + 1;
  }

  return resolvedIndex;
};
