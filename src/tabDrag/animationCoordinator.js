import { onAnimationSettled } from '../shared/dom';
import { dragTransitionDurationMs, dragTransitionEasing } from './dragAnimationConfig';

export const createAnimationCoordinator = ({
  scaleDurationMs,
  getProxySettleDelta,
  dragProxySettleDurationMs = dragTransitionDurationMs,
  siblingDisplacementDurationMs = dragTransitionDurationMs
}) => {
  const siblingAnimations = new WeakMap();
  const trackedElements = [];

  const cancelAllSiblingAnimations = () => {
    const batch = trackedElements.splice(0);
    for (const tab of batch) {
      const anim = siblingAnimations.get(tab);
      siblingAnimations.delete(tab);
      if (anim && typeof anim.cancel === 'function') {
        anim.cancel();
      }
    }
  };

  const trackSiblingAnimation = (tab, anim) => {
    const prev = siblingAnimations.get(tab);
    if (prev && typeof prev.cancel === 'function') {
      prev.cancel();
    }

    siblingAnimations.set(tab, anim);
    if (!prev) {
      trackedElements.push(tab);
    }

    if (typeof anim.addEventListener !== 'function') {
      return;
    }

    const cleanup = () => {
      if (siblingAnimations.get(tab) !== anim) {
        return;
      }
      siblingAnimations.delete(tab);
      const idx = trackedElements.indexOf(tab);
      if (idx !== -1) {
        trackedElements.splice(idx, 1);
      }
    };
    anim.addEventListener('finish', cleanup);
    anim.addEventListener('cancel', cleanup);
  };

  const animateSiblingDisplacement = (displacements) => {
    const duration = scaleDurationMs(siblingDisplacementDurationMs);

    displacements.forEach(({ tab, deltaX }) => {
      if (Math.abs(deltaX) < 0.5 || typeof tab.animate !== 'function') {
        return;
      }

      const anim = tab.animate(
        [{ transform: `translate3d(${deltaX}px, 0px, 0px)` }, { transform: 'translate3d(0px, 0px, 0px)' }],
        {
          duration,
          easing: dragTransitionEasing
        }
      );

      if (anim) {
        trackSiblingAnimation(tab, anim);
      }
    });
  };

  const animateProxySettleToTarget = ({
    dragProxy,
    draggedTab,
    toRectSnapshot,
    settleTargetRect,
    setDragProxyBaseRect,
    setElementTransform
  }) => {
    if (!dragProxy) {
      return null;
    }

    const proxyRect = toRectSnapshot(dragProxy.getBoundingClientRect());
    const targetRect = settleTargetRect ?? toRectSnapshot(draggedTab.getBoundingClientRect());
    const settleDelta = getProxySettleDelta({
      proxyRect,
      targetRect
    });

    setDragProxyBaseRect(proxyRect);
    setElementTransform(dragProxy, 0, 0);

    if (Math.abs(settleDelta.deltaX) < 0.5 && Math.abs(settleDelta.deltaY) < 0.5) {
      return null;
    }

    if (typeof dragProxy.animate !== 'function') {
      setElementTransform(dragProxy, settleDelta.deltaX, settleDelta.deltaY);
      return null;
    }

    return dragProxy.animate(
      [
        { transform: 'translate3d(0px, 0px, 0px)' },
        { transform: `translate3d(${settleDelta.deltaX}px, ${settleDelta.deltaY}px, 0px)` }
      ],
      {
        duration: scaleDurationMs(dragProxySettleDurationMs),
        easing: dragTransitionEasing,
        fill: 'forwards'
      }
    );
  };

  return {
    animateProxySettleToTarget,
    animateSiblingDisplacement,
    cancelAllSiblingAnimations,
    finalizeOnAnimationSettled: onAnimationSettled
  };
};
