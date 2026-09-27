import "@testing-library/react";

/**
 * jsdom gives every element a size of zero and has no ResizeObserver, which
 * between them mean a virtualised grid renders no rows at all. Both are
 * stubbed so the window under test behaves as it does on screen.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
globalThis.scrollTo ??= (() => {}) as typeof globalThis.scrollTo;

const VIEWPORT = { width: 1280, height: 800 };

for (const [property, value] of [
  ["clientWidth", VIEWPORT.width],
  ["clientHeight", VIEWPORT.height],
  ["offsetWidth", VIEWPORT.width],
  ["offsetHeight", VIEWPORT.height],
] as const) {
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    get() {
      return value;
    },
  });
}

HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: VIEWPORT.width,
    bottom: VIEWPORT.height,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    toJSON: () => ({}),
  } as DOMRect;
};

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof globalThis.matchMedia;
