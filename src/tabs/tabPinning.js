import { scaleDurationMs } from '../motion/motionSpeed';
import { getTabs, tabSelector } from './tabs';

const pinnedClassName = 'tab--pinned';
const addButtonSelector = '.tab--add';
const animationDurationMs = 150;
const animationEasing = 'ease';

export const isPinned = (tab) => tab.classList.contains(pinnedClassName);

const getAddButton = (tabList) => tabList.querySelector(addButtonSelector);

const getPinnedBoundaryRef = (tabList, excludeTab) => {
  const tabs = Array.from(tabList.querySelectorAll(tabSelector));
  const firstUnpinned = tabs.find((t) => t !== excludeTab && !isPinned(t));
  return firstUnpinned ?? getAddButton(tabList);
};

const flipAnimate = (tabList, targetTab, mutate) => {
  const allTabs = getTabs(tabList);
  const beforeRects = new Map(allTabs.map((t) => [t, t.getBoundingClientRect()]));

  mutate();

  const duration = scaleDurationMs(animationDurationMs);
  const afterTabs = getTabs(tabList);

  afterTabs.forEach((tab) => {
    const before = beforeRects.get(tab);
    if (!before) return;

    const after = tab.getBoundingClientRect();
    const deltaX = before.left - after.left;

    if (tab === targetTab) {
      const bw = `${before.width}px`;
      const aw = `${after.width}px`;
      if (Math.abs(deltaX) < 0.5 && Math.abs(before.width - after.width) < 0.5) return;

      const anim = tab.animate(
        [
          { transform: `translate3d(${deltaX}px, 0, 0)`, minWidth: bw, maxWidth: bw },
          { transform: 'translate3d(0, 0, 0)', minWidth: aw, maxWidth: aw }
        ],
        { duration, easing: animationEasing }
      );

      anim.addEventListener('finish', () => {
        anim.cancel();
      });
      return;
    }

    if (Math.abs(deltaX) < 0.5) return;

    tab.animate(
      [
        { transform: `translate3d(${deltaX}px, 0, 0)` },
        { transform: 'translate3d(0, 0, 0)' }
      ],
      { duration, easing: animationEasing }
    );
  });
};

export const pinTab = (tabList, tab) => {
  if (isPinned(tab)) return;

  flipAnimate(tabList, tab, () => {
    tab.classList.add(pinnedClassName);
    const ref = getPinnedBoundaryRef(tabList, tab);
    if (ref) {
      tabList.insertBefore(tab, ref);
    }
  });
};

export const unpinTab = (tabList, tab) => {
  if (!isPinned(tab)) return;

  flipAnimate(tabList, tab, () => {
    tab.classList.remove(pinnedClassName);
    const ref = getPinnedBoundaryRef(tabList, tab);
    if (ref) {
      tabList.insertBefore(tab, ref);
    }
  });
};
