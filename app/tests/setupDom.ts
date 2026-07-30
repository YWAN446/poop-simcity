// Polyfills for browser APIs jsdom doesn't implement. Needed because importing
// `App` (to test dataset switching end-to-end) transitively pulls in
// maplibre-gl and uplot even for a test that never renders a map or chart —
// both libraries touch these APIs at module top-level, so merely importing
// them throws in jsdom without this. A no-op under the "node" environment
// most test files run in (no `window` there).
if (typeof window !== "undefined") {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:mock";
  }
}
