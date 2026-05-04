import { defineComponent, h, onMounted, onUnmounted, ref, type PropType } from 'vue';
import { SmoothDrawer as SmoothDrawerElement } from './index';
import type { DrawerState, DrawerTheme, SnapMode } from './core/smooth-drawer';

void SmoothDrawerElement;

export const SmoothDrawer = defineComponent({
  name: 'SmoothDrawer',
  props: {
    detents: { type: String, default: undefined },
    detent: { type: String, default: undefined },
    backdrop: { type: String, default: undefined },
    theme: { type: String as PropType<DrawerTheme>, default: undefined },
    themeTransition: { type: String, default: undefined },
    snapMode: { type: String as PropType<SnapMode>, default: undefined },
    hideScrollbar: { type: Boolean, default: false },
    smartKeyboard: { type: Boolean, default: false }
  },
  emits: {
    'detent-change': (_state: DrawerState) => true,
    'detent-changing': (_state: DrawerState) => true,
    progress: (_state: DrawerState) => true
  },
  setup(props, { emit, expose, slots }) {
    const drawerEl = ref<any>();

    const onChange = (e: CustomEvent<DrawerState>) => emit('detent-change', e.detail);
    const onChanging = (e: CustomEvent<DrawerState>) => emit('detent-changing', e.detail);
    const onProgress = (e: CustomEvent<DrawerState>) => emit('progress', e.detail);

    onMounted(() => {
      drawerEl.value?.addEventListener('detent-change', onChange as EventListener);
      drawerEl.value?.addEventListener('detent-changing', onChanging as EventListener);
      drawerEl.value?.addEventListener('drawer-progress', onProgress as EventListener);
    });

    onUnmounted(() => {
      drawerEl.value?.removeEventListener('detent-change', onChange as EventListener);
      drawerEl.value?.removeEventListener('detent-changing', onChanging as EventListener);
      drawerEl.value?.removeEventListener('drawer-progress', onProgress as EventListener);
    });

    expose({
      show: (name?: string) => drawerEl.value?.show(name),
      hide: () => drawerEl.value?.hide(),
      toggle: () => drawerEl.value?.toggle(),
      snapTo: (name: string) => drawerEl.value?.snapTo(name),
      next: () => drawerEl.value?.next(),
      previous: () => drawerEl.value?.previous(),
      getState: () => drawerEl.value?.getState(),
      refreshLayout: () => drawerEl.value?.refreshLayout()
    });

    return () => h('smooth-drawer', {
      ref: drawerEl,
      detents: props.detents,
      detent: props.detent,
      backdrop: props.backdrop,
      theme: props.theme,
      'theme-transition': props.themeTransition,
      'snap-mode': props.snapMode,
      'hide-scrollbar': props.hideScrollbar ? '' : undefined,
      'smart-keyboard': props.smartKeyboard ? '' : undefined
    }, slots.default?.());
  }
});

export default SmoothDrawer;
