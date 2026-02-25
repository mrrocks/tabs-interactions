import { clamp, toFiniteNumber } from '../shared/math';

export const dragActivationDistancePx = 3;
export const detachThresholdPx = 80;
export const reentryPaddingPx = 16;
export const windowAttachPaddingPx = 12;
export const resistanceFactor = 0.22;
export const resistanceMaxPx = 32;
export const resistanceOnsetInsetPx = 12;
export const reorderTriggerFraction = 0.1;
export const longPressActivationDelayMs = 300;

export const applyResistance = (
  overshoot,
  factor = resistanceFactor,
  maximumOffsetPx = resistanceMaxPx
) => {
  const scaledDelta = toFiniteNumber(overshoot, 0) * factor;
  return clamp(scaledDelta, -maximumOffsetPx, maximumOffsetPx);
};

export const computeOvershoot = ({ value, min, max, inset = resistanceOnsetInsetPx }) => {
  const resolved = toFiniteNumber(value, 0);
  const innerMin = min + inset;
  const innerMax = max - inset;
  if (resolved < innerMin) return resolved - innerMin;
  if (resolved > innerMax) return resolved - innerMax;
  return 0;
};

export const shouldDetachFromOvershoot = (
  overshootX,
  overshootY,
  thresholdPx = detachThresholdPx
) => Math.max(Math.abs(toFiniteNumber(overshootX, 0)), Math.abs(toFiniteNumber(overshootY, 0))) >= thresholdPx;

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

export const resolveDetachIntent = ({ currentIntent, overshootX = 0, overshootY = 0, thresholdPx = detachThresholdPx }) =>
  Boolean(currentIntent) || shouldDetachFromOvershoot(overshootX, overshootY, thresholdPx);

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

export const resolveDragVisualOffsetY = ({ deltaY, overshootY, detachIntentActive }) =>
  detachIntentActive ? deltaY : deltaY - overshootY + applyResistance(overshootY);

export const resolveDragVisualOffsetX = ({ deltaX, overshootX, detachIntentActive }) =>
  detachIntentActive ? deltaX : deltaX - overshootX + applyResistance(overshootX);

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
  allowSourceReattach = false,
  dropClientX,
  dropClientY,
  hoverAttachClientX,
  hoverAttachClientY,
  fallbackRadiusPx = 48
}) => {
  const isSourceExcluded = (target) => target === sourceTabList && !allowSourceReattach;

  if (attachTargetTabList && !isSourceExcluded(attachTargetTabList)) {
    return attachTargetTabList;
  }

  if (!hoverAttachTabList || isSourceExcluded(hoverAttachTabList)) {
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

export const resolveDetachedTabWidth = (panel) => {
  if (!panel || typeof globalThis.getComputedStyle !== 'function') {
    return 0;
  }
  return parseFloat(getComputedStyle(panel).getPropertyValue('--tab-default-width')) || 0;
};

export const snapshotSiblingPositions = (siblings) =>
  new Map(siblings.map((el) => [el, el.getBoundingClientRect().left]));

export const computeDisplacements = (siblings, snapshot, threshold = 0.5) =>
  siblings
    .map((tab) => ({ tab, deltaX: snapshot.get(tab) - tab.getBoundingClientRect().left }))
    .filter(({ deltaX }) => Math.abs(deltaX) >= threshold);
