# @despia/drawer

iOS-style bottom-sheet drawer with native CSS scroll-snap, named detents, real squircle corners, structured events, and wrappers for React, Vue, Svelte, Angular, vanilla JS, and Web Components.

> Built by [Despia](https://setup.despia.com) for web apps that need to feel at home on mobile. Pair it with Despia Native when you are ready to add device features and ship the same web app to the stores.

## Installation

```bash
npm install @despia/drawer
pnpm add @despia/drawer
yarn add @despia/drawer
```

CDN:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@despia/drawer"></script>
<script src="https://unpkg.com/@despia/drawer/dist/index.umd.js"></script>
```

Demo: [open the vanilla demo on jsDelivr](https://cdn.jsdelivr.net/npm/@despia/drawer/examples/vanilla/index.html). It is served straight from the published npm package, so no separate demo hosting is required.

## Vanilla

```html
<script type="module">
  import '@despia/drawer';
</script>

<button onclick="drawer.show('large')">Open</button>

<smooth-drawer
  id="drawer"
  detents="closed:0, peek:22vh, medium:55vh, large:92vh"
  detent="peek"
  backdrop="from:large"
>
  <h2>Hello drawer</h2>
</smooth-drawer>
```

Multiple drawers on the same page are supported. Target the instance you want by `id`, class, or any selector:

```html
<button onclick="document.getElementById('cartDrawer').show('large')">
  Open cart
</button>

<button onclick="document.getElementById('profileDrawer').show('medium')">
  Open profile
</button>

<smooth-drawer id="cartDrawer">
  <h2>Cart</h2>
</smooth-drawer>

<smooth-drawer id="profileDrawer">
  <h2>Profile</h2>
</smooth-drawer>
```

Or with `querySelector`:

```html
<button onclick="document.querySelector('.cart-drawer')?.show('large')">
  Open cart
</button>

<smooth-drawer class="cart-drawer">
  <h2>Cart</h2>
</smooth-drawer>
```

## Frameworks

React:

```tsx
import { SmoothDrawer, type DrawerHandle } from '@despia/drawer/react';
import { useRef } from 'react';

const ref = useRef<DrawerHandle>(null);

<SmoothDrawer ref={ref} onDetentChange={(state) => console.log(state.detent)}>
  <h2>Hello</h2>
</SmoothDrawer>;
```

Vue:

```vue
<script setup lang="ts">
import { SmoothDrawer } from '@despia/drawer/vue';
</script>

<template>
  <SmoothDrawer @detent-change="state => console.log(state.detent)">
    <h2>Hello</h2>
  </SmoothDrawer>
</template>
```

Svelte:

```svelte
<script lang="ts">
  import SmoothDrawer from '@despia/drawer/svelte';
  let drawer: SmoothDrawer;
</script>

<SmoothDrawer bind:this={drawer} on:detent-change={(e) => console.log(e.detail.detent)}>
  <h2>Hello</h2>
</SmoothDrawer>
```

Angular:

```ts
import { SmoothDrawerComponent } from '@despia/drawer/angular';

@Component({
  standalone: true,
  imports: [SmoothDrawerComponent],
  template: `
    <despia-smooth-drawer #drawer (detentChange)="onChange($event)">
      <h2>Hello</h2>
    </despia-smooth-drawer>
  `
})
export class AppComponent {}
```

## API

Attributes:

| Attribute | Values | Default |
|---|---|---|
| `detents` | `name:height, name:height` | `closed:0, peek:22vh, medium:55vh, large:92vh` |
| `detent` | detent name | `closed` |
| `backdrop` | `none`, `proportional`, `large`, `from:<name>` | `proportional` |
| `snap-mode` | `momentum`, `strict` | `momentum` |
| `theme` | `light`, `dark`, `auto` | `auto` |
| `theme-transition` | duration | `300ms` |
| `hide-scrollbar` | boolean attribute | absent |
| `smart-keyboard` | boolean attribute | absent |

Events:

| Event | When |
|---|---|
| `detent-change` | Drawer settles at a new detent |
| `detent-changing` | Programmatic scroll starts toward a detent |
| `drawer-progress` | rAF-throttled during scroll |

Methods:

| Method | Description |
|---|---|
| `show(name?)` | Open to a detent or the last open detent |
| `hide()` | Snap to `closed` |
| `toggle()` | Open or close |
| `snapTo(name)` | Snap to a named detent |
| `next()` / `previous()` | Move through detents |
| `getState()` | Return the structured drawer state |
| `refreshLayout()` | Recompute markers and squircle after CSS changes |

## Styling

Use custom properties and parts:

```css
smooth-drawer {
  --drawer-bg: #f0f8ff;
  --drawer-handle: #88aacc;
  --drawer-radius: 32px;
}

smooth-drawer::part(drawer) {
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}
```

Parts: `backdrop`, `track`, `drawer`, `handle-area`, `handle`, `content`.

## Why It's Fast

Motion is native browser scrolling with CSS `scroll-snap-type`. The drawer does not animate with JavaScript transforms, and there are no `pointermove` drag loops. Scroll-linked work is limited to synchronous hit-area clipping and backdrop opacity updates.

It also guards the rough edges that make web drawers feel webby: overscroll is contained so hard flicks do not pull the sheet past its largest detent, and the hit-area clip has extra headroom so fast snaps do not visually cut off the drawer's rounded top.

## Browser Support

Modern evergreen browsers, iOS Safari 15+, and WKWebView 15+.

## Native WebViews

`@despia/drawer` helps web apps feel closer to native drawer experiences: compositor scrolling, safe-area support, haptics when available, and WebView-friendly gesture handling. When you are ready to pair that UI with real native capabilities and ship to the App Store or Google Play, [Despia Native](https://setup.despia.com) lets the same web app call device features and publish from the browser. The drawer still works as a plain custom element everywhere else.

Inside the Despia runtime, the drawer also coordinates with the native shell while open: it keeps host auto-scroll disabled, restores it after the drawer fully closes, and uses a smart-keyboard guard to reduce mobile viewport jumps when inputs receive focus.

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
```

The vanilla demo lives at `examples/vanilla/index.html` and can be hosted with GitHub Pages after building.

## License

MIT
