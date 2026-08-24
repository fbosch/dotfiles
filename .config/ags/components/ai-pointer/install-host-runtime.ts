import { createRoot } from "ags";
import app from "ags/gtk4/app";
import * as agsJsxRuntime from "ags/gtk4/jsx-runtime";

globalThis.AgsApplication = app;
globalThis.AgsCreateRoot = createRoot;
globalThis.AgsJsxRuntime = agsJsxRuntime;
