#!/usr/bin/env node
import { readFileSync } from "node:fs";
import chroma from "chroma-js";

/**
 * Contrast Validation Script using chroma-js
 *
 * Validates and suggests WCAG AA compliant colors (4.5:1 minimum for normal text)
 *
 * Usage: node scripts/validate-contrast.js
 */

// Read tokens
const tokens = JSON.parse(readFileSync("./tokens.json", "utf-8"));

const WCAG_AA_NORMAL = 4.5;
const WCAG_AA_LARGE = 3.0;
const WCAG_AAA_NORMAL = 7.0;

console.log("🎨 Contrast Validation Report\n");
console.log("=".repeat(80));

/**
 * Test contrast ratio and suggest improvements
 */
function validateContrast(bgColor, textColor, label, minRatio = WCAG_AA_NORMAL) {
  const contrast = chroma.contrast(bgColor, textColor);
  const passes = contrast >= minRatio;
  const status = passes ? "✓ PASS" : "✗ FAIL";

  console.log(`\n${label}`);
  console.log(`  Background: ${bgColor}`);
  console.log(`  Text: ${textColor}`);
  console.log(`  Contrast: ${contrast.toFixed(2)}:1 (need ${minRatio}:1) ${status}`);

  if (!passes) {
    // Suggest darker text color using chroma
    let darkerText = chroma(textColor);
    let testContrast = contrast;
    let iterations = 0;

    while (testContrast < minRatio && iterations < 20) {
      darkerText = darkerText.darken(0.1);
      testContrast = chroma.contrast(bgColor, darkerText.hex());
      iterations++;
    }

    const suggestion = darkerText.hex();
    console.log(`  ⚠️  Suggestion: ${suggestion} (${testContrast.toFixed(2)}:1)`);
    return { passes: false, suggestion, contrast: testContrast };
  }

  return { passes: true, contrast };
}

// Test semantic state colors
console.log("\n📊 Semantic State Colors (Buttons & Tags)");
console.log("-".repeat(80));

const results = {
  success: validateContrast(
    tokens.colors.state.success.value,
    tokens.colors.state["success-text"].value,
    "Success (Green)"
  ),
  warning: validateContrast(
    tokens.colors.state.warning.value,
    tokens.colors.state["warning-text"].value,
    "Warning (Orange)"
  ),
  error: validateContrast(
    tokens.colors.state.error.value,
    tokens.colors.state["error-text"].value,
    "Error (Red)"
  ),
};

// Test primary button
console.log("\n\n📊 Primary Colors");
console.log("-".repeat(80));

const primary = validateContrast(
  tokens.colors.accent.primary.value,
  "#ffffff",
  "Primary Button (Blue + White)"
);

// Summary
console.log(`\n\n${"=".repeat(80)}`);
console.log("📋 Summary");
console.log("=".repeat(80));

const allPassed = Object.values(results).every((r) => r.passes) && primary.passes;

if (allPassed) {
  console.log("\n✅ All colors meet WCAG AA standards (4.5:1)!");
} else {
  console.log("\n❌ Some colors need adjustment. See suggestions above.");
  console.log("\nTo update tokens.json, use the suggested colors from this report.");
}

console.log("\n");
