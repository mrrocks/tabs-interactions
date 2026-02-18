import { clamp, toFiniteNumber } from '../shared/math';

export const dragActivationDistancePx = 3;
export const detachThresholdPx = 56;
export const reentryPaddingPx = 16;
export const windowAttachPaddingPx = 12;
export const verticalResistanceFactor = 0.22;
export const verticalResistanceMaxPx = 30;

export const applyVerticalResistance = (
  deltaY,
  resistanceFactor = verticalResistanceFactor,
  maximumOffsetPx = verticalResistanceMaxPx
) => {
  const scaledDelta = toFiniteNumber(deltaY, 0) * resistanceFactor;
  return clamp(scaledDelta, -maximumOffsetPx, maximumOffsetPx);
};

export const shouldDetachFromVerticalDelta = (deltaY, thresholdPx = detachThresholdPx) =>
  Math.abs(toFiniteNumber(deltaY, 0)) >= thresholdPx;

export const getInsertionIndexFromCenters = ({ centers, pointerClientX }) => {
  const resolvedPointerX = toFiniteNumber(pointerClientX, 0);

  for (let index = 0; index < centers.length; index += 1) {
    if (resolvedPointerX < centers[index]) {
      return index;
    }
  }

  return centers.length;
};

export const shouldDetachOnDrop = ({ detachIntentActive }) => Boolean(detachIntentActive);

export const resolveDetachIntent = ({ currentIntent, deltaY, thresholdPx = detachThresholdPx }) =>
  Boolean(currentIntent) || shouldDetachFromVerticalDelta(deltaY, thresholdPx);

export const shouldCloseSourcePanelAfterTransfer = ({
  sourceTabCountAfterMove
}) => sourceTabCountAfterMove === 0;

export const shouldRemoveSourceWindowOnDetach = (sourceTabCount) => sourceTabCount === 1;

export const resolveSourceActivationIndexAfterDetach = (draggedTabIndex, remainingTabCount) => {
  if (remainingTabCount === 0) {
    return -1;
  }
  return Math.max(0, draggedTabIndex - 1);
};

export const resolveDragVisualOffsetY = ({ deltaY, detachIntentActive }) =>
  detachIntentActive ? deltaY : applyVerticalResistance(deltaY);

export const resolveHoverPreviewWidthPx = ({ dragProxyBaseRect, draggedTab }) => {
  const proxyBaseWidth = toFiniteNumber(dragProxyBaseRect?.width, 0);
  if (proxyBaseWidth > 0) {
    return proxyBaseWidth;
  }

  if (draggedTab && typeof draggedTab.getBoundingClientRect === 'function') {
    return toFiniteNumber(draggedTab.getBoundingClientRect().width, 0);
  }

  return 0;
};

export const resolveDropDetachIntent = ({
  detachIntentActive,
  isDropInsideCurrentHeader,
  didCrossWindowAttach
}) => {
  if (didCrossWindowAttach) {
    return false;
  }

  return Boolean(detachIntentActive) && !Boolean(isDropInsideCurrentHeader);
};

export const resolveDropAttachTarget = ({
  attachTargetTabList,
  hoverAttachTabList,
  sourceTabList,
  dropClientX,
  dropClientY,
  hoverAttachClientX,
  hoverAttachClientY,
  fallbackRadiusPx = 48
}) => {
  if (attachTargetTabList && attachTargetTabList !== sourceTabList) {
    return attachTargetTabList;
  }

  if (!hoverAttachTabList || hoverAttachTabList === sourceTabList) {
    return null;
  }

  if ('isConnected' in hoverAttachTabList && hoverAttachTabList.isConnected === false) {
    return null;
  }

  const resolvedDropClientX = toFiniteNumber(dropClientX, Number.NaN);
  const resolvedDropClientY = toFiniteNumber(dropClientY, Number.NaN);
  const resolvedHoverClientX = toFiniteNumber(hoverAttachClientX, Number.NaN);
  const resolvedHoverClientY = toFiniteNumber(hoverAttachClientY, Number.NaN);

  if (
    Number.isFinite(resolvedDropClientX) &&
    Number.isFinite(resolvedDropClientY) &&
    Number.isFinite(resolvedHoverClientX) &&
    Number.isFinite(resolvedHoverClientY)
  ) {
    const deltaX = resolvedDropClientX - resolvedHoverClientX;
    const deltaY = resolvedDropClientY - resolvedHoverClientY;

    if (Math.hypot(deltaX, deltaY) > fallbackRadiusPx) {
      return null;
    }
  }

  return hoverAttachTabList;
};

export const getProxySettleDelta = ({ proxyRect, targetRect }) => ({
  deltaX: targetRect.left - proxyRect.left,
  deltaY: targetRect.top - proxyRect.top
});
