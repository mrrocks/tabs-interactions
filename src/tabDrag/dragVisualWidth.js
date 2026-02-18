import { toFiniteNumber } from '../shared/math';
import { resolveHoverPreviewWidthPx } from './dragCalculations';

export const createDragVisualWidthManager = ({ scaleDurationMs, dragResizeTransitionDurationMs }) => {
  let transitionEnabled = false;

  const enableTransition = (session) => {
    if (transitionEnabled || !session) {
      return;
    }

    const transitionDurationMs = scaleDurationMs(dragResizeTransitionDurationMs);
    const proxyTransition = [
      `width ${transitionDurationMs}ms ease`,
      `min-width ${transitionDurationMs}ms ease`,
      `max-width ${transitionDurationMs}ms ease`
    ].join(', ');
    const tabTransition = [
      `flex-basis ${transitionDurationMs}ms ease`,
      `min-width ${transitionDurationMs}ms ease`,
      `max-width ${transitionDurationMs}ms ease`
    ].join(', ');

    if (session.dragProxy) {
      session.dragProxy.style.transition = proxyTransition;
    }
    session.draggedTab.style.transition = tabTransition;
    transitionEnabled = true;
  };

  const apply = (session, widthPx) => {
    const resolvedWidthPx = toFiniteNumber(widthPx, 0);
    if (!session || resolvedWidthPx <= 0) {
      return;
    }

    enableTransition(session);

    if (session.dragProxy) {
      session.dragProxy.style.width = `${resolvedWidthPx}px`;
      session.dragProxy.style.minWidth = `${resolvedWidthPx}px`;
      session.dragProxy.style.maxWidth = `${resolvedWidthPx}px`;
    }

    session.draggedTab.style.flex = `0 1 ${resolvedWidthPx}px`;
    session.draggedTab.style.flexBasis = `${resolvedWidthPx}px`;
    session.draggedTab.style.minWidth = `${resolvedWidthPx}px`;
    session.draggedTab.style.maxWidth = `${resolvedWidthPx}px`;
  };

  const reset = (session) => {
    if (!session?.dragProxy) {
      return;
    }

    const baseWidthPx = resolveHoverPreviewWidthPx({
      dragProxyBaseRect: session.dragProxyBaseRect,
      draggedTab: session.draggedTab
    });
    if (baseWidthPx <= 0) {
      return;
    }

    session.dragProxy.style.width = `${baseWidthPx}px`;
    session.dragProxy.style.minWidth = `${baseWidthPx}px`;
    session.dragProxy.style.maxWidth = `${baseWidthPx}px`;
  };

  const syncWithHoverPreview = (session, hoverPreviewManager) => {
    if (
      !hoverPreviewManager.previewTab ||
      !session ||
      hoverPreviewManager.expanding ||
      typeof hoverPreviewManager.previewTab.getBoundingClientRect !== 'function'
    ) {
      return;
    }

    const previewWidthPx = toFiniteNumber(hoverPreviewManager.previewTab.getBoundingClientRect().width, 0);
    if (previewWidthPx <= 0) {
      return;
    }

    apply(session, previewWidthPx);
  };

  const resetEnabled = () => {
    transitionEnabled = false;
  };

  return {
    apply,
    reset,
    syncWithHoverPreview,
    resetEnabled
  };
};
