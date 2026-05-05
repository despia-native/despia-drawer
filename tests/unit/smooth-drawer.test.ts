import { describe, expect, it, vi } from 'vitest';
import '../../src/index';
import type { SmoothDrawer } from '../../src/core/smooth-drawer';

const tick = async () => {
  await Promise.resolve();
  vi.runOnlyPendingTimers();
  await Promise.resolve();
};

const createDrawer = async (attrs: Record<string, string> = {}) => {
  const drawer = document.createElement('smooth-drawer') as SmoothDrawer;
  for (const [name, value] of Object.entries(attrs)) drawer.setAttribute(name, value);
  document.body.appendChild(drawer);
  await tick();
  return drawer;
};

const touchEvent = (type: string, y: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true }) as Event & {
    touches: Array<{ clientX: number; clientY: number }>;
  };
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: 0, clientY: y }],
    configurable: true
  });
  return event;
};

describe('smooth-drawer', () => {
  it('parses detents and injects a closed detent', async () => {
    const drawer = await createDrawer({ detents: 'peek:20vh, large:80dvh' });

    const detents = drawer.getState().detents;
    expect(detents.map(d => d.name)).toEqual(['closed', 'peek', 'large']);
    expect(detents[0]?.height).toBe(0);
  });

  it('keeps stack order when multiple drawers open and close', async () => {
    const first = await createDrawer({ detents: 'closed:0, large:80vh' });
    const second = await createDrawer({ detents: 'closed:0, large:80vh' });

    first.show('large', { animate: false });
    second.show('large', { animate: false });
    await tick();

    expect(first.classList.contains('stacked-behind')).toBe(true);
    expect(second.classList.contains('stacked-behind')).toBe(false);

    second.hide({ animate: false });
    await tick();
    vi.advanceTimersByTime(130);

    expect(first.classList.contains('stacked-behind')).toBe(false);
    expect(second.style.getPropertyValue('--drawer-z-index')).toBe('');
  });

  it('engages and releases smart-keyboard focus lock without leaking page styles', async () => {
    const drawer = await createDrawer({ detents: 'closed:0, large:80vh', 'smart-keyboard': '' });
    const input = document.createElement('input');
    drawer.appendChild(input);

    drawer.show('large', { animate: false });
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    await tick();

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    expect(viewport?.content).toContain('interactive-widget=resizes-content');
    expect(document.documentElement.style.overflow).toBe('hidden');

    input.blur();
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
    vi.advanceTimersByTime(130);

    expect(document.documentElement.style.overflow).toBe('');
  });

  it('reuses the focus lock during rapid focus changes inside the drawer', async () => {
    const drawer = await createDrawer({ detents: 'closed:0, large:80vh', 'smart-keyboard': '' });
    const first = document.createElement('input');
    const second = document.createElement('input');
    drawer.append(first, second);

    drawer.show('large', { animate: false });
    first.focus();
    first.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    await tick();

    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
    second.focus();
    second.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    vi.advanceTimersByTime(130);

    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(second);
  });

  it('does not blur a focused input from tiny drawer scroll noise', async () => {
    const drawer = await createDrawer({ detents: 'closed:0, large:120px', 'smart-keyboard': '' });
    const track = drawer.shadowRoot?.querySelector('.track') as HTMLDivElement;
    const input = document.createElement('input');
    drawer.appendChild(input);

    drawer.show('large', { animate: false });
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    await tick();

    track.scrollTop = 100;
    track.dispatchEvent(new Event('scroll'));
    vi.runOnlyPendingTimers();
    track.scrollTop = 93;
    track.dispatchEvent(new Event('scroll'));
    vi.runOnlyPendingTimers();

    expect(document.activeElement).toBe(input);
  });

  it('keeps keyboard-active stable with inset hysteresis', async () => {
    const viewport = new EventTarget() as EventTarget & {
      width: number;
      height: number;
      offsetTop: number;
      offsetLeft: number;
      pageTop: number;
      pageLeft: number;
      scale: number;
    };
    Object.assign(viewport, {
      width: 390,
      height: 660,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1
    });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });

    const drawer = await createDrawer({ detents: 'closed:0, large:80vh', 'smart-keyboard': '' });
    const input = document.createElement('input');
    drawer.appendChild(input);

    drawer.show('large', { animate: false });
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    viewport.dispatchEvent(new Event('resize'));
    await tick();

    expect(drawer.classList.contains('keyboard-active')).toBe(true);

    viewport.height = 730;
    viewport.dispatchEvent(new Event('resize'));
    await tick();

    expect(drawer.classList.contains('keyboard-active')).toBe(true);

    viewport.height = 760;
    viewport.dispatchEvent(new Event('resize'));
    await tick();

    expect(drawer.classList.contains('keyboard-active')).toBe(false);
  });

  it('does not close from backdrop or Escape when dismissable is false', async () => {
    const drawer = await createDrawer({ detents: 'closed:0, large:80vh', dismissable: 'false' });
    drawer.show('large', { animate: false });
    await tick();

    const backdrop = drawer.shadowRoot?.querySelector('.backdrop');
    backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(drawer.detent).toBe('large');
  });

  it('throttles progress events for duplicate scroll frames', async () => {
    const drawer = await createDrawer({ detents: 'closed:0, large:100px' });
    const track = drawer.shadowRoot?.querySelector('.track') as HTMLDivElement;
    let events = 0;
    drawer.addEventListener('drawer-progress', () => {
      events += 1;
    });

    track.scrollTop = 50;
    for (let i = 0; i < 5; i += 1) {
      track.dispatchEvent(new Event('scroll'));
      vi.runOnlyPendingTimers();
    }

    expect(events).toBeLessThanOrEqual(1);
  });

  it('uses unique hidden haptic switch ids for multiple drawers', async () => {
    const first = await createDrawer();
    const second = await createDrawer();

    const firstInput = first.shadowRoot?.querySelector<HTMLInputElement>('.haptic-switch input');
    const secondInput = second.shadowRoot?.querySelector<HTMLInputElement>('.haptic-switch input');
    const firstLabel = first.shadowRoot?.querySelector<HTMLLabelElement>('.haptic-switch');

    expect(firstInput?.id).toBeTruthy();
    expect(secondInput?.id).toBeTruthy();
    expect(firstInput?.id).not.toBe(secondInput?.id);
    expect(firstLabel?.htmlFor).toBe(firstInput?.id);
  });

  it('normalizes viewport meta without duplicating interactive-widget', async () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, interactive-widget=overlays-content, viewport-fit=cover">';

    await createDrawer({ 'smart-keyboard': '' });

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    expect(viewport?.content).toBe('width=device-width, viewport-fit=cover, interactive-widget=resizes-content');
  });

  it('restores inert siblings after a fully-open drawer closes', async () => {
    const sibling = document.createElement('main');
    document.body.appendChild(sibling);
    const drawer = await createDrawer({ detents: 'closed:0, large:100px' });

    drawer.show('large', { animate: false });
    await tick();
    vi.advanceTimersByTime(130);

    expect((sibling as HTMLElement & { inert?: boolean }).inert).toBe(true);
    expect(sibling.getAttribute('aria-hidden')).toBe('true');

    drawer.hide({ animate: false });
    await tick();
    vi.advanceTimersByTime(130);

    expect((sibling as HTMLElement & { inert?: boolean }).inert).toBe(false);
    expect(sibling.hasAttribute('aria-hidden')).toBe(false);
  });

  it('preserves user-provided aria-labelledby when no drawer title is present', async () => {
    const drawer = await createDrawer({ detents: 'closed:0, large:80vh', 'aria-labelledby': 'external-title' });

    drawer.show('large', { animate: false });
    await tick();
    drawer.hide({ animate: false });
    await tick();
    vi.advanceTimersByTime(130);

    expect(drawer.getAttribute('aria-labelledby')).toBe('external-title');
  });

  it('clamps downward dismissal scroll when dismissable is false', async () => {
    const drawer = await createDrawer({ detents: 'closed:0, medium:50px, large:100px', dismissable: 'false' });
    const track = drawer.shadowRoot?.querySelector('.track') as HTMLDivElement;

    drawer.show('medium', { animate: false });
    await tick();
    track.scrollTop = 1;
    track.dispatchEvent(new Event('scroll'));

    expect(track.scrollTop).toBe(50);
  });

  it('suppresses focused-input auto-scroll while content is actively touched', async () => {
    const drawer = await createDrawer({ detents: 'closed:0, large:80vh', 'smart-keyboard': '' });
    const content = drawer.shadowRoot?.querySelector('.content') as HTMLDivElement;
    const input = document.createElement('input');
    drawer.appendChild(input);
    const scrollSpy = vi.spyOn(content, 'scrollTo');

    Object.defineProperty(content, 'scrollHeight', { value: 1200, configurable: true });
    Object.defineProperty(content, 'clientHeight', { value: 400, configurable: true });
    content.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 390,
      height: 400,
      top: 0,
      right: 390,
      bottom: 400,
      left: 0,
      toJSON: () => ({})
    });
    input.getBoundingClientRect = () => ({
      x: 0,
      y: 520,
      width: 320,
      height: 40,
      top: 520,
      right: 320,
      bottom: 560,
      left: 0,
      toJSON: () => ({})
    });

    drawer.show('large', { animate: false });
    content.dispatchEvent(touchEvent('touchstart', 200));
    scrollSpy.mockClear();
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    await tick();

    expect(scrollSpy).not.toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) }));
  });
});
