import './styles.sass';
import { initializeMotionSlowdownControl } from './motionSpeed';
import { initializePanelInteraction, initializePanelInteractions } from './panelInteraction';
import { initializeTabDrag } from './tabDrag';
import { initializeTabList, initializeTabs } from './tabs';
import { initializeWindowControls } from './windowControls';
import { initializeWindowFocus } from './windowFocus';

initializeMotionSlowdownControl();
initializeWindowFocus();
initializeWindowControls();
initializeTabs();
initializePanelInteractions();
initializeTabDrag({
  initializePanelInteraction,
  initializeTabList
});
