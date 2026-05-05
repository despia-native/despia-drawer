import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ReactNode
} from 'react';
import { SmoothDrawer as SmoothDrawerElement } from './index';
import type { DrawerState, DrawerTheme, SnapMode } from './core/smooth-drawer';

void SmoothDrawerElement;

export type DrawerHandle = {
  show: (name?: string) => void;
  hide: () => void;
  toggle: () => void;
  snapTo: (name: string) => void;
  next: () => void;
  previous: () => void;
  getState: () => DrawerState;
  refreshLayout: () => void;
};

export type SmoothDrawerProps = {
  detents?: string;
  detent?: string;
  backdrop?: string;
  theme?: DrawerTheme;
  themeTransition?: string;
  snapMode?: SnapMode;
  hideScrollbar?: boolean;
  smartKeyboard?: boolean;
  dismissable?: boolean;
  onDetentChange?: (state: DrawerState) => void;
  onDetentChanging?: (state: DrawerState) => void;
  onProgress?: (state: DrawerState) => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export const SmoothDrawer = forwardRef<DrawerHandle, SmoothDrawerProps>(
  function SmoothDrawer(props, ref) {
    const elRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      show: (name) => elRef.current?.show(name),
      hide: () => elRef.current?.hide(),
      toggle: () => elRef.current?.toggle(),
      snapTo: (name) => elRef.current?.snapTo(name),
      next: () => elRef.current?.next(),
      previous: () => elRef.current?.previous(),
      getState: () => elRef.current?.getState(),
      refreshLayout: () => elRef.current?.refreshLayout()
    }), []);

    useEffect(() => {
      const el = elRef.current;
      if (!el) return;

      const onChange = (e: CustomEvent<DrawerState>) => props.onDetentChange?.(e.detail);
      const onChanging = (e: CustomEvent<DrawerState>) => props.onDetentChanging?.(e.detail);
      const onProgress = (e: CustomEvent<DrawerState>) => props.onProgress?.(e.detail);

      el.addEventListener('detent-change', onChange as EventListener);
      el.addEventListener('detent-changing', onChanging as EventListener);
      el.addEventListener('drawer-progress', onProgress as EventListener);

      return () => {
        el.removeEventListener('detent-change', onChange as EventListener);
        el.removeEventListener('detent-changing', onChanging as EventListener);
        el.removeEventListener('drawer-progress', onProgress as EventListener);
      };
    }, [props.onDetentChange, props.onDetentChanging, props.onProgress]);

    return (
      <smooth-drawer
        ref={elRef}
        detents={props.detents}
        detent={props.detent}
        backdrop={props.backdrop}
        theme={props.theme}
        theme-transition={props.themeTransition}
        snap-mode={props.snapMode}
        hide-scrollbar={props.hideScrollbar ? '' : undefined}
        smart-keyboard={props.smartKeyboard ? '' : undefined}
        dismissable={props.dismissable === false ? 'false' : undefined}
        className={props.className}
        style={props.style}
      >
        {props.children}
      </smooth-drawer>
    );
  }
);

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'smooth-drawer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          detents?: string;
          detent?: string;
          backdrop?: string;
          theme?: string;
          'theme-transition'?: string;
          'snap-mode'?: SnapMode;
          'hide-scrollbar'?: string;
          'smart-keyboard'?: string;
          dismissable?: string;
        },
        HTMLElement
      >;
    }
  }
}
