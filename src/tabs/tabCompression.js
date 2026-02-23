const narrowClassName = 'tab--narrow';
const narrowThresholdPx = 60;

let tabObserver = null;

const getObserver = () => {
  if (!tabObserver) {
    tabObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const inlineSize = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        entry.target.classList.toggle(narrowClassName, inlineSize <= narrowThresholdPx);
      }
    });
  }
  return tabObserver;
};

export const observeTabCompression = (tab) => {
  getObserver().observe(tab);
};

export const unobserveTabCompression = (tab) => {
  getObserver().unobserve(tab);
};
