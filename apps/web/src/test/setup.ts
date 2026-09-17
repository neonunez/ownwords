import '@testing-library/jest-dom/vitest';

// jsdom has no layout engine, so these are stubbed rather than asserted on.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
}

// jsdom implements no scrolling, and the shell scrolls a new screen to the top.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
