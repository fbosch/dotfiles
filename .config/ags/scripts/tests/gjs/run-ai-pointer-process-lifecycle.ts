import app from "ags/gtk4/app";
import "./ai-pointer-process-lifecycle.case";
import { runSuite } from "./harness";

app.register(null);
await runSuite();
