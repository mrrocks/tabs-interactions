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
  minHeight
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
    width = Math.max(rawWidth, minWidth);
    left = right - width;
  } else if (fromRight) {
    const rawWidth = startWidth + deltaX;
    width = Math.max(rawWidth, minWidth);
    left = startLeft;
  }

  if (fromTop) {
    const bottom = startTop + startHeight;
    const rawHeight = startHeight - deltaY;
    height = Math.max(rawHeight, minHeight);
    top = bottom - height;
  } else if (fromBottom) {
    const rawHeight = startHeight + deltaY;
    height = Math.max(rawHeight, minHeight);
    top = startTop;
  }

  return { width, height, left, top };
};

export const getDraggedFrame = ({
  startX,
  startY,
  startLeft,
  startTop,
  clientX,
  clientY
}) => {
  const deltaX = clientX - startX;
  const deltaY = clientY - startY;

  return {
    left: startLeft + deltaX,
    top: startTop + deltaY
  };
};
