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

type PageScrollLockSnapshot = {
  scrollY: number;
  html: Record<string, string>;
  body: Record<string, string>;
};

type FocusLockState = 'idle' | 'arming' | 'engaged' | 'releasing';
type FocusLockMode = 'none' | 'resizes-content' | 'body-fixed';
type TouchGestureMode = 'idle' | 'tap' | 'sheet' | 'content';

type InertSnapshot = {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
};

type TouchGestureState = {
  active: boolean;
  mode: TouchGestureMode;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTrackScrollTop: number;
  startContentScrollTop: number;
  startedInContent: boolean;
  startedOnTextInput: boolean;
};

const DEFAULT_DETENTS = 'closed:0, peek:22vh, medium:55vh, large:92vh';
const CLIP_SLACK = 64;
/** Extra scroll room beyond measured keyboard (viewport overlap can lag on focus). */
const KEYBOARD_EXTRA_PADDING_MAX_VH = 0.15;
/** Keep focused fields comfortably above the keyboard so nearby fields are easy to tap. */
const KEYBOARD_SCROLL_COMFORT_MAX_VH = 0.12;
const PROGRESS_EMIT_DELTA = 0.005;
const SHEET_DRAG_BLUR_THRESHOLD = 30;
const KEYBOARD_ACTIVE_ON_THRESHOLD = 90;
const KEYBOARD_ACTIVE_OFF_THRESHOLD = 48;

export class SmoothDrawer extends HTMLElement {
  static observedAttributes = ['detents', 'detent', 'backdrop', 'theme', 'theme-transition', 'snap-mode', 'dismissable'];
  private static readonly _stackBaseZIndex = 999;
  private static _openStack: SmoothDrawer[] = [];
  private static _titleIdCounter = 0;
  private static _instanceIdCounter = 0;
  private readonly _instanceId = ++SmoothDrawer._instanceIdCounter;

  private _track!: HTMLDivElement;
  private _backdrop!: HTMLDivElement;
  private _closedSpacer!: HTMLDivElement;
  private _drawer!: HTMLDivElement;
  private _handleArea!: HTMLDivElement;
  private _content!: HTMLDivElement;
  private _keyboardSpacer!: HTMLDivElement;
  private _hapticSwitchLabel!: HTMLLabelElement;

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
  private _lastTrackScrollTop = 0;
  private _dragging = false;

  private _cachedClipPath = '';
  private _cachedBackdropOpacity = '';
  private _cachedBackdropInteractive: boolean | null = null;
  private _cachedFullyOpen: boolean | null = null;
  private _cachedShadow = '';
  private _cachedSnapMode = '';
  private _cachedContentPadding = '';
  private _viewportGuardActive = false;
  private _viewportGuardScrollY = 0;
  private _contentAutoScrollTimers: ReturnType<typeof setTimeout>[] = [];
  private _autoScrollLockTimer: ReturnType<typeof setTimeout> | null = null;
  private _keyboardPaddingReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private _isAutoScrolling = false;
  private _pageScrollLock: PageScrollLockSnapshot | null = null;
  private _pendingFocusGuardTimer: ReturnType<typeof setTimeout> | null = null;
  private _focusedTextInput: HTMLElement | null = null;
  private _lastLayoutWidth = 0;
  private _lastLayoutHeight = 0;
  private _smallestViewportHeight = 0;
  private _focusLockState: FocusLockState = 'idle';
  private _focusLockMode: FocusLockMode = 'none';
  private _htmlLockSnapshot: Record<string, string> | null = null;
  private _viewportMetaTouched = false;
  private _reducedMotion = false;
  private _reducedMotionQuery: MediaQueryList | null = null;
  private _cachedDetentList: DrawerDetent[] = [];
  private _lastProgressEmit = -1;
  private _lastProgressDetent: string | null = null;
  private _inertSnapshots: InertSnapshot[] = [];
  private _managedLabelledBy: string | null = null;
  private _clampingDismissalScroll = false;
  private _userTouchingContent = false;
  private _pendingFocusScrollFrame = 0;
  private _keyboardActive = false;
  private _lastViewportSignature = '';
  private _stableViewportFrames = 0;
  private _touchGesture: TouchGestureState = {
    active: false,
    mode: 'idle',
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startTrackScrollTop: 0,
    startContentScrollTop: 0,
    startedInContent: false,
    startedOnTextInput: false
  };

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
          overscroll-behavior: none;
          touch-action: none;
          transition: none;
        }

        .backdrop.interactive {
          pointer-events: auto;
        }

        :host(.stacked-behind) .backdrop {
          pointer-events: none !important;
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

        :host(.stacked-behind) .track {
          pointer-events: none;
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
          touch-action: none;
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
          -webkit-overflow-scrolling: touch;
          touch-action: pan-y;
          overscroll-behavior-y: contain;
          overscroll-behavior-x: none;
          contain: layout paint;
          will-change: scroll-position;
          scroll-padding-bottom: var(--drawer-focus-scroll-padding, 96px);
        }

        ::slotted(input),
        ::slotted(textarea),
        ::slotted(select),
        ::slotted(button),
        ::slotted(a) {
          scroll-margin-block: 18px;
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
          transition: height 220ms ease;
        }

        @media (prefers-reduced-motion: reduce) {
          .keyboard-spacer {
            transition: none;
          }
        }

        .haptic-switch {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          border: 0;
          overflow: hidden;
          clip: rect(0 0 0 0);
          opacity: 0;
          pointer-events: none;
          z-index: -1;
        }

        .haptic-switch input {
          width: 1px;
          height: 1px;
          margin: 0;
          padding: 0;
          border: 0;
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
      <label class="haptic-switch" part="haptic-switch" for="smooth-drawer-haptic-switch-${this._instanceId}" aria-hidden="true">
        <input id="smooth-drawer-haptic-switch-${this._instanceId}" type="checkbox" switch tabindex="-1" />
      </label>
    `;

    this._track = this.shadowRoot!.querySelector('.track') as HTMLDivElement;
    this._backdrop = this.shadowRoot!.querySelector('.backdrop') as HTMLDivElement;
    this._closedSpacer = this.shadowRoot!.querySelector('.closed-spacer') as HTMLDivElement;
    this._drawer = this.shadowRoot!.querySelector('.drawer') as HTMLDivElement;
    this._handleArea = this.shadowRoot!.querySelector('.handle-area') as HTMLDivElement;
    this._content = this.shadowRoot!.querySelector('.content') as HTMLDivElement;
    this._keyboardSpacer = this.shadowRoot!.querySelector('.keyboard-spacer') as HTMLDivElement;
    this._hapticSwitchLabel = this.shadowRoot!.querySelector('.haptic-switch') as HTMLLabelElement;

    this._onScroll = this._onScroll.bind(this);
    this._onClosedClick = this._onClosedClick.bind(this);
    this._onBackdropClick = this._onBackdropClick.bind(this);
    this._onBackdropScrollBlock = this._onBackdropScrollBlock.bind(this);
    this._updateLayout = this._updateLayout.bind(this);
    this._onFocusIn = this._onFocusIn.bind(this);
    this._onFocusOut = this._onFocusOut.bind(this);
    this._onVisualViewportResize = this._onVisualViewportResize.bind(this);
    this._onGuardViewportResize = this._onGuardViewportResize.bind(this);
    this._onGuardScroll = this._onGuardScroll.bind(this);
    this._onPotentialInputFocus = this._onPotentialInputFocus.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onContentScrollEnd = this._onContentScrollEnd.bind(this);
    this._onReducedMotionChange = this._onReducedMotionChange.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._clearContentAutoScroll = this._clearContentAutoScroll.bind(this);
    this._onResizeCheck = this._onResizeCheck.bind(this);

    this._resizeObserver = new ResizeObserver(this._onResizeCheck);
  }

  connectedCallback(): void {
    this._backdrop.setAttribute('aria-hidden', 'true');
    this._track.addEventListener('scroll', this._onScroll, { passive: true });
    this._track.addEventListener('touchstart', this._onTouchStart, { passive: true });
    this._track.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this._track.addEventListener('touchend', this._onTouchEnd, { passive: true });
    this._track.addEventListener('touchcancel', this._onTouchEnd, { passive: true });
    this._closedSpacer.addEventListener('click', this._onClosedClick);
    this._closedSpacer.addEventListener('wheel', this._onBackdropScrollBlock, { passive: false });
    this._closedSpacer.addEventListener('touchmove', this._onBackdropScrollBlock, { passive: false });
    this._backdrop.addEventListener('click', this._onBackdropClick);
    this._backdrop.addEventListener('wheel', this._onBackdropScrollBlock, { passive: false });
    this._backdrop.addEventListener('touchmove', this._onBackdropScrollBlock, { passive: false });
    this._content.addEventListener('wheel', this._clearContentAutoScroll, { passive: true });
    this._content.addEventListener('touchstart', this._clearContentAutoScroll, { passive: true });
    this._content.addEventListener('pointerdown', this._clearContentAutoScroll, { passive: true });
    this.addEventListener('pointerdown', this._onPotentialInputFocus, { capture: true, passive: false });
    this.addEventListener('touchstart', this._onPotentialInputFocus, { capture: true, passive: false });
    this.addEventListener('focusin', this._onFocusIn);
    this.addEventListener('focusout', this._onFocusOut);
    this.addEventListener('keydown', this._onKeyDown);
    this._content.addEventListener('scrollend', this._onContentScrollEnd);
    window.addEventListener('resize', this._onResizeCheck);
    window.visualViewport?.addEventListener('resize', this._onVisualViewportResize);
    this._setupReducedMotion();
    this._resizeObserver.observe(this);

    this._parseDetents();
    this._applyThemeTransition(this.getAttribute('theme-transition') || '300ms');
    if (this.hasAttribute('smart-keyboard')) this._ensureResizableViewportMeta();
    requestAnimationFrame(() => this._updateLayout());
  }

  disconnectedCallback(): void {
    this._track.removeEventListener('scroll', this._onScroll);
    this._track.removeEventListener('touchstart', this._onTouchStart);
    this._track.removeEventListener('touchmove', this._onTouchMove);
    this._track.removeEventListener('touchend', this._onTouchEnd);
    this._track.removeEventListener('touchcancel', this._onTouchEnd);
    this._closedSpacer.removeEventListener('click', this._onClosedClick);
    this._closedSpacer.removeEventListener('wheel', this._onBackdropScrollBlock);
    this._closedSpacer.removeEventListener('touchmove', this._onBackdropScrollBlock);
    this._backdrop.removeEventListener('click', this._onBackdropClick);
    this._backdrop.removeEventListener('wheel', this._onBackdropScrollBlock);
    this._backdrop.removeEventListener('touchmove', this._onBackdropScrollBlock);
    this._content.removeEventListener('wheel', this._clearContentAutoScroll);
    this._content.removeEventListener('touchstart', this._clearContentAutoScroll);
    this._content.removeEventListener('pointerdown', this._clearContentAutoScroll);
    this.removeEventListener('pointerdown', this._onPotentialInputFocus, { capture: true });
    this.removeEventListener('touchstart', this._onPotentialInputFocus, { capture: true });
    this.removeEventListener('focusin', this._onFocusIn);
    this.removeEventListener('focusout', this._onFocusOut);
    this.removeEventListener('keydown', this._onKeyDown);
    this._content.removeEventListener('scrollend', this._onContentScrollEnd);
    window.removeEventListener('resize', this._onResizeCheck);
    window.visualViewport?.removeEventListener('resize', this._onVisualViewportResize);
    this._teardownReducedMotion();
    this._resizeObserver.disconnect();
    if (this._scrollTimeout !== null) clearTimeout(this._scrollTimeout);
    if (this._progressFrame) cancelAnimationFrame(this._progressFrame);
    if (this._backdropFrame) cancelAnimationFrame(this._backdropFrame);
    if (this._smartKeyboard.restoreTimer) clearTimeout(this._smartKeyboard.restoreTimer);
    if (this._keyboardPaddingReleaseTimer !== null) clearTimeout(this._keyboardPaddingReleaseTimer);
    if (this._pendingFocusScrollFrame) {
      cancelAnimationFrame(this._pendingFocusScrollFrame);
      this._pendingFocusScrollFrame = 0;
    }
    this._clearContentAutoScroll();
    this._deactivateOpenGuards();
    this._restoreInertSiblings();
    this._markClosedInStack();
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
    } else if (name === 'dismissable') {
      this._updateA11y();
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
    return this._cachedDetentList;
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

  private _setupReducedMotion(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this._reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this._reducedMotion = this._reducedMotionQuery.matches;
    this._reducedMotionQuery.addEventListener?.('change', this._onReducedMotionChange);
  }

  private _teardownReducedMotion(): void {
    this._reducedMotionQuery?.removeEventListener?.('change', this._onReducedMotionChange);
    this._reducedMotionQuery = null;
  }

  private _onReducedMotionChange(event: MediaQueryListEvent): void {
    this._reducedMotion = event.matches;
  }

  private _scrollBehavior(animate: boolean): ScrollBehavior {
    return animate && !this._reducedMotion ? 'smooth' : 'auto';
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
    const dynamicHeight = window.visualViewport?.height || window.innerHeight;
    const stableHeight = window.innerHeight;
    this._smallestViewportHeight = this._smallestViewportHeight
      ? Math.min(this._smallestViewportHeight, dynamicHeight)
      : dynamicHeight;
    const v = value.trim();
    if (v.endsWith('dvh')) return (parseFloat(v) / 100) * dynamicHeight;
    if (v.endsWith('svh')) return (parseFloat(v) / 100) * this._smallestViewportHeight;
    if (v.endsWith('vh')) return (parseFloat(v) / 100) * stableHeight;
    if (v.endsWith('px')) return parseFloat(v);
    if (v.endsWith('%')) return (parseFloat(v) / 100) * dynamicHeight;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  private _onResizeCheck(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const widthChanged = width !== this._lastLayoutWidth;
    const heightDelta = Math.abs(height - this._lastLayoutHeight);
    const keyboardResize = Boolean(window.visualViewport && window.visualViewport.height < window.innerHeight - 24);
    if (this._lastLayoutWidth && !widthChanged && (heightDelta < 24 || keyboardResize)) return;
    this._updateLayout();
  }

  private _updateLayout(): void {
    if (!this._detentsRaw.length) return;

    this._lastLayoutWidth = window.innerWidth;
    this._lastLayoutHeight = window.innerHeight;

    this._detents = this._detentsRaw
      .map(d => {
        const height = Math.max(0, this._resolveHeight(d.raw));
        return { name: d.name, height, offset: height };
      })
      .sort((a, b) => a.height - b.height);
    this._cachedDetentList = this._detents.map(d => ({ name: d.name, height: d.height, offset: d.offset }));

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
    this._updateA11y();
  }

  private _goToDetent(name: string, animate: boolean, trigger: DrawerTrigger = 'programmatic'): void {
    const target = this._detents.find(d => d.name === name);
    if (!target) return;

    this._lastTrigger = trigger;
    if (target.name !== 'closed') this._markOpenInStack();
    if (target.name !== 'closed') this._activateGuardsForActiveInput();
    this._emit('detent-changing', { targetDetent: target.name });
    this._track.scrollTo({
      top: target.offset,
      behavior: this._scrollBehavior(animate)
    });
    this._updateClipPath();
    this._updateBackdropOpacity();
    this._updateBackdrop();
  }

  private _haptic(mode: 'light' | 'heavy'): void {
    this._triggerIosHapticSwitch();
    this._triggerVibration(mode);
  }

  private _triggerIosHapticSwitch(): void {
    const label = this._hapticSwitchLabel;
    if (!label) return;
    try {
      label.click();
    } catch {
      // iOS 18+ Safari/PWA toggles the hidden switch from its associated label,
      // which fires a subtle haptic. Direct input.click() does not reliably do it.
      // Older iOS and other engines silently ignore this and fall back to vibration.
    }
  }

  private _triggerVibration(mode: 'light' | 'heavy'): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(mode === 'heavy' ? 18 : 8);
    } catch {
      // Vibration API throws in cross-origin or background contexts; safe to ignore.
    }
  }

  private _activateOpenGuards(): void {
    if (!this.isConnected || !this.isOpen || !this._focusedTextInput) return;
    if (this.hasAttribute('smart-keyboard')) this._ensureResizableViewportMeta();
    this._setFocusLockState('engaged');
  }

  private _activateGuardsForActiveInput(): void {
    if (!this.isOpen) return;

    const active = document.activeElement;
    if (active instanceof HTMLElement && this.contains(active) && this._isTextInput(active)) {
      this._focusedTextInput = active;
      this._activateOpenGuards();
    }
  }

  private _deactivateOpenGuards(): void {
    if (this._pendingFocusGuardTimer !== null) {
      clearTimeout(this._pendingFocusGuardTimer);
      this._pendingFocusGuardTimer = null;
    }
    this._setFocusLockState('idle');
    this._focusedTextInput = null;
  }

  private _onGuardViewportResize(): void {
    if (!this._viewportGuardActive || !window.visualViewport) return;
    if (this._focusedTextInput && this._focusLockMode === 'body-fixed' && window.visualViewport.height < window.innerHeight) {
      this._restoreViewportScroll();
    }
  }

  private _onGuardScroll(event?: Event): void {
    if (!this._viewportGuardActive) return;
    if (event && event.target instanceof Node && this._track.contains(event.target)) return;
    if (event && event.target instanceof Node && this._content.contains(event.target)) return;
    if (this._focusedTextInput && this.isOpen) {
      this._restoreViewportScroll();
      this._reapplyPageScrollLock();
    }
  }

  private _onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;
    const target = event.composedPath()[0];
    const startedInContent = target instanceof Node && this._content.contains(target);
    const startedOnTextInput = target instanceof HTMLElement && this._isTextInput(target);
    this._touchGesture = {
      active: true,
      mode: 'tap',
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      startTrackScrollTop: this._track.scrollTop,
      startContentScrollTop: this._content.scrollTop,
      startedInContent,
      startedOnTextInput
    };
    this._userTouchingContent = startedInContent;
    if (startedInContent) this._clearContentAutoScroll();
  }

  private _onTouchMove(event: TouchEvent): void {
    if (!this._touchGesture.active) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - this._touchGesture.startX;
    const dy = touch.clientY - this._touchGesture.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    this._touchGesture.lastX = touch.clientX;
    this._touchGesture.lastY = touch.clientY;

    if (this._touchGesture.mode === 'tap' && absY > 8 && absY > absX) {
      this._touchGesture.mode = this._touchGesture.startedInContent && this._canContentConsumeTouch(dy)
        ? 'content'
        : 'sheet';
    }

    if (
      event.cancelable
      && this.classList.contains('backdrop-active')
      && this._touchGesture.mode === 'content'
      && !this._canContentConsumeTouch(dy)
    ) {
      event.preventDefault();
    }
  }

  private _onTouchEnd(): void {
    this._touchGesture.active = false;
    this._touchGesture.mode = 'idle';
    this._userTouchingContent = false;
  }

  private _canContentConsumeTouch(deltaY: number): boolean {
    const maxScrollTop = Math.max(0, this._content.scrollHeight - this._content.clientHeight);
    if (maxScrollTop <= 0) return false;
    if (deltaY > 0) return this._content.scrollTop > 0;
    if (deltaY < 0) return this._content.scrollTop < maxScrollTop;
    return true;
  }

  private _setFocusLockState(next: FocusLockState): void {
    if (next === this._focusLockState) return;
    const previous = this._focusLockState;
    this._focusLockState = next;

    if (next === 'engaged') {
      this._engageFocusLock(previous);
      return;
    }

    if (next === 'idle') {
      this._releaseFocusLock();
    }
  }

  private _engageFocusLock(previous: FocusLockState): void {
    if (!this.isConnected || !this._focusedTextInput || !this.isOpen || !this._isTopMostInStack()) {
      this._focusLockState = 'idle';
      return;
    }
    if (previous === 'engaged' && this._viewportGuardActive) return;

    if (this._viewportGuardActive || this._pageScrollLock || this._htmlLockSnapshot) {
      this._releaseFocusLock();
      this._focusLockState = 'engaged';
    }

    this._viewportGuardScrollY = window.scrollY;
    this._focusLockMode = this._shouldUseResizableViewportLock() ? 'resizes-content' : 'body-fixed';
    this._viewportGuardActive = true;

    if (this._focusLockMode === 'resizes-content') {
      this._lockHtmlScrollOnly();
      window.visualViewport?.addEventListener('resize', this._onGuardViewportResize);
      return;
    }

    this._lockPageScrollForFocusedInput();
    window.addEventListener('scroll', this._onGuardScroll, { passive: true, capture: true });
    document.addEventListener('scroll', this._onGuardScroll, { passive: true, capture: true });
    window.visualViewport?.addEventListener('resize', this._onGuardViewportResize);
    window.visualViewport?.addEventListener('scroll', this._onGuardScroll, { passive: true });
  }

  private _releaseFocusLock(): void {
    if (!this._viewportGuardActive && !this._pageScrollLock && !this._htmlLockSnapshot) return;
    this._focusLockState = 'releasing';

    if (this._focusLockMode === 'body-fixed') {
      window.removeEventListener('scroll', this._onGuardScroll, { capture: true } as EventListenerOptions);
      document.removeEventListener('scroll', this._onGuardScroll, { capture: true } as EventListenerOptions);
      window.visualViewport?.removeEventListener('scroll', this._onGuardScroll);
    }
    window.visualViewport?.removeEventListener('resize', this._onGuardViewportResize);

    this._viewportGuardActive = false;
    this._unlockHtmlScrollOnly();
    this._unlockPageScrollForFocusedInput();
    this._focusLockMode = 'none';
    this._focusLockState = 'idle';
  }

  private _ensureResizableViewportMeta(): void {
    if (this._viewportMetaTouched || typeof document === 'undefined') return;
    this._viewportMetaTouched = true;

    let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      document.head?.appendChild(meta);
    }

    meta.content = this._normalizedViewportContent(meta.content || '');
  }

  private _normalizedViewportContent(content: string): string {
    const directives = content
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .filter(part => !/^interactive-widget\s*=/i.test(part));
    directives.push('interactive-widget=resizes-content');
    return directives.join(', ');
  }

  private _shouldUseResizableViewportLock(): boolean {
    if (!this.hasAttribute('smart-keyboard')) return false;
    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    const hasResizableMeta = Boolean(meta?.content.includes('interactive-widget=resizes-content'));
    const hasVirtualKeyboard = 'virtualKeyboard' in navigator;
    const cssSupports = typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('(interactive-widget: resizes-content)');
    const iosVersion = this._iosVersion();
    if (iosVersion) {
      const [major, minor] = iosVersion;
      return hasResizableMeta && (major > 16 || (major === 16 && minor >= 4));
    }
    return hasResizableMeta || hasVirtualKeyboard || cssSupports;
  }

  private _iosVersion(): [number, number] | null {
    const ua = navigator.userAgent;
    if (!/\b(iPad|iPhone|iPod)\b/.test(ua) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      return null;
    }
    const match = /OS (\d+)[._](\d+)/.exec(ua);
    if (!match) return null;
    return [Number(match[1]), Number(match[2])];
  }

  private _lockHtmlScrollOnly(): void {
    if (this._htmlLockSnapshot) return;
    const html = document.documentElement;
    const properties = ['overflow', 'overscroll-behavior'];
    this._htmlLockSnapshot = {};
    for (const property of properties) {
      this._htmlLockSnapshot[property] = html.style.getPropertyValue(property);
    }
    html.style.setProperty('overflow', 'hidden');
    html.style.setProperty('overscroll-behavior', 'none');
  }

  private _unlockHtmlScrollOnly(): void {
    const snapshot = this._htmlLockSnapshot;
    if (!snapshot) return;
    this._htmlLockSnapshot = null;
    const html = document.documentElement;
    for (const [property, value] of Object.entries(snapshot)) {
      if (value) html.style.setProperty(property, value);
      else html.style.removeProperty(property);
    }
  }

  private _reapplyPageScrollLock(): void {
    if (!this._pageScrollLock) return;
    const body = document.body;
    const expectedTop = `${-this._viewportGuardScrollY}px`;
    if (body.style.position !== 'fixed') {
      body.style.setProperty('position', 'fixed');
    }
    if (body.style.top !== expectedTop) {
      body.style.setProperty('top', expectedTop);
    }
  }

  private _restoreViewportScroll(): void {
    if (!this._viewportGuardActive || this._focusLockMode !== 'body-fixed' || !this._focusedTextInput || !this.isOpen) return;
    if (Math.abs(window.scrollY - this._viewportGuardScrollY) > 1) {
      window.scrollTo(0, this._viewportGuardScrollY);
    }
  }

  private _lockPageScrollForFocusedInput(): void {
    if (this._pageScrollLock) return;

    const html = document.documentElement;
    const body = document.body;
    const scrollY = this._viewportGuardScrollY;
    const scrollHeight = Math.max(html.scrollHeight, window.innerHeight + 1);
    const properties = [
      'height',
      'min-height',
      'overflow',
      'overscroll-behavior',
      'position',
      'top',
      'left',
      'right',
      'width'
    ];
    const snapshot: PageScrollLockSnapshot = {
      scrollY,
      html: {},
      body: {}
    };

    for (const property of properties) {
      snapshot.html[property] = html.style.getPropertyValue(property);
      snapshot.body[property] = body.style.getPropertyValue(property);
    }

    this._pageScrollLock = snapshot;

    // Pretend the document is still scrollable so iOS keeps the URL bar in its current state
    // while we freeze the body in place with position:fixed.
    html.style.setProperty('height', `${scrollHeight}px`);
    html.style.setProperty('min-height', `${scrollHeight}px`);
    html.style.setProperty('overflow', 'hidden');
    html.style.setProperty('overscroll-behavior', 'none');

    body.style.setProperty('overflow', 'hidden');
    body.style.setProperty('overscroll-behavior', 'none');
    body.style.setProperty('position', 'fixed');
    body.style.setProperty('top', `${-scrollY}px`);
    body.style.setProperty('left', '0');
    body.style.setProperty('right', '0');
    body.style.setProperty('width', '100%');
  }

  private _unlockPageScrollForFocusedInput(): void {
    const snapshot = this._pageScrollLock;
    if (!snapshot) return;

    this._pageScrollLock = null;
    const html = document.documentElement;
    const body = document.body;
    for (const [property, value] of Object.entries(snapshot.html)) {
      if (value) html.style.setProperty(property, value);
      else html.style.removeProperty(property);
    }
    for (const [property, value] of Object.entries(snapshot.body)) {
      if (value) body.style.setProperty(property, value);
      else body.style.removeProperty(property);
    }
    window.scrollTo(0, snapshot.scrollY);
  }

  private _emit(eventName: DrawerEventName, extraDetail: Partial<DrawerEventDetail> = {}): void {
    this.dispatchEvent(new CustomEvent(eventName, {
      bubbles: true,
      composed: true,
      detail: { ...this.getState(), ...extraDetail }
    }));
  }

  private _emitProgressIfNeeded(): void {
    const state = this.getState();
    const progressChanged = Math.abs(state.progress - this._lastProgressEmit) >= PROGRESS_EMIT_DELTA;
    const detentChanged = state.detent !== this._lastProgressDetent;
    if (!progressChanged && !detentChanged) return;
    this._lastProgressEmit = state.progress;
    this._lastProgressDetent = state.detent;
    this.dispatchEvent(new CustomEvent('drawer-progress', {
      bubbles: true,
      composed: true,
      detail: state
    }));
  }

  private _updateClipPath(): void {
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

    if (!this._isTopMostInStack()) {
      if ('0.000' !== this._cachedBackdropOpacity) {
        this._backdrop.style.opacity = '0';
        this._cachedBackdropOpacity = '0.000';
      }
      return;
    }

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
      const isTopMost = this._isTopMostInStack();
      const h = this._track.scrollTop;
      const opacity = this._computeBackdropOpacity(h);
      const interactive = isTopMost && opacity > 0.05 && this._isBackdropInteractive(h);
      if (interactive !== this._cachedBackdropInteractive) {
        this._backdrop.classList.toggle('interactive', interactive);
        this._cachedBackdropInteractive = interactive;
      }

      const backdropActive = isTopMost && (interactive || opacity > 0.05);
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
        this._updateA11y();
      }
    });
  }

  private _onScroll(): void {
    this._dragging = true;
    if (this._clampDismissalScroll()) return;
    this._dismissKeyboardForDownwardDrawerScroll(this._track.scrollTop);
    this._updateClipPath();
    this._updateBackdropOpacity();
    this._updateBackdrop();

    if (!this._progressFrame) {
      this._progressFrame = requestAnimationFrame(() => {
        this._progressFrame = 0;
        this._emitProgressIfNeeded();
      });
    }

    if (this._scrollTimeout !== null) clearTimeout(this._scrollTimeout);
    this._scrollTimeout = setTimeout(() => {
      this._dragging = false;
      const settled = this._detents.find(d => Math.abs(d.offset - this._track.scrollTop) < 5)
        || this._closestDetent(this._track.scrollTop);
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

        this._haptic(settled.height === this._largestHeight() && settled.name !== 'closed' ? 'heavy' : 'light');
        this._updateA11y();
        this._emit('detent-change');
      }

      if (settled.name === 'closed') {
        this._markClosedInStack();
        this._deactivateOpenGuards();
        this._resetContentScroll();
      }
    }, 120);
  }

  private _resetContentScroll(): void {
    this._clearContentAutoScroll();
    if (this._content.scrollTop !== 0) {
      this._content.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  private _onClosedClick(): void {
    if (!this._isTopMostInStack()) return;
    if (this._cachedBackdropInteractive && this._isDismissable()) {
      this.snapTo('closed', { trigger: 'user' });
    }
  }

  private _onBackdropClick(): void {
    if (!this._isTopMostInStack()) return;
    if (!this._isDismissable()) return;
    this.snapTo('closed', { trigger: 'user' });
  }

  private _onBackdropScrollBlock(event: Event): void {
    if (!this.classList.contains('backdrop-active')) return;
    event.preventDefault();
  }

  private _isDismissable(): boolean {
    return this.getAttribute('dismissable') !== 'false';
  }

  private _clampDismissalScroll(): boolean {
    if (this._clampingDismissalScroll || this._isDismissable() || !this.isOpen) return false;
    const lowestOpen = this._detents.find(d => d.name !== 'closed');
    if (!lowestOpen || this._track.scrollTop >= lowestOpen.offset - 4) return false;
    this._clampingDismissalScroll = true;
    this._track.scrollTo({ top: lowestOpen.offset, behavior: 'auto' });
    requestAnimationFrame(() => {
      this._clampingDismissalScroll = false;
    });
    return true;
  }

  private _onKeyDown(event: KeyboardEvent): void {
    if (!this.isOpen || !this._isTopMostInStack()) return;
    if (event.key === 'Escape') {
      if (!this._isDismissable()) return;
      event.preventDefault();
      this.snapTo('closed', { trigger: 'user' });
      return;
    }
    if (event.key === 'Tab' && this._cachedFullyOpen) {
      this._trapFocus(event);
    }
  }

  private _trapFocus(event: KeyboardEvent): void {
    const focusable = this._focusableElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  private _focusableElements(): HTMLElement[] {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    return [...this.querySelectorAll<HTMLElement>(selector)]
      .filter(el => {
        if (el.hasAttribute('hidden')) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
  }

  private _updateA11y(): void {
    const open = this.isOpen && this._isTopMostInStack();
    if (open) {
      this.setAttribute('role', 'dialog');
      this.setAttribute('aria-modal', 'true');
      this._syncLabelledBy();
    } else {
      this.removeAttribute('role');
      this.removeAttribute('aria-modal');
      if (this._managedLabelledBy && this.getAttribute('aria-labelledby') === this._managedLabelledBy) {
        this.removeAttribute('aria-labelledby');
      }
      this._managedLabelledBy = null;
    }

    const shouldInert = open && this._cachedFullyOpen === true;
    if (shouldInert) this._applyInertSiblings();
    else this._restoreInertSiblings();
  }

  private _syncLabelledBy(): void {
    const title = this.querySelector<HTMLElement>('[slot="title"], [data-drawer-title]');
    if (!title && this.hasAttribute('aria-labelledby')) return;
    if (!title) return;
    if (!title.id) {
      SmoothDrawer._titleIdCounter += 1;
      title.id = `smooth-drawer-title-${SmoothDrawer._titleIdCounter}`;
    }
    this.setAttribute('aria-labelledby', title.id);
    this._managedLabelledBy = title.id;
  }

  private _applyInertSiblings(): void {
    if (this._inertSnapshots.length || !this.parentElement) return;
    for (const sibling of [...this.parentElement.children]) {
      if (!(sibling instanceof HTMLElement) || sibling === this) continue;
      this._inertSnapshots.push({
        element: sibling,
        inert: Boolean((sibling as HTMLElement & { inert?: boolean }).inert),
        ariaHidden: sibling.getAttribute('aria-hidden')
      });
      (sibling as HTMLElement & { inert: boolean }).inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    }
  }

  private _restoreInertSiblings(): void {
    for (const snapshot of this._inertSnapshots) {
      (snapshot.element as HTMLElement & { inert: boolean }).inert = snapshot.inert;
      if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden');
      else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden);
    }
    this._inertSnapshots = [];
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

  private _dismissKeyboardForDownwardDrawerScroll(scrollTop: number): void {
    const previousScrollTop = this._lastTrackScrollTop;
    this._lastTrackScrollTop = scrollTop;
    if (!this._focusedTextInput || !this.isOpen) return;
    if (!this._isKeyboardInput(this._focusedTextInput)) return;
    if (this._touchGesture.mode !== 'sheet' || this._touchGesture.startedInContent || this._touchGesture.startedOnTextInput) return;
    const touchDeltaY = this._touchGesture.lastY - this._touchGesture.startY;
    const sheetDelta = this._touchGesture.startTrackScrollTop - scrollTop;
    if (touchDeltaY < SHEET_DRAG_BLUR_THRESHOLD || sheetDelta < 18) return;
    if (scrollTop >= previousScrollTop - 12) return;
    if (document.activeElement !== this._focusedTextInput) return;

    this._focusedTextInput.blur();
  }

  private _onPotentialInputFocus(event: Event): void {
    if (!this._isTopMostInStack()) return;
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement) || !this._isTextInput(target)) return;
    if (!this.isOpen || !this.contains(target)) return;
    this._focusedTextInput = target;
    this._activateOpenGuards();
    this._focusInputWithoutViewportJump(target, event);
    this._pendingFocusGuardTimer = setTimeout(() => {
      this._pendingFocusGuardTimer = null;
      const active = document.activeElement;
      if (active === target) return;
      if (active instanceof HTMLElement && this.contains(active) && this._isTextInput(active)) {
        this._focusedTextInput = active;
        return;
      }
      this._deactivateOpenGuards();
    }, 800);
  }

  private _focusInputWithoutViewportJump(input: HTMLElement, event: Event): void {
    if (!this.hasAttribute('smart-keyboard')) return;
    if (document.activeElement === input) return;
    if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent && event.pointerType === 'mouse') return;

    const scrollY = this._viewportGuardScrollY;
    if (event.cancelable) event.preventDefault();
    input.focus({ preventScroll: true });
    if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo(0, scrollY);
  }

  private _onFocusIn(event: FocusEvent): void {
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement) || !this._isTextInput(target)) return;
    if (!this.contains(target)) return;

    if (this._pendingFocusGuardTimer !== null) {
      clearTimeout(this._pendingFocusGuardTimer);
      this._pendingFocusGuardTimer = null;
    }
    this._focusedTextInput = target;
    if (this.isOpen) this._activateOpenGuards();
    if (!this.hasAttribute('smart-keyboard')) return;
    if (this._keyboardPaddingReleaseTimer !== null) {
      clearTimeout(this._keyboardPaddingReleaseTimer);
      this._keyboardPaddingReleaseTimer = null;
    }
    if (this._smartKeyboard.restoreTimer) clearTimeout(this._smartKeyboard.restoreTimer);
    this._smartKeyboard.previousDetent ||= this.detent;
    if (this._isKeyboardInput(target)) this._setKeyboardActive(true);
    const targetDetent = this._largestKeyboardDetent();
    if (targetDetent) this.snapTo(targetDetent.name, { trigger: 'keyboard' });
    this._scheduleFocusedInputScrollAfterStabilization();
  }

  private _onFocusOut(): void {
    if (this._smartKeyboard.restoreTimer) clearTimeout(this._smartKeyboard.restoreTimer);
    this._smartKeyboard.restoreTimer = setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.contains(active) && this._isTextInput(active)) return;
      this._deactivateOpenGuards();

      if (!this.hasAttribute('smart-keyboard')) return;
      this._smartKeyboard.previousDetent = null;
      this._smartKeyboard.keyboardHeight = 0;
      this._setKeyboardActive(false);
      this._releaseKeyboardPaddingSmoothly();
    }, 120);
  }

  private _onVisualViewportResize(): void {
    if (!this.hasAttribute('smart-keyboard')) return;
    if (!this.isOpen || !this._focusedTextInput || !this._isTextInput(this._focusedTextInput)) {
      this._setKeyboardActive(false);
      this._setContentPadding('');
      return;
    }
    const targetDetent = this._largestKeyboardDetent();
    if (targetDetent && this.detent !== targetDetent.name) {
      this.snapTo(targetDetent.name, { trigger: 'keyboard' });
    }
    this._syncKeyboardPadding();
    this._scheduleFocusedInputScrollAfterStabilization();
  }

  private _scheduleFocusedInputScrollAfterStabilization(): void {
    if (this._pendingFocusScrollFrame) cancelAnimationFrame(this._pendingFocusScrollFrame);
    this._stableViewportFrames = 0;
    this._lastViewportSignature = '';
    let frameCount = 0;
    const tick = () => {
      this._pendingFocusScrollFrame = 0;
      if (!this.isOpen || !this._focusedTextInput) return;

      this._syncKeyboardPadding();
      frameCount += 1;
      const targetDetent = this._largestKeyboardDetent();
      const detentSettled = !targetDetent || this.detent === targetDetent.name;
      const viewportSettled = this._isViewportSettled();

      if ((detentSettled && viewportSettled) || frameCount >= 8) {
        this._scrollFocusedInputIntoDrawerView();
        return;
      }

      this._pendingFocusScrollFrame = requestAnimationFrame(tick);
    };
    this._pendingFocusScrollFrame = requestAnimationFrame(tick);
  }

  private _isViewportSettled(): boolean {
    const viewport = window.visualViewport;
    const signature = viewport
      ? `${Math.round(viewport.offsetTop)}:${Math.round(viewport.height)}:${Math.round(viewport.width)}`
      : `${window.innerWidth}:${window.innerHeight}`;

    if (signature === this._lastViewportSignature) this._stableViewportFrames += 1;
    else {
      this._lastViewportSignature = signature;
      this._stableViewportFrames = 1;
    }

    return this._stableViewportFrames >= 2;
  }

  private _syncKeyboardPadding(): void {
    const viewport = window.visualViewport;
    if (!viewport) return;
    if (!this.isOpen || !this._focusedTextInput) return;
    const layoutHeight = window.innerHeight;
    const viewportTop = Math.max(0, viewport.offsetTop);
    const viewportBottom = viewport.offsetTop + viewport.height;
    const bottomOverlap = Math.max(0, layoutHeight - viewportBottom);
    const shrinkInset = Math.max(0, layoutHeight - viewport.height);
    const keyboardCandidate = Math.max(bottomOverlap, shrinkInset - viewportTop);
    const looksLikeKeyboard = bottomOverlap > KEYBOARD_ACTIVE_OFF_THRESHOLD || keyboardCandidate > KEYBOARD_ACTIVE_ON_THRESHOLD;
    const keyboardHeight = looksLikeKeyboard ? keyboardCandidate : 0;
    this._smartKeyboard.keyboardHeight = keyboardHeight;
    this._setKeyboardActive(
      this._keyboardActive
        ? keyboardHeight > KEYBOARD_ACTIVE_OFF_THRESHOLD
        : keyboardHeight > KEYBOARD_ACTIVE_ON_THRESHOLD
    );
    const extraPadding = Math.round(Math.min(140, window.innerHeight * KEYBOARD_EXTRA_PADDING_MAX_VH));
    const comfortGap = Math.round(Math.min(120, window.innerHeight * KEYBOARD_SCROLL_COMFORT_MAX_VH));
    const padding = this._keyboardActive && keyboardHeight > 0 ? keyboardHeight + extraPadding + comfortGap : 0;
    this._content.style.setProperty('--drawer-focus-scroll-padding', `${Math.max(96, padding)}px`);
    if (padding > 0 && this._keyboardPaddingReleaseTimer !== null) {
      clearTimeout(this._keyboardPaddingReleaseTimer);
      this._keyboardPaddingReleaseTimer = null;
    }
    this._setContentPadding(padding > 0 ? `${padding}px` : '');
  }

  private _setKeyboardActive(active: boolean): void {
    if (active === this._keyboardActive) return;
    this._keyboardActive = active;
    this.classList.toggle('keyboard-active', active);
  }

  private _setContentPadding(value: string): void {
    if (value === this._cachedContentPadding) return;
    if (value) this._keyboardSpacer.style.height = value;
    else this._keyboardSpacer.style.removeProperty('height');
    this._cachedContentPadding = value;
  }

  private _releaseKeyboardPaddingSmoothly(): void {
    const spacerHeight = this._keyboardSpacer.getBoundingClientRect().height || parseFloat(this._cachedContentPadding) || 0;
    if (spacerHeight <= 0) {
      this._setContentPadding('');
      return;
    }
    if (this._keyboardPaddingReleaseTimer !== null) clearTimeout(this._keyboardPaddingReleaseTimer);

    const targetScrollTop = Math.max(0, Math.min(
      this._content.scrollTop,
      this._content.scrollHeight - spacerHeight - this._content.clientHeight
    ));

    if (Math.abs(this._content.scrollTop - targetScrollTop) > 2) {
      this._isAutoScrolling = true;
      this._content.scrollTo({
        top: targetScrollTop,
        behavior: this._scrollBehavior(true)
      });
      this._keyboardPaddingReleaseTimer = setTimeout(() => {
        this._setContentPadding('');
        this._isAutoScrolling = false;
        this._keyboardPaddingReleaseTimer = null;
      }, this._reducedMotion ? 0 : 260);
      return;
    }

    this._setContentPadding('');
  }

  private _clearContentAutoScroll(): void {
    for (const timer of this._contentAutoScrollTimers) clearTimeout(timer);
    this._contentAutoScrollTimers = [];
    if (this._pendingFocusScrollFrame) {
      cancelAnimationFrame(this._pendingFocusScrollFrame);
      this._pendingFocusScrollFrame = 0;
    }
    if (this._autoScrollLockTimer !== null) {
      clearTimeout(this._autoScrollLockTimer);
      this._autoScrollLockTimer = null;
    }
    this._isAutoScrolling = false;
  }

  private _onContentScrollEnd(): void {
    if (!this._isAutoScrolling) return;
    if (this._autoScrollLockTimer !== null) {
      clearTimeout(this._autoScrollLockTimer);
      this._autoScrollLockTimer = null;
    }
    this._isAutoScrolling = false;
  }

  private _scrollInputIntoDrawerView(input: HTMLElement): void {
    if (!input.isConnected) return;
    if (this._isAutoScrolling) return;
    if (this._userTouchingContent || this._touchGesture.mode === 'content') return;

    const inputRect = input.getBoundingClientRect();
    const contentRect = this._content.getBoundingClientRect();
    const viewport = window.visualViewport;
    const overlapBottom = viewport
      ? Math.max(0, contentRect.bottom - (viewport.offsetTop + viewport.height))
      : this._smartKeyboard.keyboardHeight || 0;
    const visibleTop = contentRect.top;
    const visibleBottom = contentRect.bottom - overlapBottom;
    const topMargin = 14;
    const visibleHeight = Math.max(1, inputRect.height);
    const clippedTop = Math.max(0, visibleTop - inputRect.top);
    const clippedBottom = Math.max(0, inputRect.bottom - visibleBottom);
    const visibleRatio = Math.max(0, (visibleHeight - clippedTop - clippedBottom) / visibleHeight);
    if (visibleRatio > 0.92 && inputRect.top >= visibleTop + 8 && inputRect.bottom <= visibleBottom - 12) return;

    const comfortGap = visibleRatio > 0.65
      ? 28
      : Math.round(Math.min(90, window.innerHeight * KEYBOARD_SCROLL_COMFORT_MAX_VH));
    const comfortableBottom = visibleBottom - comfortGap;
    let targetScrollTop = this._content.scrollTop;

    if (inputRect.bottom > comfortableBottom) {
      const neededDelta = inputRect.bottom - comfortableBottom;
      const maxDeltaBeforeTopClip = Math.max(0, inputRect.top - (visibleTop + topMargin));
      targetScrollTop += Math.min(neededDelta, maxDeltaBeforeTopClip);
    } else if (inputRect.top < visibleTop + topMargin) {
      targetScrollTop -= (visibleTop + topMargin) - inputRect.top;
    }

    const maxScrollTop = Math.max(0, this._content.scrollHeight - this._content.clientHeight);
    targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
    if (Math.abs(targetScrollTop - this._content.scrollTop) < 4) return;

    this._isAutoScrolling = true;
    this._content.scrollTo({
      top: targetScrollTop,
      behavior: this._scrollBehavior(Math.abs(targetScrollTop - this._content.scrollTop) > 24)
    });
    if (this._autoScrollLockTimer !== null) clearTimeout(this._autoScrollLockTimer);
    if ('onscrollend' in this._content) {
      this._autoScrollLockTimer = setTimeout(() => this._onContentScrollEnd(), 600);
    } else {
      this._autoScrollLockTimer = setTimeout(() => {
        this._isAutoScrolling = false;
        this._autoScrollLockTimer = null;
      }, 600);
    }
  }

  private _scrollFocusedInputIntoDrawerView(): void {
    const input = this._focusedTextInput;
    if (!input) return;
    requestAnimationFrame(() => this._scrollInputIntoDrawerView(input));
  }

  private _largestKeyboardDetent(): DrawerDetent | null {
    return [...this._detents].reverse().find(d => d.name !== 'closed') || null;
  }

  private _isTopMostInStack(): boolean {
    const stack = SmoothDrawer._openStack;
    return stack.length === 0 || stack[stack.length - 1] === this;
  }

  private _markOpenInStack(): void {
    const stack = SmoothDrawer._openStack;
    const existingIndex = stack.indexOf(this);
    if (existingIndex >= 0) stack.splice(existingIndex, 1);
    stack.push(this);
    SmoothDrawer._syncStackLayers();
  }

  private _markClosedInStack(): void {
    const stack = SmoothDrawer._openStack;
    const existingIndex = stack.indexOf(this);
    if (existingIndex >= 0) stack.splice(existingIndex, 1);
    this.classList.remove('stacked-behind');
    this.style.removeProperty('--drawer-z-index');
    SmoothDrawer._syncStackLayers();
    this._updateA11y();
  }

  private _applyStackLayer(layerIndex: number, isTopMost: boolean): void {
    const z = SmoothDrawer._stackBaseZIndex + layerIndex;
    this.style.setProperty('--drawer-z-index', `${z}`);
    this.classList.toggle('stacked-behind', !isTopMost);
    if (isTopMost) this._activateGuardsForActiveInput();
    else this._deactivateOpenGuards();
    this._updateBackdropOpacity();
    this._updateBackdrop();
    this._updateA11y();
  }

  private static _syncStackLayers(): void {
    const stack = SmoothDrawer._openStack;
    stack.forEach((drawer, index) => {
      drawer._applyStackLayer(index, index === stack.length - 1);
    });
  }

  private _isTextInput(el: HTMLElement): boolean {
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLSelectElement) return true;
    if (!(el instanceof HTMLInputElement)) return false;
    if (['button', 'submit', 'reset', 'image', 'hidden', 'checkbox', 'radio'].includes(el.type)) return false;
    return true;
  }

  private _isKeyboardInput(el: HTMLElement): boolean {
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
