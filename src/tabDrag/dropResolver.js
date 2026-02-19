const canUseElementInstance = () => typeof Element !== 'undefined';

const isElementLike = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof value.closest === 'function' &&
  typeof value.isConnected === 'boolean';

export const createExpandedRect = (rect, padding) => ({
  left: rect.left - padding,
  right: rect.right + padding,
  top: rect.top - padding,
  bottom: rect.bottom + padding
});

export const isPointInsideRect = ({ clientX, clientY, rect, padding = 0 }) => {
  const resolvedRect = createExpandedRect(rect, padding);

  return (
    clientX >= resolvedRect.left &&
    clientX <= resolvedRect.right &&
    clientY >= resolvedRect.top &&
    clientY <= resolvedRect.bottom
  );
};

export const createDropResolver = ({
  tabListSelector,
  defaultAttachPaddingPx,
  panelSelector = '.browser',
  panelRowSelector = '.tab--row'
}) => {
  const isPointInsidePanelRow = (tabList, clientX, clientY, padding) => {
    if (!tabList || typeof tabList.closest !== 'function') {
      return false;
    }

    const panel = tabList.closest(panelSelector);
    if (!panel || typeof panel.getBoundingClientRect !== 'function') {
      return false;
    }

    const rowElement =
      typeof panel.querySelector === 'function' ? panel.querySelector(panelRowSelector) : null;
    const rowRect =
      rowElement && typeof rowElement.getBoundingClientRect === 'function'
        ? rowElement.getBoundingClientRect()
        : panel.getBoundingClientRect();

    return isPointInsideRect({
      clientX,
      clientY,
      rect: rowRect,
      padding
    });
  };

  const isOccludedByHigherPanel = (candidateTabList, allPanels, clientX, clientY) => {
    const candidatePanel = candidateTabList.closest?.(panelSelector);
    if (!candidatePanel) {
      return false;
    }

    const candidateZ = parseInt(candidatePanel.style?.zIndex, 10) || 0;

    for (const panel of allPanels) {
      if (panel === candidatePanel) {
        continue;
      }

      const z = parseInt(panel.style?.zIndex, 10) || 0;
      if (z <= candidateZ) {
        continue;
      }

      if (
        typeof panel.getBoundingClientRect === 'function' &&
        isPointInsideRect({ clientX, clientY, rect: panel.getBoundingClientRect() })
      ) {
        return true;
      }
    }

    return false;
  };

  const resolveAttachTargetTabList = ({
    clientX,
    clientY,
    excludedTabList,
    padding = defaultAttachPaddingPx,
    documentRef = typeof document === 'undefined' ? null : document
  }) => {
    if (!documentRef || typeof documentRef.querySelectorAll !== 'function') {
      return null;
    }

    const tabLists = Array.from(documentRef.querySelectorAll(tabListSelector)).filter(
      (tabList) => tabList !== excludedTabList && isElementLike(tabList)
    );

    if (tabLists.length === 0) {
      return null;
    }

    const allPanels = Array.from(documentRef.querySelectorAll(panelSelector));

    if (typeof documentRef.elementsFromPoint === 'function') {
      const layeredElements = documentRef.elementsFromPoint(clientX, clientY);
      const shouldCheckInstance = canUseElementInstance();

      for (const element of layeredElements) {
        if (shouldCheckInstance && !(element instanceof Element)) {
          continue;
        }

        if (!element || typeof element.closest !== 'function') {
          continue;
        }

        const tabList = element.closest(tabListSelector);

        if (tabList && tabLists.includes(tabList)) {
          return tabList;
        }

        const panel = element.closest(panelSelector);
        if (panel) {
          const panelTabList =
            typeof panel.querySelector === 'function'
              ? panel.querySelector(tabListSelector)
              : null;
          if (!panelTabList || !tabLists.includes(panelTabList)) {
            return null;
          }
          if (!isPointInsidePanelRow(panelTabList, clientX, clientY, padding)) {
            return null;
          }
          return panelTabList;
        }
      }
    }

    const tabStripTarget =
      tabLists.find((tabList) => {
        if (typeof tabList.getBoundingClientRect !== 'function') {
          return false;
        }

        return (
          isPointInsideRect({ clientX, clientY, rect: tabList.getBoundingClientRect(), padding }) &&
          !isOccludedByHigherPanel(tabList, allPanels, clientX, clientY)
        );
      }) ?? null;

    if (tabStripTarget) {
      return tabStripTarget;
    }

    const panelRowTarget =
      tabLists.find(
        (tabList) =>
          isPointInsidePanelRow(tabList, clientX, clientY, padding) &&
          !isOccludedByHigherPanel(tabList, allPanels, clientX, clientY)
      ) ?? null;

    if (panelRowTarget) {
      return panelRowTarget;
    }

    return null;
  };

  const resolveDropDestination = ({ detachIntentActive, attachTargetTabList }) => {
    if (attachTargetTabList) {
      return 'attach';
    }

    if (detachIntentActive) {
      return 'detach';
    }

    return 'settle';
  };

  return {
    resolveAttachTargetTabList,
    resolveDropDestination
  };
};
