import { dragTransitionDurationMs, dragTransitionEasing } from './dragAnimationConfig';

export const createAnimationCoordinator = ({
  scaleDurationMs,
  getProxySettleDelta,
  dragProxySettleDurationMs = dragTransitionDurationMs,
  siblingDisplacementDurationMs = dragTransitionDurationMs
}) => {
  const siblingAnimations = new WeakMap();
  const trackedElements = [];

  const cancelSiblingAnimation = (tab) => {
    const anim = siblingAnimations.get(tab);
    if (!anim) {
      return;
    }
    if (typeof anim.cancel === 'function') {
      anim.cancel();
    }
    siblingAnimations.delete(tab);
  };

  const cancelAllSiblingAnimations = () => {
    for (let i = trackedElements.length - 1; i >= 0; i -= 1) {
      cancelSiblingAnimation(trackedElements[i]);
    }
    trackedElements.length = 0;
  };

  const trackSiblingAnimation = (tab, anim) => {
    cancelSiblingAnimation(tab);
    siblingAnimations.set(tab, anim);
    trackedElements.push(tab);

    if (typeof anim.addEventListener !== 'function') {
      return;
    }

    const cleanup = () => {
      if (siblingAnimations.get(tab) === anim) {
        siblingAnimations.delete(tab);
        const idx = trackedElements.indexOf(tab);
        if (idx !== -1) {
          trackedElements.splice(idx, 1);
        }
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
    setDragProxyBaseRect,
    setElementTransform
  }) => {
    if (!dragProxy) {
      return null;
    }

    const proxyRect = toRectSnapshot(dragProxy.getBoundingClientRect());
    const targetRect = toRectSnapshot(draggedTab.getBoundingClientRect());
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

  const finalizeOnAnimationSettled = (animation, onSettled) => {
    if (!animation || typeof animation.addEventListener !== 'function') {
      onSettled();
      return;
    }

    let didSettle = false;
    const settle = () => {
      if (didSettle) {
        return;
      }

      didSettle = true;
      onSettled();
    };

    animation.addEventListener('finish', settle);
    animation.addEventListener('cancel', settle);
  };

  return {
    animateSiblingDisplacement,
    cancelAllSiblingAnimations,
    animateProxySettleToTarget,
    finalizeOnAnimationSettled
  };
};
