import app from "ags/gtk4/app";
import "./start-menu.case";
import "./window-switcher-preview-cache.case";
import { runSuite } from "./harness";

app.register(null);
await runSuite();
