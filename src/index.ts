import { SmoothDrawer } from './core/smooth-drawer';

if (typeof customElements !== 'undefined' && !customElements.get('smooth-drawer')) {
  customElements.define('smooth-drawer', SmoothDrawer);
}

export { SmoothDrawer };
export type {
  BackdropMode,
  DrawerDetent,
  DrawerEventDetail,
  DrawerEventName,
  DrawerState,
  DrawerTheme,
  DrawerTrigger,
  SnapMode
} from './core/smooth-drawer';
