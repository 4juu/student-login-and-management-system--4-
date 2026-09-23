import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement matchMedia — needed by some UI libs
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement window scrollTo/scroll (students' tab switching calls it)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).scrollTo = (window as any).scrollTo || (() => {});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).scroll = (window as any).scroll || (() => {});

// jsdom doesn't implement window.scrollTo / scroll (components call it on tab change)
if (!window.scrollTo) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).scrollTo = () => {};
}
if (!window.scroll) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).scroll = () => {};
}

// crypto.randomUUID polyfill for older Node
if (!globalThis.crypto?.randomUUID) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis.crypto as any).randomUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}
