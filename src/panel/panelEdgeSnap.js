import { scaleDurationMs } from '../motion/motionSpeed';
import { applyResistance } from '../tabDrag/dragCalculations';
import { clamp } from '../shared/math';

export const unsnapThresholdPx = 220;
export const unsnapResistanceFactor = 0.2;
export const unsnapResistanceMaxPx = 35;
export const unsnapSizeAnimationMs = 150;

export const applyUnsnapResistance = (delta) =>
  applyResistance(delta, unsnapResistanceFactor, unsnapResistanceMaxPx);

export const computeGrabRatio = (pointerX, pointerY, frame) => ({
  x: (pointerX - frame.left) / frame.width,
  y: (pointerY - frame.top) / frame.height
});

export const computeUnsnapPositionOffset = (resistedLeft, resistedTop, grabLeft, grabTop, snappedWidth, targetWidth) => ({
  dx: resistedLeft - grabLeft,
  dy: resistedTop - grabTop,
  startWidth: snappedWidth,
  targetWidth
});

export const blendUnsnapPosition = (pointerX, pointerY, grabRatio, animatedWidth, animatedHeight, positionOffset) => {
  let left = pointerX - animatedWidth * grabRatio.x;
  let top = pointerY - animatedHeight * grabRatio.y;
  if (positionOffset) {
    const range = positionOffset.targetWidth - positionOffset.startWidth;
    const progress = range !== 0
      ? clamp((animatedWidth - positionOffset.startWidth) / range, 0, 1)
      : 1;
    left += positionOffset.dx * (1 - progress);
    top += positionOffset.dy * (1 - progress);
  }
  return { left, top };
};

const edgeSnapZoneFraction = 0.05;
const ghostInsetPx = 8;
const ghostBorderRadius = 16;
const ghostShowDurationMs = 150;
const ghostHideDurationMs = 150;
const snapAnimationMs = 150;

export const snappedPanelFrames = new WeakMap();

export const resolveEdgeSnapZone = (clientX, viewportWidth) => {
  const threshold = viewportWidth * edgeSnapZoneFraction;
  if (clientX <= threshold) return 'left';
  if (clientX >= viewportWidth - threshold) return 'right';
  return null;
};

export const computeSnappedFrame = (zone, viewportWidth, viewportHeight) => {
  const width = Math.round(viewportWidth / 2);
  const height = viewportHeight;
  const left = zone === 'right' ? viewportWidth - width : 0;
  return { left, top: 0, width, height };
};

export const createEdgeSnapPreview = () => {
  let element = null;
  let currentZone = null;
  let showAnimation = null;

  const ensureElement = () => {
    if (element) return element;
    element = document.createElement('div');
    Object.assign(element.style, {
      position: 'fixed',
      zIndex: '1',
      pointerEvents: 'none',
      background: 'rgba(0, 0, 0, 0.15)',
      border: '2px dashed rgba(255, 255, 255, 0.6)',
      borderRadius: `${ghostBorderRadius}px`,
      opacity: '0',
      willChange: 'transform, opacity'
    });
    document.body.appendChild(element);
    return element;
  };

  const positionForZone = (zone) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const frame = computeSnappedFrame(zone, vw, vh);
    Object.assign(element.style, {
      left: `${frame.left + ghostInsetPx}px`,
      top: `${ghostInsetPx}px`,
      width: `${frame.width - ghostInsetPx * 2}px`,
      height: `${vh - ghostInsetPx * 2}px`
    });
  };

  const cancelAnimation = () => {
    if (showAnimation) {
      showAnimation.cancel();
      showAnimation = null;
    }
  };

  const show = (zone) => {
    if (zone === currentZone && element) return;
    ensureElement();
    cancelAnimation();
    positionForZone(zone);
    currentZone = zone;

    showAnimation = element.animate(
      [
        { opacity: '0', transform: 'scale(0.96)' },
        { opacity: '1', transform: 'scale(1)' }
      ],
      { duration: scaleDurationMs(ghostShowDurationMs), easing: 'ease', fill: 'forwards' }
    );
  };

  const hide = () => {
    if (!currentZone || !element) return;
    cancelAnimation();
    currentZone = null;

    showAnimation = element.animate(
      [
        { opacity: '1', transform: 'scale(1)' },
        { opacity: '0', transform: 'scale(0.96)' }
      ],
      { duration: scaleDurationMs(ghostHideDurationMs), easing: 'ease', fill: 'forwards' }
    );
  };

  const destroy = () => {
    cancelAnimation();
    if (element && element.parentNode) {
      element.remove();
    }
    element = null;
    currentZone = null;
  };

  return {
    get activeZone() { return currentZone; },
    show,
    hide,
    destroy
  };
};

export const animatePanelToSnappedFrame = (panel, targetFrame, onComplete) => {
  const currentLeft = parseFloat(panel.style.left) || 0;
  const currentTop = parseFloat(panel.style.top) || 0;
  const currentWidth = parseFloat(panel.style.width) || panel.getBoundingClientRect().width;
  const currentHeight = parseFloat(panel.style.height) || panel.getBoundingClientRect().height;

  const animation = panel.animate(
    [
      {
        left: `${currentLeft}px`,
        top: `${currentTop}px`,
        width: `${currentWidth}px`,
        height: `${currentHeight}px`
      },
      {
        left: `${targetFrame.left}px`,
        top: `${targetFrame.top}px`,
        width: `${targetFrame.width}px`,
        height: `${targetFrame.height}px`
      }
    ],
    { duration: scaleDurationMs(snapAnimationMs), easing: 'ease', fill: 'forwards' }
  );

  animation?.addEventListener?.('finish', () => {
    animation.cancel();
    panel.style.left = `${targetFrame.left}px`;
    panel.style.top = `${targetFrame.top}px`;
    panel.style.width = `${targetFrame.width}px`;
    panel.style.height = `${targetFrame.height}px`;
    onComplete?.();
  });

  return animation;
};
