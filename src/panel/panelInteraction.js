import {
  getDraggedFrame,
  getResizeCursor,
  getResizeDirection,
  getResizedFrame
} from './panelResize';
import { computePanelMinWidth } from './panelMinWidth';
import {
  resolveEdgeSnapZone,
  computeSnappedFrame,
  createEdgeSnapPreview,
  animatePanelToSnappedFrame,
  snappedPanelFrames
} from './panelEdgeSnap';
import { tabItemSelector, tabAddSelector, tabCloseSelector, windowControlsSelector } from '../shared/selectors';
import { toFiniteNumber } from '../shared/math';

const resizeHitArea = 10;
const grabCursor = 'grab';
const grabbingCursor = 'grabbing';
const panelSelector = '[data-resizable]';
const initializedPanels = new WeakSet();

export const initializePanelInteraction = (panel) => {
  if (!panel || initializedPanels.has(panel)) {
    return false;
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  initializedPanels.add(panel);

  let interactionState = null;
  let frameRequestId = 0;
  let panelFrame = null;
  let queuedClientX = 0;
  let queuedClientY = 0;
  let hasQueuedPointer = false;
  let activeCursor = '';
  let panelMinWidth = 0;
  let panelMinHeight = 0;
  let edgeSnapPreview = null;

  const setCursor = (nextCursor) => {
    if (activeCursor === nextCursor) {
      return;
    }

    panel.style.cursor = nextCursor;
    activeCursor = nextCursor;
  };

  const readPanelFrame = () => {
    const rect = panel.getBoundingClientRect();

    return {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top
    };
  };

  const readPanelMinHeight = () => {
    const styles = window.getComputedStyle(panel);
    return toFiniteNumber(parseFloat(styles.minHeight));
  };

  const setPanelFrame = (nextFrame) => {
    const currentFrame = panelFrame;

    if (!currentFrame || nextFrame.width !== currentFrame.width) {
      panel.style.width = `${nextFrame.width}px`;
    }

    if (!currentFrame || nextFrame.height !== currentFrame.height) {
      panel.style.height = `${nextFrame.height}px`;
    }

    if (!currentFrame || nextFrame.left !== currentFrame.left) {
      panel.style.left = `${nextFrame.left}px`;
    }

    if (!currentFrame || nextFrame.top !== currentFrame.top) {
      panel.style.top = `${nextFrame.top}px`;
    }

    panelFrame = nextFrame;
  };

  const getPanelRect = () => {
    if (!panelFrame) {
      return null;
    }

    return {
      left: panelFrame.left,
      top: panelFrame.top,
      right: panelFrame.left + panelFrame.width,
      bottom: panelFrame.top + panelFrame.height
    };
  };

  const getPointerDirection = (clientX, clientY) => {
    const rect = getPanelRect();

    if (!rect) {
      return null;
    }

    return getResizeDirection({
      clientX,
      clientY,
      rect,
      hitArea: resizeHitArea
    });
  };

  const updatePointerDirection = (clientX, clientY) => {
    const direction = getPointerDirection(clientX, clientY);
    setCursor(direction ? getResizeCursor(direction) : grabCursor);

    return direction;
  };

  const applyInteractionSample = () => {
    if (!panelFrame || !interactionState || !hasQueuedPointer) {
      return;
    }

    if (interactionState.mode === 'resize') {
      const frame = getResizedFrame({
        ...interactionState,
        clientX: queuedClientX,
        clientY: queuedClientY,
        minWidth: panelMinWidth,
        minHeight: panelMinHeight
      });

      setPanelFrame(frame);
      return;
    }

    const dragFrame = getDraggedFrame({
      ...interactionState,
      clientX: queuedClientX,
      clientY: queuedClientY
    });

    setPanelFrame({
      ...panelFrame,
      ...dragFrame
    });

    const snapZone = resolveEdgeSnapZone(queuedClientX, window.innerWidth);
    if (snapZone) {
      if (!edgeSnapPreview) edgeSnapPreview = createEdgeSnapPreview();
      edgeSnapPreview.show(snapZone);
    } else if (edgeSnapPreview) {
      edgeSnapPreview.hide();
    }
  };

  const processInteractionFrame = () => {
    frameRequestId = 0;
    applyInteractionSample();
  };

  const scheduleInteractionFrame = () => {
    if (frameRequestId !== 0) {
      return;
    }

    frameRequestId = window.requestAnimationFrame(processInteractionFrame);
  };

  const flushInteractionFrame = () => {
    if (frameRequestId !== 0) {
      window.cancelAnimationFrame(frameRequestId);
      frameRequestId = 0;
    }

    applyInteractionSample();
  };

  const clearInteractionListeners = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  const onPointerMove = (event) => {
    if (!interactionState || event.pointerId !== interactionState.pointerId) {
      return;
    }

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;

    scheduleInteractionFrame();
  };

  const onPointerUp = (event) => {
    if (!interactionState || event.pointerId !== interactionState.pointerId) {
      return;
    }

    const wasDrag = interactionState.mode === 'drag';

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    flushInteractionFrame();

    if (panel.hasPointerCapture(event.pointerId)) {
      panel.releasePointerCapture(event.pointerId);
    }

    if (wasDrag && edgeSnapPreview?.activeZone) {
      const zone = edgeSnapPreview.activeZone;
      const preSnapFrame = snappedPanelFrames.get(panel) ?? { ...panelFrame };
      snappedPanelFrames.set(panel, preSnapFrame);
      const targetFrame = computeSnappedFrame(zone, window.innerWidth, window.innerHeight);
      animatePanelToSnappedFrame(panel, targetFrame, () => {
        panelFrame = { ...targetFrame };
      });
    } else if (wasDrag) {
      snappedPanelFrames.delete(panel);
    }

    if (edgeSnapPreview) {
      edgeSnapPreview.destroy();
      edgeSnapPreview = null;
    }

    interactionState = null;
    hasQueuedPointer = false;
    document.body.style.userSelect = '';
    updatePointerDirection(event.clientX, event.clientY);
    clearInteractionListeners();
  };

  panel.addEventListener('pointermove', (event) => {
    if (interactionState) {
      return;
    }

    updatePointerDirection(event.clientX, event.clientY);
  });

  panel.addEventListener('pointerleave', () => {
    if (interactionState) {
      return;
    }

    setCursor(grabCursor);
  });

  panel.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !panelFrame) {
      return;
    }

    if (event.target instanceof Element) {
      if (event.target.closest(windowControlsSelector) || event.target.closest(tabAddSelector) || event.target.closest(tabCloseSelector) || event.target.closest(tabItemSelector)) {
        return;
      }
    }

    panelFrame = readPanelFrame();
    const direction = updatePointerDirection(event.clientX, event.clientY);
    event.preventDefault();

    if (direction) {
      panelMinWidth = computePanelMinWidth(panel);
    }

    const preSnap = !direction ? snappedPanelFrames.get(panel) : null;
    if (preSnap) {
      const restoredLeft = event.clientX - preSnap.width / 2;
      const restoredTop = event.clientY;
      const restoredFrame = {
        width: preSnap.width,
        height: preSnap.height,
        left: restoredLeft,
        top: restoredTop
      };
      animatePanelToSnappedFrame(panel, restoredFrame, () => {
        panelFrame = { ...restoredFrame };
      });
      panelFrame = restoredFrame;
      snappedPanelFrames.delete(panel);
    }

    interactionState = {
      mode: direction ? 'resize' : 'drag',
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: panelFrame.width,
      startHeight: panelFrame.height,
      startLeft: panelFrame.left,
      startTop: panelFrame.top
    };
    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;

    panel.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    setCursor(direction ? getResizeCursor(direction) : grabbingCursor);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  panelFrame = readPanelFrame();
  panelMinHeight = readPanelMinHeight();

  if (panelFrame) {
    setCursor(grabCursor);
  }

  return true;
};

const queryPanels = (root) => {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return [];
  }

  return Array.from(root.querySelectorAll(panelSelector));
};

export const initializePanelInteractions = (root = document) => {
  const panels = queryPanels(root);

  panels.forEach((panel) => {
    initializePanelInteraction(panel);
  });

  return panels;
};
