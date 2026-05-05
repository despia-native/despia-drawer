import { afterEach, beforeEach, vi } from 'vitest';

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: TestResizeObserver,
  configurable: true
});

Object.defineProperty(window, 'scrollY', {
  value: 0,
  writable: true,
  configurable: true
});

window.scrollTo = (_x: number, y?: number) => {
  Object.defineProperty(window, 'scrollY', {
    value: typeof y === 'number' ? y : 0,
    writable: true,
    configurable: true
  });
};

window.requestAnimationFrame = (callback: FrameRequestCallback) => {
  return window.setTimeout(() => callback(performance.now()), 0);
};

window.cancelAnimationFrame = (id: number) => {
  window.clearTimeout(id);
};

HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number, y?: number) {
  const top = typeof options === 'number'
    ? y ?? 0
    : options?.top ?? this.scrollTop;
  this.scrollTop = top;
  this.dispatchEvent(new Event('scroll'));
  window.setTimeout(() => this.dispatchEvent(new Event('scrollend')), 0);
};

beforeEach(() => {
  document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
  document.body.innerHTML = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});
