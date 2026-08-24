import { getAiPointerJsxRuntime } from "../host-runtime";

const runtime = getAiPointerJsxRuntime();

export const Fragment = runtime.Fragment;
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
