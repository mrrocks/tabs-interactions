import './styles.sass';
import { initializeMotionSlowdownControl } from './motion/motionSpeed';
import { initializePanelInteraction, initializePanelInteractions } from './panel/panelInteraction';
import { initializeTabDrag } from './tabDrag/tabDrag';
import { initializeTabList, initializeTabs } from './tabs/tabs';
import { initializeWindowControls } from './window/windowControls';
import { initializeWindowFocus } from './window/windowFocus';

initializeMotionSlowdownControl();
initializeWindowFocus();
initializeWindowControls();
initializeTabs();
initializePanelInteractions();
initializeTabDrag({
  initializePanelInteraction,
  initializeTabList
});

window.addEventListener('load', () => {
  document.body.classList.add('loaded');
  
  requestAnimationFrame(() => {
    document.body.classList.remove('preload');
  });
});

