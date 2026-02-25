import { toFiniteNumber } from '../shared/math';

export const DragPhase = Object.freeze({
  idle: 'idle',
  pressed: 'pressed',
  reordering: 'reordering',
  detachIntent: 'detachIntent',
  detachedDragging: 'detachedDragging',
  hoverAttaching: 'hoverAttaching',
  settling: 'settling'
});

export const createDragContext = ({
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
  sourceTabCount,

  phase: DragPhase.pressed,
  previousPhase: null,

  startX: toFiniteNumber(startX, 0),
  startY: toFiniteNumber(startY, 0),
  lastClientX: toFiniteNumber(startX, 0),
  lastClientY: toFiniteNumber(startY, 0),

  dragStarted: false,
  dragMoved: false,

  reattachArmed: true,
  detachIntentActive: false,
  detachedWidthPx: 0,

  hoverAttachTabList: null,
  hoverAttachClientX: 0,
  hoverAttachClientY: 0,
  didCrossWindowAttach: false,

  dragProxy: null,
  dragProxyBaseRect: null,

  lockedTabWidthPx: 0,
  sourcePanelRect: null,

  detachedPanel: null,
  detachedTabList: null,
  detachedPanelFrame: null,
  detachedTabOffsetInPanel: null,
  detachedPointerOffset: null,
  proxyParked: false,
  proxyFadingOut: false,

  sourceWindowRemovedDuringDetach: false,
  pendingDetachSpawn: false,
  detachWindowToggle: null,
  detachEdgeSnapPreview: null,

  initialUserSelect,
  initialInlineStyles
});

export const transitionTo = (ctx, nextPhase) => {
  ctx.previousPhase = ctx.phase;
  ctx.phase = nextPhase;
};
