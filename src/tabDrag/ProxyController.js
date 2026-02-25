import { toRectSnapshot } from '../shared/dom';
import { getOverlayZIndex } from '../window/windowFocus';
import { animateCornerClipIn, animateCornerClipOut, animateBackgroundRadiusToAttached, animateBackgroundRadiusToDetached } from './cornerClipAnimation';
import { animateDragShadowIn, animateDragShadowOut } from './dragShadowAnimation';
import { dragTransitionDurationMs, dragShadowOutDurationMs } from './dragAnimationConfig';
import { scaleDurationMs } from '../motion/motionSpeed';

const VisState = Object.freeze({
  hidden: 'hidden',
  fadingIn: 'fadingIn',
  visible: 'visible',
  fadingOut: 'fadingOut'
});

export const createProxyController = ({
  activeTabClassName,
  dragClassName,
  activeDragClassName,
  inactiveDragClassName,
  dragSourceClassName,
  dragProxyClassName,
  noTransitionClassName
}) => {
  let element = null;
  let baseRect = null;
  let grabRatio = 0;
  let visState = VisState.hidden;
  let opacityAnimation = null;

  const create = (tab) => {
    if (typeof document === 'undefined' || !document.body || typeof tab.cloneNode !== 'function') {
      return false;
    }

    const rect = tab.getBoundingClientRect();
    const isActive = tab.classList.contains(activeTabClassName);
    const proxy = tab.cloneNode(true);

    proxy.classList.add(
      dragProxyClassName,
      dragClassName,
      isActive ? activeDragClassName : inactiveDragClassName
    );
    proxy.style.left = `${rect.left}px`;
    proxy.style.top = `${rect.top}px`;
    proxy.style.width = `${rect.width}px`;
    proxy.style.height = `${rect.height}px`;
    proxy.style.minWidth = `${rect.width}px`;
    proxy.style.maxWidth = `${rect.width}px`;
    proxy.style.transform = 'translate3d(0px, 0px, 0px)';
    proxy.style.willChange = 'transform';
    proxy.style.zIndex = String(getOverlayZIndex());
    document.body.append(proxy);

    element = proxy;
    baseRect = toRectSnapshot(rect);
    visState = VisState.visible;
    opacityAnimation = null;

    return true;
  };

  const destroy = () => {
    if (!element) return;
    cancelAllAnimations();
    element.remove();
    element = null;
    baseRect = null;
    grabRatio = 0;
    visState = VisState.hidden;
    opacityAnimation = null;
  };

  const cancelAllAnimations = () => {
    if (!element) return;
    element.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    opacityAnimation = null;
  };

  const activate = (tab, pointerX) => {
    if (!create(tab)) return false;
    const rect = tab.getBoundingClientRect();
    grabRatio = computeGrabRatio(pointerX, rect);
    tab.classList.add(dragSourceClassName);
    return true;
  };

  const deactivate = (tab) => {
    tab.classList.remove(dragSourceClassName, dragClassName, activeDragClassName, inactiveDragClassName);
  };

  const computeGrabRatio = (pointerX, rect) => {
    if (rect.width <= 0) return 0;
    const offset = pointerX - rect.left;
    return Math.max(0, Math.min(1, offset / rect.width));
  };

  const rebase = (clientX, clientY) => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    baseRect = toRectSnapshot(rect);
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    element.style.minWidth = `${rect.width}px`;
    element.style.maxWidth = `${rect.width}px`;
    element.style.transform = 'translate3d(0px, 0px, 0px)';
  };

  const rebaseAtRect = (rect) => {
    if (!element) return;
    baseRect = toRectSnapshot(rect);
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    element.style.minWidth = `${rect.width}px`;
    element.style.maxWidth = `${rect.width}px`;
    element.style.transform = 'translate3d(0px, 0px, 0px)';
  };

  const moveTo = (dx, dy) => {
    if (!element) return;
    element.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
  };

  const updateZIndex = () => {
    if (!element) return;
    element.style.zIndex = String(getOverlayZIndex());
  };

  const show = () => {
    if (!element) return;
    cancelOpacityAnimation();
    element.style.visibility = '';
    element.style.opacity = '';
    element.style.pointerEvents = '';
    visState = VisState.visible;
  };

  const hide = () => {
    if (!element) return;
    cancelOpacityAnimation();
    element.style.visibility = 'hidden';
    element.style.opacity = '';
    element.style.pointerEvents = 'none';
    visState = VisState.hidden;
  };

  const cancelOpacityAnimation = () => {
    if (opacityAnimation) {
      opacityAnimation.cancel();
      opacityAnimation = null;
    }
  };

  const fadeIn = (durationMs) => {
    if (!element) return;
    const currentOpacity = getCurrentOpacity();
    cancelOpacityAnimation();
    element.style.visibility = '';
    element.style.pointerEvents = '';
    element.style.opacity = '';

    if (currentOpacity >= 1) {
      visState = VisState.visible;
      return;
    }

    const remaining = durationMs * (1 - currentOpacity);
    opacityAnimation = element.animate(
      [{ opacity: String(currentOpacity) }, { opacity: '1' }],
      { duration: Math.max(remaining, 16), easing: 'ease', fill: 'forwards' }
    );
    visState = VisState.fadingIn;

    opacityAnimation.addEventListener('finish', () => {
      if (visState === VisState.fadingIn) {
        element.style.opacity = '';
        opacityAnimation?.cancel();
        opacityAnimation = null;
        visState = VisState.visible;
      }
    }, { once: true });
  };

  const fadeOut = (durationMs, onComplete) => {
    if (!element) return;
    const currentOpacity = getCurrentOpacity();
    cancelOpacityAnimation();

    if (currentOpacity <= 0) {
      hide();
      onComplete?.();
      return;
    }

    element.style.pointerEvents = 'none';
    const remaining = durationMs * currentOpacity;
    opacityAnimation = element.animate(
      [{ opacity: String(currentOpacity) }, { opacity: '0' }],
      { duration: Math.max(remaining, 16), easing: 'ease', fill: 'forwards' }
    );
    visState = VisState.fadingOut;

    opacityAnimation.addEventListener('finish', () => {
      if (visState === VisState.fadingOut) {
        hide();
        onComplete?.();
      }
    }, { once: true });
  };

  const getCurrentOpacity = () => {
    if (!element) return 0;
    return parseFloat(getComputedStyle(element).opacity) || 0;
  };

  const applyDetachedStyle = (durationMs) => {
    if (!element) return;
    const d = durationMs ?? scaleDurationMs(dragTransitionDurationMs);
    animateCornerClipOut(element, { durationMs: d });
    animateBackgroundRadiusToDetached(element, { durationMs: d });
    animateDragShadowIn(element, { durationMs: d, isActive: element.classList.contains(activeDragClassName) });
  };

  const applyAttachedStyle = (durationMs) => {
    if (!element) return;
    const d = durationMs ?? scaleDurationMs(dragTransitionDurationMs);
    animateCornerClipIn(element, { durationMs: d, fill: 'forwards' });
    animateBackgroundRadiusToAttached(element, { durationMs: d, fill: 'forwards' });
    animateDragShadowOut(element, {
      durationMs: durationMs ?? scaleDurationMs(dragShadowOutDurationMs),
      isActive: element.classList.contains(activeDragClassName)
    });
  };

  const animateShadowOut = (durationMs) => {
    if (!element) return;
    animateDragShadowOut(element, {
      durationMs: durationMs ?? scaleDurationMs(dragShadowOutDurationMs),
      isActive: element.classList.contains(activeDragClassName)
    });
  };

  const alignmentDelta = (tab) => {
    if (!element) return { dx: 0, dy: 0 };
    const proxyRect = element.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    return {
      dx: proxyRect.left - tabRect.left,
      dy: proxyRect.top - tabRect.top
    };
  };

  return {
    get element() { return element; },
    get baseRect() { return baseRect; },
    get grabRatio() { return grabRatio; },
    get visible() { return visState === VisState.visible || visState === VisState.fadingIn; },
    get visState() { return visState; },
    get rect() { return element?.getBoundingClientRect?.() ?? null; },

    create,
    destroy,
    activate,
    deactivate,
    rebase,
    rebaseAtRect,
    moveTo,
    updateZIndex,
    show,
    hide,
    fadeIn,
    fadeOut,
    cancelAllAnimations,
    applyDetachedStyle,
    applyAttachedStyle,
    animateShadowOut,
    alignmentDelta
  };
};
