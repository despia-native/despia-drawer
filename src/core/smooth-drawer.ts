/*
ARCHITECTURE & DESIGN INVARIANTS

This drawer is a native-scroll component. Its position is the scrollTop of a
CSS overflow container with scroll snap, not a transform driven by JavaScript.
Do not add pointermove handlers, rAF transform animations, or JS scroll
animation loops.

The scroll track must keep pointer-events:auto so iOS Safari and WKWebView
deliver native scroll gestures. Click-through above partial detents is provided
by a track clip-path, which clips both paint and pointer hit testing.

The track clip-path and backdrop opacity are updated synchronously from the
scroll event. They intentionally are not rAF-batched: clip lag can cut off the
drawer tip during fast compositor scrolls, and opacity lag is visible during
slow drags. The clip uses getBoundingClientRect() rather than scrollTop math
because scrollTop can lag the compositor's rendered position. A 64px slack area
sits above the drawer top to cover fast snaps and programmatic smooth scrolls.

Backdrop opacity has no CSS transition. It is quantized to 0.001. Per-scroll DOM
writes are diff-cached. The drawer shadow is written directly on the .drawer
element rather than through host custom properties to avoid invalidating slotted
content on every frame.

Default snap mode is momentum: scroll-snap-type:y proximity and
scroll-snap-stop:normal. snap-mode="strict" switches to mandatory/always.
overscroll-behavior-y:none stays on the track at all times.

The squircle clip-path is layout-time only. It is recomputed on connect, resize,
detent changes, and refreshLayout(), never during scroll.
*/

export type DrawerTrigger = 'drag' | 'user' | 'programmatic' | 'attribute' | 'flick' | 'keyboard' | 'init';
export type BackdropMode = 'none' | 'proportional' | 'large' | `from:${string}`;
export type DrawerTheme = 'light' | 'dark' | 'auto';
export type SnapMode = 'momentum' | 'strict';

export interface DrawerDetent {
  name: string;
  height: number;
  offset: number;
}

export interface DrawerState {
  detent: string;
  previousDetent: string | null;
  height: number;
  progress: number;
  scrollTop: number;
  isOpen: boolean;
  isDragging: boolean;
  trigger: DrawerTrigger;
  detents: DrawerDetent[];
}

export interface DrawerEventDetail extends DrawerState {
  targetDetent?: string;
}

export type DrawerEventName = 'detent-change' | 'detent-changing' | 'drawer-progress';

interface RawDetent {
  name: string;
  raw: string;
}

type SmartKeyboardState = {
  previousDetent: string | null;
  keyboardHeight: number;
  restoreTimer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_DETENTS = 'closed:0, peek:22vh, medium:55vh, large:92vh';
const CLIP_SLACK = 64;

export class SmoothDrawer extends HTMLElement {
  static observedAttributes = ['detents', 'detent', 'backdrop', 'theme', 'theme-transition', 'snap-mode'];

  private _track!: HTMLDivElement;
  private _backdrop!: HTMLDivElement;
  private _closedSpacer!: HTMLDivElement;
  private _drawer!: HTMLDivElement;
  private _handleArea!: HTMLDivElement;
  private _content!: HTMLDivElement;
  private _keyboardSpacer!: HTMLDivElement;

  private _detents: DrawerDetent[] = [];
  private _detentsRaw: RawDetent[] = [];
  private _resizeObserver: ResizeObserver;
  private _scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private _progressFrame = 0;
  private _backdropFrame = 0;
  private _suppressAttrSync = false;
  private _previousDetent: DrawerDetent | null = null;
  private _currentDetent: DrawerDetent | null = null;
  private _lastOpenedDetent = 'medium';
  private _lastTrigger: DrawerTrigger = 'init';
  private _dragging = false;

  private _cachedClipPath = '';
  private _cachedBackdropOpacity = '';
  private _cachedBackdropInteractive: boolean | null = null;
  private _cachedTrackActive: boolean | null = null;
  private _cachedFullyOpen: boolean | null = null;
  private _cachedShadow = '';
  private _cachedSnapMode = '';
  private _cachedContentPadding = '';
  private _despiaAutoScrollEnabled = true;
  private _despiaAutoScrollInterval: ReturnType<typeof setInterval> | null = null;
  private _viewportGuardActive = false;
  private _viewportGuardScrollY = 0;
  private _fakeFocusInput: HTMLInputElement | null = null;

  private _smartKeyboard: SmartKeyboardState = {
    previousDetent: null,
    keyboardHeight: 0,
    restoreTimer: null
  };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          position: fixed;
          inset: 0;
          z-index: var(--drawer-z-index, 999);
          pointer-events: none;
          color-scheme: light dark;
          --drawer-light-bg: #ffffff;
          --drawer-dark-bg: #1c1c1e;
          --drawer-light-fg: #111827;
          --drawer-dark-fg: #f5f5f7;
          --drawer-light-handle: #cccccc;
          --drawer-dark-handle: #48484a;
          --drawer-bg: var(--drawer-light-bg);
          --drawer-fg: var(--drawer-light-fg);
          --drawer-handle: var(--drawer-light-handle);
          --drawer-handle-width: 40px;
          --drawer-handle-height: 5px;
          --drawer-handle-radius: 10px;
          --drawer-backdrop: rgba(0, 0, 0, 0.4);
          --drawer-radius: 56px;
          --drawer-content-padding-x: 24px;
          --drawer-content-padding-top: 8px;
          --drawer-content-padding-bottom: 32px;
          --drawer-duration: 300ms;
          --despia-safe-area-top: var(--safe-area-top, env(safe-area-inset-top, 0px));
          --despia-safe-area-bottom: var(--safe-area-bottom, env(safe-area-inset-bottom, 0px));
        }

        @media (prefers-color-scheme: dark) {
          :host(:not([theme="light"])) {
            --drawer-bg: var(--drawer-dark-bg);
            --drawer-fg: var(--drawer-dark-fg);
            --drawer-handle: var(--drawer-dark-handle);
          }
        }

        :host([theme="dark"]) {
          --drawer-bg: var(--drawer-dark-bg);
          --drawer-fg: var(--drawer-dark-fg);
          --drawer-handle: var(--drawer-dark-handle);
        }

        .backdrop {
          position: fixed;
          inset: 0;
          background: var(--drawer-backdrop);
          opacity: 0;
          pointer-events: none;
          transition: none;
        }

        .backdrop.interactive {
          pointer-events: auto;
        }

        .track {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          height: var(--track-height, 0px);
          overflow-y: scroll;
          overflow-x: hidden;
          scroll-snap-type: y proximity;
          scroll-behavior: smooth;
          overscroll-behavior-y: none;
          overscroll-behavior-x: none;
          pointer-events: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          clip-path: inset(100% 0 0 0);
        }

        .track::-webkit-scrollbar {
          display: none;
        }

        .track.strict,
        :host([snap-mode="strict"]) .track {
          scroll-snap-type: y mandatory;
        }

        .snap {
          scroll-snap-align: start;
          scroll-snap-stop: normal;
        }

        .track.strict .snap,
        :host([snap-mode="strict"]) .snap {
          scroll-snap-stop: always;
        }

        .closed-spacer {
          width: 100%;
          height: var(--track-height, 0px);
          pointer-events: none;
        }

        :host(.backdrop-active) .closed-spacer {
          pointer-events: auto;
        }

        .drawer {
          position: relative;
          height: var(--track-height, 0px);
          background: var(--drawer-bg);
          color: var(--drawer-fg);
          display: flex;
          flex-direction: column;
          transition:
            background-color var(--drawer-duration) ease,
            color var(--drawer-duration) ease;
        }

        .detent-marker {
          position: absolute;
          left: 0;
          right: 0;
          height: 1px;
          pointer-events: none;
        }

        .handle-area {
          flex-shrink: 0;
          padding: 8px 0 4px;
          display: flex;
          justify-content: center;
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
        }

        .handle {
          width: var(--drawer-handle-width);
          height: var(--drawer-handle-height);
          border-radius: var(--drawer-handle-radius);
          background: var(--drawer-handle);
          transition: background-color var(--drawer-duration) ease;
        }

        .content {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding:
            var(--drawer-content-padding-top)
            var(--drawer-content-padding-x)
            max(
              var(--drawer-content-padding-bottom),
              calc(var(--despia-safe-area-bottom) + 16px)
            );
        }

        :host(.fully-open) .content,
        :host(.keyboard-active) .content {
          overflow-y: auto;
          overflow-x: hidden;
          overscroll-behavior-y: contain;
          overscroll-behavior-x: none;
        }

        :host([hide-scrollbar]) .content {
          scrollbar-width: none;
        }

        :host([hide-scrollbar]) .content::-webkit-scrollbar {
          display: none;
        }

        .keyboard-spacer {
          flex-shrink: 0;
          height: 0;
          transition: height 200ms ease;
        }
      </style>

      <div class="backdrop" part="backdrop"></div>
      <div class="track" part="track">
        <div class="snap closed-spacer" data-detent="closed"></div>
        <div class="snap drawer" part="drawer">
          <div class="handle-area" part="handle-area">
            <div class="handle" part="handle"></div>
          </div>
          <div class="content" part="content">
            <slot></slot>
            <div class="keyboard-spacer" part="keyboard-spacer" aria-hidden="true"></div>
          </div>
        </div>
      </div>
    `;

    this._track = this.shadowRoot!.querySelector('.track') as HTMLDivElement;
    this._backdrop = this.shadowRoot!.querySelector('.backdrop') as HTMLDivElement;
    this._closedSpacer = this.shadowRoot!.querySelector('.closed-spacer') as HTMLDivElement;
    this._drawer = this.shadowRoot!.querySelector('.drawer') as HTMLDivElement;
    this._handleArea = this.shadowRoot!.querySelector('.handle-area') as HTMLDivElement;
    this._content = this.shadowRoot!.querySelector('.content') as HTMLDivElement;
    this._keyboardSpacer = this.shadowRoot!.querySelector('.keyboard-spacer') as HTMLDivElement;

    this._onScroll = this._onScroll.bind(this);
    this._onClosedClick = this._onClosedClick.bind(this);
    this._onBackdropClick = this._onBackdropClick.bind(this);
    this._updateLayout = this._updateLayout.bind(this);
    this._onFocusIn = this._onFocusIn.bind(this);
    this._onFocusOut = this._onFocusOut.bind(this);
    this._onVisualViewportResize = this._onVisualViewportResize.bind(this);
    this._onGuardTouchStart = this._onGuardTouchStart.bind(this);
    this._onGuardViewportResize = this._onGuardViewportResize.bind(this);
    this._onGuardScroll = this._onGuardScroll.bind(this);

    this._resizeObserver = new ResizeObserver(this._updateLayout);
  }

  connectedCallback(): void {
    this._track.addEventListener('scroll', this._onScroll, { passive: true });
    this._closedSpacer.addEventListener('click', this._onClosedClick);
    this._backdrop.addEventListener('click', this._onBackdropClick);
    this.addEventListener('focusin', this._onFocusIn);
    this.addEventListener('focusout', this._onFocusOut);
    window.addEventListener('resize', this._updateLayout);
    window.visualViewport?.addEventListener('resize', this._onVisualViewportResize);
    this._resizeObserver.observe(this);

    this._parseDetents();
    this._applyThemeTransition(this.getAttribute('theme-transition') || '300ms');
    requestAnimationFrame(() => this._updateLayout());
  }

  disconnectedCallback(): void {
    this._track.removeEventListener('scroll', this._onScroll);
    this._closedSpacer.removeEventListener('click', this._onClosedClick);
    this._backdrop.removeEventListener('click', this._onBackdropClick);
    this.removeEventListener('focusin', this._onFocusIn);
    this.removeEventListener('focusout', this._onFocusOut);
    window.removeEventListener('resize', this._updateLayout);
    window.visualViewport?.removeEventListener('resize', this._onVisualViewportResize);
    this._resizeObserver.disconnect();
    if (this._scrollTimeout !== null) clearTimeout(this._scrollTimeout);
    if (this._progressFrame) cancelAnimationFrame(this._progressFrame);
    if (this._backdropFrame) cancelAnimationFrame(this._backdropFrame);
    if (this._smartKeyboard.restoreTimer) clearTimeout(this._smartKeyboard.restoreTimer);
    this._deactivateOpenGuards();
    this._setDespiaAutoScroll(true);
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal) return;

    if (name === 'detents') {
      this._parseDetents();
      this._updateLayout();
    } else if (name === 'detent') {
      if (this._suppressAttrSync) return;
      if (newVal !== null) this._goToDetent(newVal, true, 'attribute');
    } else if (name === 'backdrop') {
      this._updateBackdropOpacity();
      this._updateBackdrop();
    } else if (name === 'theme-transition') {
      this._applyThemeTransition(newVal || '300ms');
    } else if (name === 'snap-mode') {
      this._applySnapMode();
    }
  }

  show(name?: string, options: { animate?: boolean; trigger?: DrawerTrigger } = {}): void {
    const target = name
      || this._lastOpenedDetent
      || this._detents.find(d => d.name === 'medium')?.name
      || this._detents.find(d => d.name === 'large')?.name
      || this._detents.find(d => d.name !== 'closed')?.name;

    if (target) this.snapTo(target, { trigger: 'programmatic', ...options });
  }

  hide(options: { animate?: boolean; trigger?: DrawerTrigger } = {}): void {
    this.snapTo('closed', { trigger: 'programmatic', ...options });
  }

  toggle(options: { animate?: boolean; trigger?: DrawerTrigger } = {}): void {
    if (this.isOpen) this.hide(options);
    else this.show(undefined, options);
  }

  next(options: { animate?: boolean; trigger?: DrawerTrigger } = {}): void {
    const currentIdx = this._detents.findIndex(d => d.name === this._currentDetent?.name);
    const nextIdx = Math.min((currentIdx < 0 ? 0 : currentIdx) + 1, this._detents.length - 1);
    const target = this._detents[nextIdx];
    if (target && target.name !== this._currentDetent?.name) {
      this.snapTo(target.name, { trigger: 'programmatic', ...options });
    }
  }

  previous(options: { animate?: boolean; trigger?: DrawerTrigger } = {}): void {
    const currentIdx = this._detents.findIndex(d => d.name === this._currentDetent?.name);
    const prevIdx = Math.max((currentIdx < 0 ? 0 : currentIdx) - 1, 0);
    const target = this._detents[prevIdx];
    if (target && target.name !== this._currentDetent?.name) {
      this.snapTo(target.name, { trigger: 'programmatic', ...options });
    }
  }

  snapTo(name: string, options: { animate?: boolean; trigger?: DrawerTrigger } = {}): boolean {
    const target = this._detents.find(d => d.name === name);
    if (!target) {
      console.warn(`[smooth-drawer] Unknown detent: "${name}". Available: ${this._detents.map(d => d.name).join(', ')}`);
      return false;
    }

    this._suppressAttrSync = true;
    this.setAttribute('detent', name);
    this._suppressAttrSync = false;
    this._goToDetent(name, options.animate ?? true, options.trigger ?? 'programmatic');
    return true;
  }

  getState(): DrawerState {
    const largest = this._largestHeight();
    const scrollTop = this._track.scrollTop;
    return {
      detent: this._currentDetent?.name || this.getAttribute('detent') || 'closed',
      previousDetent: this._previousDetent?.name || null,
      height: scrollTop,
      progress: largest > 0 ? Math.max(0, Math.min(scrollTop / largest, 1)) : 0,
      scrollTop,
      isOpen: this.isOpen,
      isDragging: this._dragging,
      trigger: this._lastTrigger,
      detents: this.detentList
    };
  }

  refreshLayout(): void {
    this._updateLayout();
  }

  get detent(): string {
    return this.getAttribute('detent') || this._currentDetent?.name || 'closed';
  }

  get detentList(): DrawerDetent[] {
    return this._detents.map(d => ({ name: d.name, height: d.height, offset: d.offset }));
  }

  get isOpen(): boolean {
    return this.detent !== 'closed';
  }

  get isDragging(): boolean {
    return this._dragging;
  }

  get open(): boolean {
    return this.isOpen;
  }

  private _applyThemeTransition(value: string): void {
    this.style.setProperty('--drawer-duration', value);
  }

  private _parseDetents(): void {
    const raw = this.getAttribute('detents') || DEFAULT_DETENTS;
    const parsed = raw.split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const [name, ...rest] = part.split(':');
        return { name: name?.trim() || '', raw: rest.join(':').trim() };
      })
      .filter((d): d is RawDetent => Boolean(d.name && d.raw));

    if (!parsed.some(d => d.name === 'closed')) {
      parsed.unshift({ name: 'closed', raw: '0' });
    }

    this._detentsRaw = parsed;
  }

  private _resolveHeight(value: string): number {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const v = value.trim();
    if (v.endsWith('dvh')) return (parseFloat(v) / 100) * viewportHeight;
    if (v.endsWith('vh')) return (parseFloat(v) / 100) * viewportHeight;
    if (v.endsWith('px')) return parseFloat(v);
    if (v.endsWith('%')) return (parseFloat(v) / 100) * viewportHeight;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  private _updateLayout(): void {
    if (!this._detentsRaw.length) return;

    this._detents = this._detentsRaw
      .map(d => {
        const height = Math.max(0, this._resolveHeight(d.raw));
        return { name: d.name, height, offset: height };
      })
      .sort((a, b) => a.height - b.height);

    const largest = this._largestHeight();
    this.style.setProperty('--track-height', `${largest}px`);
    this._track.style.setProperty('--track-height', `${largest}px`);
    this._drawer.style.height = `${largest}px`;
    this._closedSpacer.style.height = `${largest}px`;

    this.shadowRoot!.querySelectorAll('.detent-marker').forEach(marker => marker.remove());
    for (const detent of this._detents) {
      if (detent.name === 'closed' || detent.height === largest) continue;
      const marker = document.createElement('div');
      marker.className = 'snap detent-marker';
      marker.dataset.detent = detent.name;
      marker.style.top = `${detent.offset}px`;
      this._track.appendChild(marker);
    }

    this._applySnapMode();
    this._updateSquircle();

    const initial = this.getAttribute('detent') || 'closed';
    this._goToDetent(initial, false, this._lastTrigger);
    this._updateClipPath();
    this._updateBackdropOpacity();
    this._updateBackdrop();
  }

  private _goToDetent(name: string, animate: boolean, trigger: DrawerTrigger = 'programmatic'): void {
    const target = this._detents.find(d => d.name === name);
    if (!target) return;

    this._lastTrigger = trigger;
    if (target.name !== 'closed') {
      this._activateOpenGuards();
      this._setDespiaAutoScroll(false);
    }
    this._emit('detent-changing', { targetDetent: target.name });
    this._track.scrollTo({
      top: target.offset,
      behavior: animate ? 'smooth' : 'auto'
    });
    this._updateClipPath();
    this._updateBackdropOpacity();
    this._updateBackdrop();
  }

  private _setDespiaAutoScroll(enabled: boolean): void {
    if (!this._isDespiaRuntime()) return;
    if (this._despiaAutoScrollEnabled === enabled) return;
    this._despiaAutoScrollEnabled = enabled;
    this._openBridge(`preventdefault://autoscroll?enabled=${enabled ? 'true' : 'false'}`);
  }

  private _haptic(mode: 'light' | 'heavy'): void {
    if (!this._isDespiaRuntime()) return;
    this._openBridge(mode === 'heavy' ? 'heavyhaptic://' : 'lighthaptic://');
  }

  private _isDespiaRuntime(): boolean {
    return navigator.userAgent.toLowerCase().includes('despia');
  }

  private _openBridge(url: string): void {
    try {
      (window as Window & { despia?: string }).despia = url;
    } catch {
      // Custom-scheme bridge calls are best-effort outside Despia WKWebView.
    }
  }

  private _activateOpenGuards(): void {
    if (!this._viewportGuardActive) {
      this._viewportGuardActive = true;
      this._viewportGuardScrollY = window.scrollY;
      this.addEventListener('touchstart', this._onGuardTouchStart, { capture: true, passive: false });
      window.addEventListener('scroll', this._onGuardScroll, { passive: true });
      window.visualViewport?.addEventListener('resize', this._onGuardViewportResize);
    }

    if (this._isDespiaRuntime() && this._despiaAutoScrollInterval === null) {
      this._openBridge('preventdefault://autoscroll?enabled=false');
      this._despiaAutoScrollInterval = setInterval(() => {
        this._openBridge('preventdefault://autoscroll?enabled=false');
      }, 500);
    }
  }

  private _deactivateOpenGuards(): void {
    if (this._despiaAutoScrollInterval !== null) {
      clearInterval(this._despiaAutoScrollInterval);
      this._despiaAutoScrollInterval = null;
    }

    if (this._viewportGuardActive) {
      this._viewportGuardActive = false;
      this.removeEventListener('touchstart', this._onGuardTouchStart, { capture: true });
      window.removeEventListener('scroll', this._onGuardScroll);
      window.visualViewport?.removeEventListener('resize', this._onGuardViewportResize);
    }

    this._fakeFocusInput?.remove();
    this._fakeFocusInput = null;
  }

  private _onGuardTouchStart(event: TouchEvent): void {
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement) || !this._isTextInput(target)) return;
    if (!this.hasAttribute('smart-keyboard')) return;

    event.preventDefault();
    this._viewportGuardScrollY = window.scrollY;

    const fakeInput = this._getFakeFocusInput();
    fakeInput.focus({ preventScroll: true });

    window.setTimeout(() => {
      target.focus({ preventScroll: true });
      window.scrollTo(0, this._viewportGuardScrollY);
    }, 150);
  }

  private _onGuardViewportResize(): void {
    if (!this._viewportGuardActive || !window.visualViewport) return;
    if (window.visualViewport.height < window.innerHeight) {
      window.scrollTo(0, this._viewportGuardScrollY);
    }
  }

  private _onGuardScroll(): void {
    if (!this._viewportGuardActive) return;
    if (!window.visualViewport || window.visualViewport.height >= window.innerHeight) {
      this._viewportGuardScrollY = window.scrollY;
    }
  }

  private _getFakeFocusInput(): HTMLInputElement {
    if (this._fakeFocusInput) return this._fakeFocusInput;
    const input = document.createElement('input');
    input.type = 'text';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(input);
    this._fakeFocusInput = input;
    return input;
  }

  private _emit(eventName: DrawerEventName, extraDetail: Partial<DrawerEventDetail> = {}): void {
    this.dispatchEvent(new CustomEvent(eventName, {
      bubbles: true,
      composed: true,
      detail: { ...this.getState(), ...extraDetail }
    }));
  }

  private _updateClipPath(): void {
    if (this.classList.contains('backdrop-active')) {
      if (this._cachedClipPath !== '') {
        this._track.style.clipPath = '';
        this._cachedClipPath = '';
      }
      return;
    }

    const trackRect = this._track.getBoundingClientRect();
    const drawerRect = this._drawer.getBoundingClientRect();
    const top = Math.max(0, Math.round(drawerRect.top - trackRect.top - CLIP_SLACK));
    const value = `inset(${top}px 0 0 0)`;
    if (value !== this._cachedClipPath) {
      this._track.style.clipPath = value;
      this._cachedClipPath = value;
    }
  }

  private _updateBackdropOpacity(): void {
    if (!this._detents.length) return;

    const opacity = this._computeBackdropOpacity(this._track.scrollTop);
    const value = opacity.toFixed(3);
    if (value !== this._cachedBackdropOpacity) {
      this._backdrop.style.opacity = value;
      this._cachedBackdropOpacity = value;
    }

    const shadowAlpha = Math.min((this._track.scrollTop > 0 ? 0.05 : 0) + opacity * 0.12, 0.18);
    const shadow = `0 -10px 30px rgba(0, 0, 0, ${shadowAlpha.toFixed(3)})`;
    if (shadow !== this._cachedShadow) {
      this._drawer.style.boxShadow = shadow;
      this._cachedShadow = shadow;
    }
  }

  private _updateBackdrop(): void {
    if (this._backdropFrame) return;
    this._backdropFrame = requestAnimationFrame(() => {
      this._backdropFrame = 0;
      const h = this._track.scrollTop;
      const opacity = this._computeBackdropOpacity(h);
      const interactive = opacity > 0.05 && this._isBackdropInteractive(h);
      if (interactive !== this._cachedBackdropInteractive) {
        this._backdrop.classList.toggle('interactive', interactive);
        this._cachedBackdropInteractive = interactive;
      }

      const backdropActive = interactive || opacity > 0.05;
      const wasBackdropActive = this.classList.contains('backdrop-active');
      if (backdropActive !== wasBackdropActive) {
        this.classList.toggle('backdrop-active', backdropActive);
        this._updateClipPath();
      }

      const wasFullyOpen = this._cachedFullyOpen === true;
      const atLargest = wasFullyOpen
        ? h > this._largestHeight() - 12
        : h >= this._largestHeight() - 8;
      if (atLargest !== this._cachedFullyOpen) {
        this.classList.toggle('fully-open', atLargest);
        this._cachedFullyOpen = atLargest;
      }
    });
  }

  private _onScroll(): void {
    this._dragging = true;
    this._lastTrigger = this._lastTrigger === 'programmatic' || this._lastTrigger === 'attribute' || this._lastTrigger === 'keyboard'
      ? this._lastTrigger
      : 'drag';
    this._updateClipPath();
    this._updateBackdropOpacity();
    this._updateBackdrop();

    if (!this._progressFrame) {
      this._progressFrame = requestAnimationFrame(() => {
        this._progressFrame = 0;
        this._emit('drawer-progress');
      });
    }

    if (this._scrollTimeout !== null) clearTimeout(this._scrollTimeout);
    this._scrollTimeout = setTimeout(() => {
      this._dragging = false;
      const settled = this._closestDetent(this._track.scrollTop);
      if (!settled) return;

      const changed = this._currentDetent?.name !== settled.name;
      if (changed) {
        this._previousDetent = this._currentDetent;
        this._currentDetent = settled;

        if (settled.name !== this.getAttribute('detent')) {
          this._suppressAttrSync = true;
          this.setAttribute('detent', settled.name);
          this._suppressAttrSync = false;
        }

        if (settled.name !== 'closed') {
          this._lastOpenedDetent = settled.name;
        }

        this._setDespiaAutoScroll(settled.name === 'closed');
        this._haptic(settled.height === this._largestHeight() && settled.name !== 'closed' ? 'heavy' : 'light');
        this._emit('detent-change');
      }

      this._lastTrigger = 'drag';

      if (settled.name === 'closed') {
        this._deactivateOpenGuards();
      }
    }, 120);
  }

  private _onClosedClick(): void {
    if (this._cachedBackdropInteractive) {
      this.snapTo('closed', { trigger: 'user' });
    }
  }

  private _onBackdropClick(): void {
    this.snapTo('closed', { trigger: 'user' });
  }

  private _updateSquircle(): void {
    const rect = this._drawer.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height + 1;
    if (!w || !h) return;

    const cssRadius = parseFloat(getComputedStyle(this).getPropertyValue('--drawer-radius'));
    const r = Math.min(Number.isFinite(cssRadius) ? cssRadius : 56, w / 2, h);
    const n = 4;
    const steps = 48;

    const arc: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * (Math.PI / 2);
      arc.push([
        r * Math.pow(Math.cos(t), 2 / n),
        r * Math.pow(Math.sin(t), 2 / n)
      ]);
    }

    let d = `M ${r.toFixed(3)} 0 `;
    d += `L ${(w - r).toFixed(3)} 0 `;
    for (let i = 0; i <= steps; i++) {
      const point = arc[i];
      if (!point) continue;
      const [px, py] = point;
      d += `L ${(w - r + py).toFixed(3)} ${(r - px).toFixed(3)} `;
    }
    d += `L ${w.toFixed(3)} ${h.toFixed(3)} `;
    d += `L 0 ${h.toFixed(3)} `;
    d += `L 0 ${r.toFixed(3)} `;
    for (let i = steps; i >= 0; i--) {
      const point = arc[i];
      if (!point) continue;
      const [px, py] = point;
      d += `L ${(r - py).toFixed(3)} ${(r - px).toFixed(3)} `;
    }
    d += 'Z';

    this._drawer.style.clipPath = `path('${d}')`;
  }

  private _applySnapMode(): void {
    const mode = (this.getAttribute('snap-mode') || 'momentum') as SnapMode;
    if (mode === this._cachedSnapMode) return;
    this._track.classList.toggle('strict', mode === 'strict');
    this._cachedSnapMode = mode;
  }

  private _computeBackdropOpacity(height: number): number {
    const mode = (this.getAttribute('backdrop') || 'proportional') as BackdropMode;
    const largest = this._largestHeight();
    if (!largest || mode === 'none') return 0;
    if (mode === 'proportional') return Math.max(0, Math.min(height / largest, 1));
    if (mode === 'large') {
      const prev = this._detents[this._detents.length - 2]?.height || 0;
      const span = largest - prev;
      return span > 0 ? Math.max(0, Math.min((height - prev) / span, 1)) : 0;
    }
    if (mode.startsWith('from:')) {
      const fromName = mode.slice(5).trim();
      const fromIdx = this._detents.findIndex(d => d.name === fromName);
      if (fromIdx <= 0) return 0;
      const fromHeight = this._detents[fromIdx]?.height || 0;
      const prev = this._detents[fromIdx - 1]?.height || 0;
      const span = fromHeight - prev;
      if (height >= fromHeight) return 1;
      return span > 0 ? Math.max(0, Math.min((height - prev) / span, 1)) : 0;
    }
    return 0;
  }

  private _isBackdropInteractive(height: number): boolean {
    const mode = (this.getAttribute('backdrop') || 'proportional') as BackdropMode;
    if (mode === 'none') return false;
    if (mode === 'proportional') return height > 10;
    if (mode === 'large') return height >= this._largestHeight() - 5;
    if (mode.startsWith('from:')) {
      const fromName = mode.slice(5).trim();
      const from = this._detents.find(d => d.name === fromName);
      return Boolean(from && height >= from.height - 5);
    }
    return false;
  }

  private _closestDetent(height: number): DrawerDetent | null {
    return this._detents.reduce<DrawerDetent | null>((closest, detent) => {
      if (!closest) return detent;
      return Math.abs(detent.offset - height) < Math.abs(closest.offset - height) ? detent : closest;
    }, null);
  }

  private _largestHeight(): number {
    return this._detents[this._detents.length - 1]?.height || 0;
  }

  private _setTrackActive(active: boolean): void {
    if (active === this._cachedTrackActive) return;
    this._track.classList.toggle('active', active);
    this._cachedTrackActive = active;
  }

  private _onFocusIn(event: FocusEvent): void {
    if (!this.hasAttribute('smart-keyboard')) return;
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement) || !this._isTextInput(target)) return;
    if (this._smartKeyboard.restoreTimer) clearTimeout(this._smartKeyboard.restoreTimer);
    this._smartKeyboard.previousDetent ||= this.detent;
    this.classList.add('keyboard-active');
    const targetDetent = this._largestKeyboardDetent();
    if (targetDetent) this.snapTo(targetDetent.name, { trigger: 'keyboard' });
    this._syncKeyboardPadding();
    requestAnimationFrame(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  private _onFocusOut(): void {
    if (!this.hasAttribute('smart-keyboard')) return;
    if (this._smartKeyboard.restoreTimer) clearTimeout(this._smartKeyboard.restoreTimer);
    this._smartKeyboard.restoreTimer = setTimeout(() => {
      const active = this.getRootNode() instanceof Document ? document.activeElement : null;
      if (active instanceof HTMLElement && this.contains(active) && this._isTextInput(active)) return;
      const previous = this._smartKeyboard.previousDetent;
      this._smartKeyboard.previousDetent = null;
      this._smartKeyboard.keyboardHeight = 0;
      this.classList.remove('keyboard-active');
      this._setContentPadding('');
      if (previous && previous !== this.detent) this.snapTo(previous, { trigger: 'keyboard' });
    }, 120);
  }

  private _onVisualViewportResize(): void {
    if (!this.hasAttribute('smart-keyboard')) return;
    this._syncKeyboardPadding();
  }

  private _syncKeyboardPadding(): void {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const keyboardHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    this._smartKeyboard.keyboardHeight = keyboardHeight;
    this.classList.toggle('keyboard-active', keyboardHeight > 100);
    this._setContentPadding(keyboardHeight > 0 ? `${keyboardHeight + 24}px` : '');
  }

  private _setContentPadding(value: string): void {
    if (value === this._cachedContentPadding) return;
    if (value) this._keyboardSpacer.style.height = value;
    else this._keyboardSpacer.style.removeProperty('height');
    this._cachedContentPadding = value;
  }

  private _largestKeyboardDetent(): DrawerDetent | null {
    const max = (window.visualViewport?.height || window.innerHeight) * 0.9;
    return [...this._detents].reverse().find(d => d.name !== 'closed' && d.height <= max)
      || this._detents.find(d => d.name !== 'closed')
      || null;
  }

  private _isTextInput(el: HTMLElement): boolean {
    if (el instanceof HTMLTextAreaElement) return true;
    if (!(el instanceof HTMLInputElement)) return false;
    return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(el.type);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'smooth-drawer': SmoothDrawer;
  }
}
