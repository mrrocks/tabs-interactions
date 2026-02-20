const narrowClassName = 'tab--narrow';
const narrowThresholdPx = 60;

const tabObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const inlineSize = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
    entry.target.classList.toggle(narrowClassName, inlineSize <= narrowThresholdPx);
  }
});

export const observeTabCompression = (tab) => {
  tabObserver.observe(tab);
};

export const unobserveTabCompression = (tab) => {
  tabObserver.unobserve(tab);
};
