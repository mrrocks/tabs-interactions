import {
  clampFrameToViewport,
  getDraggedFrame,
  getResizeCursor,
  getResizeDirection,
  getResizedFrame
} from './panelResize';

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
  let viewportWidth = 0;
  let viewportHeight = 0;
  let activeCursor = '';
  let panelMinWidth = 0;
  let panelMinHeight = 0;

  const setCursor = (nextCursor) => {
    if (activeCursor === nextCursor) {
      return;
    }

    panel.style.cursor = nextCursor;
    activeCursor = nextCursor;
  };

  const refreshViewport = () => {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
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

  const parsePixels = (value) => {
    const parsedValue = Number.parseFloat(value);

    return Number.isFinite(parsedValue) ? parsedValue : 0;
  };

  const readPanelConstraints = () => {
    const styles = window.getComputedStyle(panel);

    return {
      minWidth: parsePixels(styles.minWidth),
      minHeight: parsePixels(styles.minHeight)
    };
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
        minHeight: panelMinHeight,
        viewportWidth,
        viewportHeight
      });

      setPanelFrame(frame);
      return;
    }

    const dragFrame = getDraggedFrame({
      ...interactionState,
      clientX: queuedClientX,
      clientY: queuedClientY,
      width: interactionState.startWidth,
      height: interactionState.startHeight,
      viewportWidth,
      viewportHeight
    });

    setPanelFrame({
      ...panelFrame,
      ...dragFrame
    });
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

    queuedClientX = event.clientX;
    queuedClientY = event.clientY;
    hasQueuedPointer = true;
    flushInteractionFrame();

    if (panel.hasPointerCapture(event.pointerId)) {
      panel.releasePointerCapture(event.pointerId);
    }

    interactionState = null;
    hasQueuedPointer = false;
    document.body.style.userSelect = '';
    updatePointerDirection(event.clientX, event.clientY);
    clearInteractionListeners();
  };

  const clampPanelToViewport = () => {
    if (!panelFrame) {
      return;
    }

    refreshViewport();

    if (interactionState) {
      return;
    }

    const frame = clampFrameToViewport({
      ...panelFrame,
      minWidth: panelMinWidth,
      minHeight: panelMinHeight,
      viewportWidth,
      viewportHeight
    });

    setPanelFrame(frame);
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

    if (
      event.target instanceof Element &&
      (event.target.closest('.tab--item') || event.target.closest('.window--controls'))
    ) {
      return;
    }

    const direction = updatePointerDirection(event.clientX, event.clientY);
    event.preventDefault();
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

  refreshViewport();
  panelFrame = readPanelFrame();
  const panelConstraints = readPanelConstraints();
  panelMinWidth = panelConstraints.minWidth;
  panelMinHeight = panelConstraints.minHeight;

  if (panelFrame) {
    setPanelFrame(
      clampFrameToViewport({
        ...panelFrame,
        minWidth: panelMinWidth,
        minHeight: panelMinHeight,
        viewportWidth,
        viewportHeight
      })
    );
    setCursor(grabCursor);
  }

  window.addEventListener('resize', clampPanelToViewport);

  return true;
};

const queryPanels = (root) => {
  if (!root) {
    return [];
  }

  if (typeof root.querySelectorAll === 'function') {
    return Array.from(root.querySelectorAll(panelSelector));
  }

  if (typeof root.querySelector === 'function') {
    const panel = root.querySelector(panelSelector);
    return panel ? [panel] : [];
  }

  return [];
};

export const initializePanelInteractions = (root = document) => {
  const panels = queryPanels(root);

  panels.forEach((panel) => {
    initializePanelInteraction(panel);
  });

  return panels;
};
