#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import chroma from 'chroma-js';

/**
 * Contrast Validation Script using chroma-js
 *
 * Validates and suggests WCAG AA compliant colors (4.5:1 minimum for normal text)
 *
 * Usage: node scripts/validate-contrast.js
 */

// Read tokens
const tokens = JSON.parse(readFileSync('./tokens.json', 'utf-8'));

const WCAG_AA_NORMAL = 4.5;

console.log('🎨 Contrast Validation Report\n');
console.log('='.repeat(80));

/**
 * Test contrast ratio and suggest improvements
 */
function validateContrast(bgColor, textColor, label, minRatio = WCAG_AA_NORMAL) {
  const contrast = chroma.contrast(bgColor, textColor);
  const passes = contrast >= minRatio;
  const status = passes ? '✓ PASS' : '✗ FAIL';

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

// Test semantic color ramps
console.log('\n📊 Semantic Color Ramps (Buttons & Tags)');
console.log('-'.repeat(80));

const results = {
  success: validateContrast(
    tokens.colors.state.success.value,
    tokens.colors.state['success-text'].value,
    'Success (Leaf)'
  ),
  successHover: validateContrast(
    tokens.colors.state['success-hover'].value,
    tokens.colors.state['success-text'].value,
    'Success Hover (Leaf)'
  ),
  successActive: validateContrast(
    tokens.colors.state['success-active'].value,
    tokens.colors.state['success-active-text'].value,
    'Success Active (Leaf)'
  ),
  warning: validateContrast(
    tokens.colors.state.warning.value,
    tokens.colors.state['warning-text'].value,
    'Warning (Wood)'
  ),
  warningHover: validateContrast(
    tokens.colors.state['warning-hover'].value,
    tokens.colors.state['warning-text'].value,
    'Warning Hover (Wood)'
  ),
  warningActive: validateContrast(
    tokens.colors.state['warning-active'].value,
    tokens.colors.state['warning-active-text'].value,
    'Warning Active (Wood)'
  ),
  error: validateContrast(
    tokens.colors.state.error.value,
    tokens.colors.state['error-text'].value,
    'Error (Rose)'
  ),
  errorHover: validateContrast(
    tokens.colors.state['error-hover'].value,
    tokens.colors.state['error-text'].value,
    'Error Hover (Rose)'
  ),
  errorActive: validateContrast(
    tokens.colors.state['error-active'].value,
    tokens.colors.state['error-active-text'].value,
    'Error Active (Rose)'
  ),
  info: validateContrast(
    tokens.colors.state.info.value,
    tokens.colors.state['info-text'].value,
    'Info (Sky)'
  ),
  infoHover: validateContrast(
    tokens.colors.state['info-hover'].value,
    tokens.colors.state['info-text'].value,
    'Info Hover (Sky)'
  ),
  infoActive: validateContrast(
    tokens.colors.state['info-active'].value,
    tokens.colors.state['info-active-text'].value,
    'Info Active (Sky)'
  ),
  purple: validateContrast(
    tokens.colors.state.purple.value,
    tokens.colors.state['purple-text'].value,
    'Purple (Blossom)'
  ),
  purpleHover: validateContrast(
    tokens.colors.state['purple-hover'].value,
    tokens.colors.state['purple-text'].value,
    'Purple Hover (Blossom)'
  ),
  purpleActive: validateContrast(
    tokens.colors.state['purple-active'].value,
    tokens.colors.state['purple-active-text'].value,
    'Purple Active (Blossom)'
  ),
};

// Test primary button
console.log('\n\n📊 Primary Colors');
console.log('-'.repeat(80));

const primary = validateContrast(
  tokens.colors.accent.primary.value,
  tokens.colors.accent.text.value,
  'Primary Button'
);
const active = validateContrast(
  tokens.colors.accent.active.value,
  tokens.colors.accent['active-text'].value,
  'Active Blue Surface'
);

// Summary
console.log(`\n\n${'='.repeat(80)}`);
console.log('📋 Summary');
console.log('='.repeat(80));

const allPassed = Object.values(results).every((r) => r.passes) && primary.passes && active.passes;

if (allPassed) {
  console.log('\n✅ All colors meet WCAG AA standards (4.5:1)!');
} else {
  console.log('\n❌ Some colors need adjustment. See suggestions above.');
  console.log('\nTo update tokens.json, use the suggested colors from this report.');
}

console.log('\n');
