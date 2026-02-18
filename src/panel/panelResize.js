import { clamp } from '../shared/math';

export { clamp };

export const clampFrameToViewport = ({
  width,
  height,
  left,
  top,
  minWidth,
  minHeight,
  viewportWidth = Number.POSITIVE_INFINITY,
  viewportHeight = Number.POSITIVE_INFINITY
}) => {
  const boundedMinWidth = Math.min(minWidth, viewportWidth);
  const boundedMinHeight = Math.min(minHeight, viewportHeight);
  const nextWidth = clamp(width, boundedMinWidth, viewportWidth);
  const nextHeight = clamp(height, boundedMinHeight, viewportHeight);
  const nextLeft = clamp(left, 0, Math.max(0, viewportWidth - nextWidth));
  const nextTop = clamp(top, 0, Math.max(0, viewportHeight - nextHeight));

  return {
    width: nextWidth,
    height: nextHeight,
    left: nextLeft,
    top: nextTop
  };
};

const resizeCursorByDirection = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize'
};

export const getResizeCursor = (direction) => resizeCursorByDirection[direction] ?? 'default';

export const getResizeDirection = ({ clientX, clientY, rect, hitArea }) => {
  const withinHorizontal = clientX >= rect.left - hitArea && clientX <= rect.right + hitArea;
  const withinVertical = clientY >= rect.top - hitArea && clientY <= rect.bottom + hitArea;
  const onLeft = withinVertical && Math.abs(clientX - rect.left) <= hitArea;
  const onRight = withinVertical && Math.abs(rect.right - clientX) <= hitArea;
  const onTop = withinHorizontal && Math.abs(clientY - rect.top) <= hitArea;
  const onBottom = withinHorizontal && Math.abs(rect.bottom - clientY) <= hitArea;

  if (onTop && onLeft) {
    return 'nw';
  }

  if (onTop && onRight) {
    return 'ne';
  }

  if (onBottom && onLeft) {
    return 'sw';
  }

  if (onBottom && onRight) {
    return 'se';
  }

  if (onTop) {
    return 'n';
  }

  if (onBottom) {
    return 's';
  }

  if (onLeft) {
    return 'w';
  }

  if (onRight) {
    return 'e';
  }

  return null;
};

export const getResizedFrame = ({
  direction,
  startX,
  startY,
  startWidth,
  startHeight,
  startLeft,
  startTop,
  clientX,
  clientY,
  minWidth,
  minHeight,
  viewportWidth = Number.POSITIVE_INFINITY,
  viewportHeight = Number.POSITIVE_INFINITY
}) => {
  const resolvedDirection = direction ?? '';
  const deltaX = clientX - startX;
  const deltaY = clientY - startY;
  const fromLeft = resolvedDirection.includes('w');
  const fromRight = resolvedDirection.includes('e');
  const fromTop = resolvedDirection.includes('n');
  const fromBottom = resolvedDirection.includes('s');

  let width = startWidth;
  let height = startHeight;
  let left = startLeft;
  let top = startTop;

  if (fromLeft) {
    const right = startLeft + startWidth;
    const rawWidth = startWidth - deltaX;
    width = clamp(rawWidth, minWidth, Math.max(minWidth, right));
    left = right - width;
  } else if (fromRight) {
    const rawWidth = startWidth + deltaX;
    width = clamp(rawWidth, minWidth, Math.max(minWidth, viewportWidth - startLeft));
    left = startLeft;
  }

  if (fromTop) {
    const bottom = startTop + startHeight;
    const rawHeight = startHeight - deltaY;
    height = clamp(rawHeight, minHeight, Math.max(minHeight, bottom));
    top = bottom - height;
  } else if (fromBottom) {
    const rawHeight = startHeight + deltaY;
    height = clamp(rawHeight, minHeight, Math.max(minHeight, viewportHeight - startTop));
    top = startTop;
  }

  return clampFrameToViewport({
    width,
    height,
    left,
    top,
    minWidth,
    minHeight,
    viewportWidth,
    viewportHeight
  });
};

export const getDraggedFrame = ({
  startX,
  startY,
  startLeft,
  startTop,
  clientX,
  clientY,
  width,
  height,
  viewportWidth,
  viewportHeight
}) => {
  const deltaX = clientX - startX;
  const deltaY = clientY - startY;
  const left = clamp(startLeft + deltaX, 0, Math.max(0, viewportWidth - width));
  const top = clamp(startTop + deltaY, 0, Math.max(0, viewportHeight - height));

  return { left, top };
};
