import { toRectSnapshot } from '../shared/dom';
import { getOverlayZIndex } from '../window/windowFocus';

export const createDragDomAdapter = ({
  activeTabClassName,
  dragClassName,
  activeDragClassName,
  inactiveDragClassName,
  dragSourceClassName,
  dragProxyClassName,
  noTransitionClassName
}) => {
  const setElementTransform = (element, translateX, translateY) => {
    if (!element || !element.style) {
      return;
    }

    element.style.transform = `translate3d(${translateX}px, ${translateY}px, 0px)`;
  };

  const createDragProxy = (draggedTab) => {
    if (typeof document === 'undefined' || !document.body || typeof draggedTab.cloneNode !== 'function') {
      return null;
    }

    const draggedRect = draggedTab.getBoundingClientRect();
    const dragProxy = draggedTab.cloneNode(true);
    const isActive = draggedTab.classList.contains(activeTabClassName);
    dragProxy.classList.add(dragProxyClassName, dragClassName, isActive ? activeDragClassName : inactiveDragClassName);
    dragProxy.style.left = `${draggedRect.left}px`;
    dragProxy.style.top = `${draggedRect.top}px`;
    dragProxy.style.width = `${draggedRect.width}px`;
    dragProxy.style.height = `${draggedRect.height}px`;
    dragProxy.style.minWidth = `${draggedRect.width}px`;
    dragProxy.style.maxWidth = `${draggedRect.width}px`;
    dragProxy.style.transform = 'translate3d(0px, 0px, 0px)';
    dragProxy.style.willChange = 'transform';
    dragProxy.style.zIndex = String(getOverlayZIndex());
    document.body.append(dragProxy);

    return {
      dragProxy,
      dragProxyBaseRect: toRectSnapshot(draggedRect)
    };
  };

  const removeDragProxy = (dragProxy) => {
    if (!dragProxy) {
      return;
    }

    if (typeof dragProxy.remove === 'function') {
      dragProxy.remove();
      return;
    }

    if (dragProxy.parentNode && typeof dragProxy.parentNode.removeChild === 'function') {
      dragProxy.parentNode.removeChild(dragProxy);
    }
  };

  const setDragProxyBaseRect = (dragState, rect) => {
    if (!dragState?.dragProxy) {
      return;
    }

    const snapshot = toRectSnapshot(rect);
    dragState.dragProxyBaseRect = snapshot;
    dragState.dragProxy.style.left = `${snapshot.left}px`;
    dragState.dragProxy.style.top = `${snapshot.top}px`;
    dragState.dragProxy.style.width = `${snapshot.width}px`;
    dragState.dragProxy.style.height = `${snapshot.height}px`;
    dragState.dragProxy.style.minWidth = `${snapshot.width}px`;
    dragState.dragProxy.style.maxWidth = `${snapshot.width}px`;
  };

  const setDragVisualTransform = (dragState, translateX, translateY) => {
    if (dragState.dragProxy) {
      setElementTransform(dragState.dragProxy, translateX, translateY);
      return;
    }

    setElementTransform(dragState.draggedTab, translateX, translateY);
  };

  const applyDragStyles = (dragState) => {
    const { draggedTab } = dragState;
    const draggedRect = draggedTab.getBoundingClientRect();
    dragState.lockedTabWidthPx = draggedRect.width;
    draggedTab.style.transition = 'none';
    draggedTab.style.flex = `0 0 ${draggedRect.width}px`;
    draggedTab.style.minWidth = `${draggedRect.width}px`;
    draggedTab.style.maxWidth = `${draggedRect.width}px`;
    const dragProxyState = createDragProxy(draggedTab);

    if (dragProxyState) {
      draggedTab.classList.add(dragSourceClassName);
      dragState.dragProxy = dragProxyState.dragProxy;
      dragState.dragProxyBaseRect = dragProxyState.dragProxyBaseRect;
      return;
    }

    const isActive = draggedTab.classList.contains(activeTabClassName);
    draggedTab.classList.add(dragClassName, isActive ? activeDragClassName : inactiveDragClassName);
    draggedTab.style.willChange = 'transform';
    draggedTab.style.zIndex = '6';
  };

  const restoreDraggedTabStyles = (dragState) => {
    const { draggedTab, initialInlineStyles } = dragState;
    const isInactive = !draggedTab.classList.contains(activeTabClassName);
    const hadProxy = Boolean(dragState.dragProxy);

    draggedTab.classList.remove(dragSourceClassName, dragClassName);
    draggedTab.style.transform = initialInlineStyles.transform;
    draggedTab.style.transition = initialInlineStyles.transition;
    draggedTab.style.flex = initialInlineStyles.flex;
    draggedTab.style.flexBasis = initialInlineStyles.flexBasis;
    draggedTab.style.minWidth = initialInlineStyles.minWidth;
    draggedTab.style.maxWidth = initialInlineStyles.maxWidth;
    draggedTab.style.willChange = initialInlineStyles.willChange;
    draggedTab.style.zIndex = initialInlineStyles.zIndex;

    if (hadProxy && isInactive) {
      draggedTab.classList.add(noTransitionClassName, inactiveDragClassName);
      draggedTab.getBoundingClientRect();
      draggedTab.classList.remove(noTransitionClassName);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          draggedTab.classList.remove(inactiveDragClassName);
        });
      });
    } else {
      draggedTab.classList.remove(activeDragClassName, inactiveDragClassName);
    }
  };

  const rebaseDragVisualAtPointer = (dragState, clientX, clientY) => {
    dragState.startX = clientX;
    dragState.startY = clientY;

    if (dragState.dragProxy) {
      const proxyRect = dragState.dragProxy.getBoundingClientRect();
      setDragProxyBaseRect(dragState, {
        left: proxyRect.left,
        top: proxyRect.top,
        width: proxyRect.width,
        height: proxyRect.height
      });
    }

    setDragVisualTransform(dragState, 0, 0);
  };

  const cleanupVisualState = (dragState) => {
    restoreDraggedTabStyles(dragState);
    removeDragProxy(dragState.dragProxy);
  };

  return {
    setElementTransform,
    setDragProxyBaseRect,
    setDragVisualTransform,
    applyDragStyles,
    restoreDraggedTabStyles,
    rebaseDragVisualAtPointer,
    removeDragProxy,
    cleanupVisualState
  };
};
