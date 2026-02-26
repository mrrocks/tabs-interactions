import { toRectSnapshot, safeRemoveElement } from '../shared/dom';
import { getOverlayZIndex } from '../window/windowFocus';
import { activeTabClassName } from '../tabs/tabState';
import {
  dragClassName,
  activeDragClassName,
  inactiveDragClassName,
  dragSourceClassName,
  dragProxyClassName
} from './dragClassNames';
import { setFlexLock, restoreDragInlineStyles } from './styleHelpers';

export const createDragDomAdapter = () => {
  const setElementTransform = (element, translateX, translateY) => {
    if (!element || !element.style) {
      return;
    }

    element.style.transform = `translate3d(${translateX}px, ${translateY}px, 0px)`;
  };

  const applyProxyRect = (proxy, rect) => {
    proxy.style.left = `${rect.left}px`;
    proxy.style.top = `${rect.top}px`;
    proxy.style.width = `${rect.width}px`;
    proxy.style.height = `${rect.height}px`;
    proxy.style.minWidth = `${rect.width}px`;
    proxy.style.maxWidth = `${rect.width}px`;
  };

  const createDragProxy = (draggedTab) => {
    if (typeof document === 'undefined' || !document.body || typeof draggedTab.cloneNode !== 'function') {
      return null;
    }

    const draggedRect = draggedTab.getBoundingClientRect();
    const dragProxy = draggedTab.cloneNode(true);
    const isActive = draggedTab.classList.contains(activeTabClassName);
    dragProxy.classList.add(dragProxyClassName, dragClassName, isActive ? activeDragClassName : inactiveDragClassName);
    applyProxyRect(dragProxy, draggedRect);
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
    safeRemoveElement(dragProxy);
  };

  const setDragProxyBaseRect = (dragState, rect) => {
    if (!dragState?.dragProxy) {
      return;
    }

    const snapshot = toRectSnapshot(rect);
    dragState.dragProxyBaseRect = snapshot;
    applyProxyRect(dragState.dragProxy, snapshot);
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
    setFlexLock(draggedTab, draggedRect.width);
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
    draggedTab.classList.remove(dragSourceClassName, dragClassName, activeDragClassName, inactiveDragClassName);
    restoreDragInlineStyles(draggedTab, initialInlineStyles);
  };

  const rebaseDragVisualAtPointer = (dragState, clientX, clientY) => {
    dragState.startX = clientX;
    dragState.startY = clientY;

    if (dragState.dragProxy) {
      setDragProxyBaseRect(dragState, dragState.dragProxy.getBoundingClientRect());
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
