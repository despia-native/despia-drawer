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
});
