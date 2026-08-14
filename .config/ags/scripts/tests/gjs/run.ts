import app from "ags/gtk4/app";
import "./start-menu.case";
import "./audio-mixer.case";
import "./calendar.case";
import "./keyboard-switcher.case";
import "./volume-indicator.case";
import "./window-switcher.case";
import "./window-switcher-preview-cache.case";
import { runSuite } from "./harness";

app.register(null);
await runSuite();
