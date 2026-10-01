// motion 13.4.6 ships its browser build (dist/motion.js) as UMD. Evaluated as
// a module it has no `exports` or `define` to find, so it sets
// `globalThis.Motion`; this re-exports what the page uses from there.
import "./motion.js";

export const { animate, spring } = globalThis.Motion;
