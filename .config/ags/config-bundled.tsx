#!/usr/bin/env -S ags run
/**
 * Bundled AGS Configuration
 * 
 * This file bundles all 5 AGS daemon components into a single process:
 * - confirm-dialog
 * - volume-change-indicator  
 * - keyboard-layout-switcher
 * - start-menu
 * - window-switcher
 * 
 * Each component maintains its own isolated scope while sharing a single
 * app.start() entry point and unified request handler.
 */

import app from "ags/gtk4/app";

// Type definitions for global namespace components
interface ComponentModule {
  init: () => void;
  handleRequest: (argv: string[], res: (response: any) => void) => void;
  instanceName: string;
}

declare global {
  var ConfirmDialog: ComponentModule;
  var VolumeIndicator: ComponentModule;
  var KeyboardSwitcher: ComponentModule;
  var StartMenu: ComponentModule;
  var WindowSwitcher: ComponentModule;
  var DesktopClock: ComponentModule;
}

// Load components using global namespace pattern (no ES6 exports)
import "./lib/confirm-dialog.tsx";
import "./lib/volume-indicator.tsx";
import "./lib/keyboard-switcher.tsx";
import "./lib/start-menu.tsx";
import "./lib/window-switcher.tsx";
import "./lib/desktop-clock.tsx";

// Component registry for request routing
type ComponentHandler = (argv: string[], res: (response: string) => void) => void;

interface ComponentRegistry {
  [key: string]: ComponentHandler;
}

const components: ComponentRegistry = {};

// Register components
function registerComponent(name: string, handler: ComponentHandler) {
  components[name] = handler;
}

// Unified request handler that routes to appropriate component
function handleRequest(argv: string[], res: (response: any) => void) {
  try {
    // First arg should be component name
    const [component, ...rest] = argv;
    
    // Handle empty/malformed requests
    if (!component || component.trim() === "") {
      res("ready");
      return;
    }
    
    // Route to component handler
    if (components[component]) {
      components[component](rest, res);
    } else {
      // Try parsing as JSON (backwards compatibility)
      try {
        const data = JSON.parse(argv.join(" "));
        
        // Infer component from action prefix if present
        // e.g., {"action": "confirm-dialog:show", ...}
        if (data.action && data.action.includes(":")) {
          const [comp, action] = data.action.split(":");
          if (components[comp]) {
            components[comp]([JSON.stringify({ ...data, action })], res);
            return;
          }
        }
        
        res("error: component not specified");
      } catch {
        res(`error: unknown component "${component}"`);
      }
    }
  } catch (e) {
    console.error("Error in bundled request handler:", e);
    res("error: " + e);
  }
}

// Main entry point
app.start({
  main() {
    console.log("[Bundled AGS] Initializing all components...");
    
    // Initialize confirm-dialog
    try {
      globalThis.ConfirmDialog.init();
      registerComponent(globalThis.ConfirmDialog.instanceName, globalThis.ConfirmDialog.handleRequest);
      console.log(`[Bundled AGS] ✓ ${globalThis.ConfirmDialog.instanceName} initialized`);
    } catch (e) {
      console.error(`[Bundled AGS] ✗ Failed to initialize confirm-dialog:`, e);
    }
    
    // Initialize volume-indicator
    try {
      globalThis.VolumeIndicator.init();
      registerComponent(globalThis.VolumeIndicator.instanceName, globalThis.VolumeIndicator.handleRequest);
      console.log(`[Bundled AGS] ✓ ${globalThis.VolumeIndicator.instanceName} initialized`);
    } catch (e) {
      console.error(`[Bundled AGS] ✗ Failed to initialize volume-indicator:`, e);
    }
    
    // Initialize keyboard-switcher
    try {
      globalThis.KeyboardSwitcher.init();
      registerComponent(globalThis.KeyboardSwitcher.instanceName, globalThis.KeyboardSwitcher.handleRequest);
      console.log(`[Bundled AGS] ✓ ${globalThis.KeyboardSwitcher.instanceName} initialized`);
    } catch (e) {
      console.error(`[Bundled AGS] ✗ Failed to initialize keyboard-switcher:`, e);
    }
    
    // Initialize start-menu
    try {
      globalThis.StartMenu.init();
      registerComponent(globalThis.StartMenu.instanceName, globalThis.StartMenu.handleRequest);
      console.log(`[Bundled AGS] ✓ ${globalThis.StartMenu.instanceName} initialized`);
    } catch (e) {
      console.error(`[Bundled AGS] ✗ Failed to initialize start-menu:`, e);
    }
    
    // Initialize window-switcher
    try {
      globalThis.WindowSwitcher.init();
      registerComponent(globalThis.WindowSwitcher.instanceName, globalThis.WindowSwitcher.handleRequest);
      console.log(`[Bundled AGS] ✓ ${globalThis.WindowSwitcher.instanceName} initialized`);
    } catch (e) {
      console.error(`[Bundled AGS] ✗ Failed to initialize window-switcher:`, e);
    }
    
    // Initialize desktop-clock
    try {
      globalThis.DesktopClock.init();
      registerComponent(globalThis.DesktopClock.instanceName, globalThis.DesktopClock.handleRequest);
      console.log(`[Bundled AGS] ✓ ${globalThis.DesktopClock.instanceName} initialized`);
    } catch (e) {
      console.error(`[Bundled AGS] ✗ Failed to initialize desktop-clock:`, e);
    }
    
    console.log("[Bundled AGS] All components initialized");
    return null;
  },
  
  instanceName: "ags-bundled",
  
  requestHandler: handleRequest,
});
