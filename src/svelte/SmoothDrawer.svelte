<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import '@despia/drawer';

  export let detents: string | undefined = undefined;
  export let detent: string | undefined = undefined;
  export let backdrop: string | undefined = undefined;
  export let theme: 'light' | 'dark' | 'auto' | undefined = undefined;
  export let themeTransition: string | undefined = undefined;
  export let snapMode: 'momentum' | 'strict' | undefined = undefined;
  export let hideScrollbar: boolean = false;
  export let smartKeyboard: boolean = false;
  export let dismissable: boolean = true;

  let el: any;
  const dispatch = createEventDispatcher();

  const onChange = (e: CustomEvent) => dispatch('detent-change', e.detail);
  const onChanging = (e: CustomEvent) => dispatch('detent-changing', e.detail);
  const onProgress = (e: CustomEvent) => dispatch('progress', e.detail);

  onMount(() => {
    el?.addEventListener('detent-change', onChange);
    el?.addEventListener('detent-changing', onChanging);
    el?.addEventListener('drawer-progress', onProgress);
  });

  onDestroy(() => {
    el?.removeEventListener('detent-change', onChange);
    el?.removeEventListener('detent-changing', onChanging);
    el?.removeEventListener('drawer-progress', onProgress);
  });

  export const show = (name?: string) => el?.show(name);
  export const hide = () => el?.hide();
  export const toggle = () => el?.toggle();
  export const snapTo = (name: string) => el?.snapTo(name);
  export const next = () => el?.next();
  export const previous = () => el?.previous();
  export const getState = () => el?.getState();
  export const refreshLayout = () => el?.refreshLayout();
</script>

<smooth-drawer
  bind:this={el}
  detents={detents}
  detent={detent}
  backdrop={backdrop}
  theme={theme}
  theme-transition={themeTransition}
  snap-mode={snapMode}
  hide-scrollbar={hideScrollbar ? '' : undefined}
  smart-keyboard={smartKeyboard ? '' : undefined}
  dismissable={dismissable === false ? 'false' : undefined}
>
  <slot />
</smooth-drawer>
