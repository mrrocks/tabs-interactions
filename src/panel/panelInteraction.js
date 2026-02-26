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
import { createPointerFrameLoop } from '../shared/pointerFrameLoop';
import { scaleDurationMs } from '../motion/motionSpeed';
import { clamp } from '../shared/math';

const resizeHitArea = 10;
const unsnapThresholdPx = 220;
const unsnapResistanceFactor = 0.2;
const unsnapResistanceMaxPx = 35;
const applyUnsnapResistance = (delta) => clamp(delta * unsnapResistanceFactor, -unsnapResistanceMaxPx, unsnapResistanceMaxPx);
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
  let panelFrame = null;
  let activeCursor = '';
  let panelMinWidth = 0;
  let panelMinHeight = 0;
  let edgeSnapPreview = null;
  let pendingUnsnap = null;
  let unsnapSizeAnimation = null;
  let unsnapGrabRatio = null;
  let unsnapPositionOffset = null;
  let lastPointer = null;
  let unsnapRafId = null;

  const tickUnsnapPosition = () => {
    if (!unsnapSizeAnimation || !unsnapGrabRatio || !lastPointer) return;
    const animatedRect = panel.getBoundingClientRect();
    const grabLeft = lastPointer.x - animatedRect.width * unsnapGrabRatio.x;
    const grabTop = lastPointer.y - animatedRect.height * unsnapGrabRatio.y;

    let left = grabLeft;
    let top = grabTop;
    if (unsnapPositionOffset) {
      const widthRange = unsnapPositionOffset.targetWidth - unsnapPositionOffset.startWidth;
      const progress = widthRange !== 0
        ? clamp((animatedRect.width - unsnapPositionOffset.startWidth) / widthRange, 0, 1)
        : 1;
      left = grabLeft + unsnapPositionOffset.dx * (1 - progress);
      top = grabTop + unsnapPositionOffset.dy * (1 - progress);
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panelFrame = { ...panelFrame, left, top };
    unsnapRafId = requestAnimationFrame(tickUnsnapPosition);
  };

  const startUnsnapPositionLoop = () => {
    stopUnsnapPositionLoop();
    unsnapRafId = requestAnimationFrame(tickUnsnapPosition);
  };

  const stopUnsnapPositionLoop = () => {
    if (unsnapRafId !== null) {
      cancelAnimationFrame(unsnapRafId);
      unsnapRafId = null;
    }
  };

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

    if (!unsnapSizeAnimation) {
      if (!currentFrame || nextFrame.width !== currentFrame.width) {
        panel.style.width = `${nextFrame.width}px`;
      }
      if (!currentFrame || nextFrame.height !== currentFrame.height) {
        panel.style.height = `${nextFrame.height}px`;
      }
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

  const pointerLoop = createPointerFrameLoop({
    onSample(clientX, clientY) {
      if (!panelFrame || !interactionState || !pointerLoop.hasQueued) return;

      if (interactionState.mode === 'resize') {
        setPanelFrame(getResizedFrame({
          ...interactionState,
          clientX,
          clientY,
          minWidth: panelMinWidth,
          minHeight: panelMinHeight
        }));
        return;
      }

      if (!unsnapSizeAnimation) {
        const draggedPos = getDraggedFrame({ ...interactionState, clientX, clientY });
        setPanelFrame({
          ...panelFrame,
          ...draggedPos
        });
      }

      const snapZone = resolveEdgeSnapZone(clientX, window.innerWidth);
      if (snapZone) {
        if (!edgeSnapPreview) edgeSnapPreview = createEdgeSnapPreview();
        edgeSnapPreview.show(snapZone);
      } else if (edgeSnapPreview) {
        edgeSnapPreview.hide();
      }
    }
  });

  const clearInteractionListeners = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  const applySnapResistance = (clientX, clientY) => {
    const dx = clientX - pendingUnsnap.startX;
    const dy = clientY - pendingUnsnap.startY;
    const resistedLeft = pendingUnsnap.snappedFrame.left + applyUnsnapResistance(dx);
    const resistedTop = pendingUnsnap.snappedFrame.top + applyUnsnapResistance(dy);
    setPanelFrame({
      ...pendingUnsnap.snappedFrame,
      left: resistedLeft,
      top: resistedTop
    });
  };

  const commitUnsnap = (clientX, clientY) => {
    const { preSnap, snappedFrame } = pendingUnsnap;
    const dx = clientX - pendingUnsnap.startX;
    const dy = clientY - pendingUnsnap.startY;
    const resistedLeft = snappedFrame.left + applyUnsnapResistance(dx);
    const resistedTop = snappedFrame.top + applyUnsnapResistance(dy);

    const grabRatioX = (pendingUnsnap.startX - snappedFrame.left) / snappedFrame.width;
    const grabRatioY = (pendingUnsnap.startY - snappedFrame.top) / snappedFrame.height;
    unsnapGrabRatio = { x: grabRatioX, y: grabRatioY };

    const grabLeft = clientX - snappedFrame.width * grabRatioX;
    const grabTop = clientY - snappedFrame.height * grabRatioY;
    unsnapPositionOffset = {
      dx: resistedLeft - grabLeft,
      dy: resistedTop - grabTop,
      startWidth: snappedFrame.width,
      targetWidth: preSnap.width
    };

    panel.style.width = `${snappedFrame.width}px`;
    panel.style.height = `${snappedFrame.height}px`;

    unsnapSizeAnimation = panel.animate(
      [
        { width: `${snappedFrame.width}px`, height: `${snappedFrame.height}px` },
        { width: `${preSnap.width}px`, height: `${preSnap.height}px` }
      ],
      { duration: scaleDurationMs(300), easing: 'ease-out', fill: 'forwards' }
    );
    unsnapSizeAnimation.addEventListener('finish', () => {
      stopUnsnapPositionLoop();
      unsnapSizeAnimation.cancel();
      unsnapSizeAnimation = null;
      unsnapGrabRatio = null;
      unsnapPositionOffset = null;
      panel.style.width = `${preSnap.width}px`;
      panel.style.height = `${preSnap.height}px`;
      const currentPointer = lastPointer || { x: clientX, y: clientY };
      const finalLeft = currentPointer.x - preSnap.width * grabRatioX;
      const finalTop = currentPointer.y - preSnap.height * grabRatioY;
      panel.style.left = `${finalLeft}px`;
      panel.style.top = `${finalTop}px`;
      panelFrame = {
        width: preSnap.width,
        height: preSnap.height,
        left: finalLeft,
        top: finalTop
      };
      interactionState = {
        ...interactionState,
        startWidth: preSnap.width,
        startHeight: preSnap.height,
        startLeft: finalLeft,
        startTop: finalTop,
        startX: currentPointer.x,
        startY: currentPointer.y
      };
    });

    snappedPanelFrames.delete(panel);
    setPanelFrame({
      width: snappedFrame.width,
      height: snappedFrame.height,
      left: resistedLeft,
      top: resistedTop
    });
    interactionState = {
      ...interactionState,
      startX: clientX,
      startY: clientY,
      startWidth: snappedFrame.width,
      startHeight: snappedFrame.height,
      startLeft: resistedLeft,
      startTop: resistedTop
    };
    pendingUnsnap = null;
    startUnsnapPositionLoop();
  };

  const onPointerMove = (event) => {
    if (!interactionState || event.pointerId !== interactionState.pointerId) return;
    lastPointer = { x: event.clientX, y: event.clientY };

    if (pendingUnsnap) {
      const dx = event.clientX - pendingUnsnap.startX;
      const dy = event.clientY - pendingUnsnap.startY;
      if (Math.hypot(dx, dy) >= unsnapThresholdPx) {
        commitUnsnap(event.clientX, event.clientY);
      } else {
        applySnapResistance(event.clientX, event.clientY);
        return;
      }
    }

    pointerLoop.queue(event.clientX, event.clientY);
    pointerLoop.schedule();
  };

  const onPointerUp = (event) => {
    if (!interactionState || event.pointerId !== interactionState.pointerId) return;

    const wasResisting = pendingUnsnap !== null;
    if (pendingUnsnap) {
      const snapBack = { ...pendingUnsnap.snappedFrame };
      pendingUnsnap = null;
      animatePanelToSnappedFrame(panel, snapBack, () => {
        panelFrame = snapBack;
      });
    }

    if (unsnapSizeAnimation) {
      unsnapSizeAnimation.finish();
    }

    const wasDrag = interactionState.mode === 'drag';

    if (!wasResisting) {
      pointerLoop.queue(event.clientX, event.clientY);
      pointerLoop.flush();
    }

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
    } else if (wasDrag && !wasResisting) {
      snappedPanelFrames.delete(panel);
    }

    if (edgeSnapPreview) {
      edgeSnapPreview.destroy();
      edgeSnapPreview = null;
    }

    interactionState = null;
    pointerLoop.reset();
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
      pendingUnsnap = {
        preSnap,
        snappedFrame: { ...panelFrame },
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
      };
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
    pointerLoop.queue(event.clientX, event.clientY);

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
