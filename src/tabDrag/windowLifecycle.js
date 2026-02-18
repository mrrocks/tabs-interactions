export const createWindowLifecycle = ({
  getTabs,
  createDetachedWindow,
  removeDetachedWindowIfEmpty,
  removePanel,
  shouldCloseSourcePanelAfterTransfer,
  initializePanelInteraction,
  initializeTabList,
  animateDetachedWindowEnter
}) => {
  const closeSourcePanelIfEmpty = ({ sourcePanel, sourceTabList }) => {
    if (!sourcePanel || !sourceTabList) {
      return false;
    }

    if (
      shouldCloseSourcePanelAfterTransfer({
        sourceTabCountAfterMove: getTabs(sourceTabList).length
      })
    ) {
      return removePanel(sourcePanel);
    }

    return false;
  };

  const createDetachedWindowFromDrop = ({
    sourcePanel,
    sourceTabList,
    draggedTab,
    pointerClientX,
    pointerClientY,
    sourceTabRect
  }) => {
    const detachedWindow = createDetachedWindow({
      sourcePanel,
      sourceTabList,
      draggedTab,
      pointerClientX,
      pointerClientY
    });

    if (!detachedWindow) {
      return null;
    }

    initializePanelInteraction(detachedWindow.panel);
    initializeTabList(detachedWindow.tabList);
    closeSourcePanelIfEmpty({ sourcePanel, sourceTabList });
    animateDetachedWindowEnter({
      panel: detachedWindow.panel,
      tabRect: sourceTabRect,
      frame: detachedWindow.frame
    });
    return detachedWindow;
  };

  const maybeRemoveDetachedPanel = (panel) => {
    if (!panel) {
      return false;
    }

    return removeDetachedWindowIfEmpty(panel);
  };

  return {
    closeSourcePanelIfEmpty,
    createDetachedWindowFromDrop,
    maybeRemoveDetachedPanel
  };
};
