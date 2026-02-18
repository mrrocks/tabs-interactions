import './styles.sass';
import { initializeMotionSlowdownControl } from './motionSpeed';
import { initializePanelInteraction, initializePanelInteractions } from './panelInteraction';
import { initializeTabDrag } from './tabDrag';
import { initializeTabList, initializeTabs } from './tabs';
import { initializeWindowControls } from './windowControls';

initializeMotionSlowdownControl();
initializeWindowControls();
initializeTabs();
initializePanelInteractions();
initializeTabDrag({
  initializePanelInteraction,
  initializeTabList
});
