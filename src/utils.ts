
export const easeInOutCubic = (t: number): number => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const getViewportCenter = (scrollY: number): number => scrollY + window.innerHeight / 2;
export const clampScroll = (scrollY: number, maxScroll: number): number => Math.max(0, Math.min(scrollY, maxScroll));
