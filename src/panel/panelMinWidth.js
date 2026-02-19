const tabSelector = '.tab--item:not(.tab--drag-proxy):not([aria-hidden="true"])';
const addButtonSelector = '.tab--add';
const controlsSelector = '.window--controls';
const tabRowSelector = '.tab--row';

export const computePanelMinWidth = (panel) => {
  const tabRow = panel.querySelector(tabRowSelector);
  if (!tabRow) return 0;

  const styles = getComputedStyle(panel);
  const tabMinWidth = parseFloat(styles.getPropertyValue('--tab-min-width')) || 0;
  const tabCount = panel.querySelectorAll(tabSelector).length;

  const rowStyle = getComputedStyle(tabRow);
  const rowPaddingLeft = parseFloat(rowStyle.paddingLeft) || 0;
  const rowPaddingRight = parseFloat(rowStyle.paddingRight) || 0;
  const rowGap = parseFloat(rowStyle.gap) || 0;

  const controls = tabRow.querySelector(controlsSelector);
  const controlsWidth = controls ? controls.getBoundingClientRect().width : 0;

  const addButton = tabRow.querySelector(addButtonSelector);
  const addButtonWidth = addButton
    ? addButton.getBoundingClientRect().width + (parseFloat(getComputedStyle(addButton).marginLeft) || 0)
    : 0;

  return rowPaddingLeft + controlsWidth + rowGap + (tabCount * tabMinWidth) + addButtonWidth + rowPaddingRight;
};
