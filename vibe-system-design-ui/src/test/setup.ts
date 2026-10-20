import "@testing-library/jest-dom/vitest";

// jsdom does not process the Tailwind v4 `@theme` tokens, and its
// getComputedStyle does not resolve `var()`. So inject the chat design tokens
// as concrete colors, with `.dark` overrides mirroring the flip that
// src/index.css performs via CSS variables. This lets tests assert the actual
// computed background of chat surfaces under light and dark themes.
const tokenCss = `
:root {
  --background: #f6f5f4;
  --foreground: #000000;
  --card: #ffffff;
  --card-foreground: #000000;
  --primary: #0075de;
  --primary-foreground: #ffffff;
  --border: #e6e6e6;
  --radius: 0.5rem;
}
.dark {
  --background: #191919;
  --foreground: #ffffff;
  --card: #202020;
  --card-foreground: #ffffff;
  --primary: #0075de;
  --primary-foreground: #ffffff;
  --border: #2f2f2f;
}
/* Concrete Tailwind token utilities used by the chat components (Tailwind
   itself does not run in tests). The .dark overrides reproduce the var flip. */
.bg-background { background-color: #f6f5f4; }
.dark .bg-background { background-color: #191919; }
.bg-card { background-color: #ffffff; }
.dark .bg-card { background-color: #202020; }
.bg-primary { background-color: #0075de; }
.dark .bg-primary { background-color: #0075de; }
.text-foreground { color: #000000; }
.dark .text-foreground { color: #ffffff; }
.text-card-foreground { color: #000000; }
.dark .text-card-foreground { color: #ffffff; }
.text-primary-foreground { color: #ffffff; }
.border-border { border-color: #e6e6e6; }
.dark .border-border { border-color: #2f2f2f; }
`;

if (typeof document !== "undefined" && !document.getElementById("chat-test-tokens")) {
  const style = document.createElement("style");
  style.id = "chat-test-tokens";
  style.textContent = tokenCss;
  document.head.appendChild(style);
}

// jsdom lacks ResizeObserver, which assistant-ui's thread viewport uses for
// auto-scroll. Provide a no-op polyfill so rendering does not throw.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}
