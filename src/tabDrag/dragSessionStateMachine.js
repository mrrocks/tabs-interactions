export const dragSessionPhase = Object.freeze({
  pressed: 'pressed',
  attachedDrag: 'attachedDrag',
  settling: 'settling'
});

const toFiniteNumber = (value, fallbackValue = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
};

export const createDragSession = ({
  pointerId,
  draggedTab,
  currentTabList,
  sourceTabCount,
  startX,
  startY,
  initialUserSelect,
  initialInlineStyles
}) => ({
  pointerId,
  draggedTab,
  currentTabList,
  phase: dragSessionPhase.pressed,
  sourceTabCount,
  reattachArmed: true,
  dragProxy: null,
  dragProxyBaseRect: null,
  hoverAttachTabList: null,
  hoverAttachClientX: 0,
  hoverAttachClientY: 0,
  didCrossWindowAttach: false,
  dragStarted: false,
  dragMoved: false,
  detachIntentActive: false,
  startX: toFiniteNumber(startX, 0),
  startY: toFiniteNumber(startY, 0),
  lastClientX: toFiniteNumber(startX, 0),
  lastClientY: toFiniteNumber(startY, 0),
  initialUserSelect,
  initialInlineStyles
});

export const transitionSessionToAttachedDrag = (session, updates = {}) => {
  if (!session) {
    return null;
  }

  return {
    ...session,
    ...updates,
    phase: dragSessionPhase.attachedDrag
  };
};

export const transitionSessionToSettling = (session) => {
  if (!session) {
    return null;
  }

  return {
    ...session,
    phase: dragSessionPhase.settling
  };
};

export const markSessionAsActivated = (session) => {
  if (!session) {
    return null;
  }

  return transitionSessionToAttachedDrag(session, {
    dragStarted: true,
    dragMoved: true
  });
};

export const isSessionAttachedDrag = (session) => session?.phase === dragSessionPhase.attachedDrag;
