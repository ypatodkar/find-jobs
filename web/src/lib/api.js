// Where the analytics API lives (clicks, likes, feedback, the click counter), from the
// shared api-config.js. The fallback is the literal each old script kept.
import "../../../api-config.js";

export const ENDPOINT = (typeof window !== "undefined" && window.API_ENDPOINT) || "https://vcjobs-clicks.ypatodkar.workers.dev";
