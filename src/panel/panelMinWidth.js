import { tabAddSelector, tabRowSelector, windowControlsSelector } from '../shared/selectors';

const visibleTabSelector = '.tab--item:not(.tab--drag-proxy):not([aria-hidden="true"])';

export const computePanelMinWidth = (panel) => {
  const tabRow = panel.querySelector(tabRowSelector);
  if (!tabRow) return 0;

  const styles = getComputedStyle(panel);
  const tabMinWidth = parseFloat(styles.getPropertyValue('--tab-min-width')) || 0;
  const tabCount = panel.querySelectorAll(visibleTabSelector).length;

  const rowStyle = getComputedStyle(tabRow);
  const rowPaddingLeft = parseFloat(rowStyle.paddingLeft) || 0;
  const rowPaddingRight = parseFloat(rowStyle.paddingRight) || 0;
  const rowGap = parseFloat(rowStyle.gap) || 0;

  const controls = tabRow.querySelector(windowControlsSelector);
  const controlsWidth = controls ? controls.getBoundingClientRect().width : 0;

  const addButton = tabRow.querySelector(tabAddSelector);
  const addButtonWidth = addButton
    ? addButton.getBoundingClientRect().width + (parseFloat(getComputedStyle(addButton).marginLeft) || 0)
    : 0;

  return rowPaddingLeft + controlsWidth + rowGap + (tabCount * tabMinWidth) + addButtonWidth + rowPaddingRight;
};
