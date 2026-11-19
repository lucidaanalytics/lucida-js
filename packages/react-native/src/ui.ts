// React Native UI components. Kept off the root entry so importing the root never loads `react-native` (node tests, SSR, sideEffects:false).
export { LucidaGuides } from "./guides-view.js";
export { GuideAnchor, measureAnchor, registerAnchor } from "./guide-anchor.js";
export type { Measurable } from "./guide-anchor.js";
export { LucidaMask, LucidaUnmask, LucidaTouchCapture, replayMarker, REPLAY_MARKERS } from "./mask.js";
