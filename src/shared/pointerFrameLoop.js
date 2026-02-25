export const createPointerFrameLoop = ({ onSample }) => {
  let frameId = 0;
  let queuedX = 0;
  let queuedY = 0;
  let hasQueued = false;

  const process = () => {
    frameId = 0;
    onSample(queuedX, queuedY);
  };

  const schedule = () => {
    if (frameId !== 0) return;
    frameId = window.requestAnimationFrame(process);
  };

  const flush = () => {
    if (frameId !== 0) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    }
    onSample(queuedX, queuedY);
  };

  return {
    queue(x, y) {
      queuedX = x;
      queuedY = y;
      hasQueued = true;
    },
    schedule,
    flush,
    reset() { hasQueued = false; },
    get lastX() { return queuedX; },
    get lastY() { return queuedY; },
    get hasQueued() { return hasQueued; }
  };
};
