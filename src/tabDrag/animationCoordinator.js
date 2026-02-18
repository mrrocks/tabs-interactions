export const createAnimationCoordinator = ({
  scaleDurationMs,
  getProxySettleDelta,
  dragProxySettleDurationMs = 140,
  siblingDisplacementDurationMs = 150
}) => {
  const animateSiblingDisplacement = (displacements) => {
    const duration = scaleDurationMs(siblingDisplacementDurationMs);

    displacements.forEach(({ tab, deltaX }) => {
      if (Math.abs(deltaX) < 0.5 || typeof tab.animate !== 'function') {
        return;
      }

      tab.animate(
        [{ transform: `translate3d(${deltaX}px, 0px, 0px)` }, { transform: 'translate3d(0px, 0px, 0px)' }],
        {
          duration,
          easing: 'ease'
        }
      );
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
        easing: 'ease',
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
    animateProxySettleToTarget,
    finalizeOnAnimationSettled
  };
};
