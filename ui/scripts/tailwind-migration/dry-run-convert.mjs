#!/usr/bin/env node

import { collectCssRules, cssModulePath, formatPercent, printHeader, readCssSource, writeJsonReport } from './lib.mjs';

const jsonMode = process.argv.includes('--json');

const hardPropertyPattern =
  /(^|;\s*)(backdrop-filter|filter|box-shadow|background|mask|clip-path|animation|content|cursor|scrollbar-width|-ms-overflow-style)\s*:/i;

async function loadConverter() {
  try {
    const module = await import('transform-to-tailwindcss-core');
    return module.transformStyleToTailwindcss ?? null;
  } catch {
    return null;
  }
}

function heuristicConvert(declarationsText) {
  const declarations = declarationsText
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.endsWith(';') ? part : `${part};`));

  let converted = 0;
  let arbitrary = 0;
  let failed = 0;
  const failures = [];

  for (const declaration of declarations) {
    if (hardPropertyPattern.test(declaration)) {
      failed += 1;
      failures.push(declaration);
      continue;
    }

    if (/var\(--/.test(declaration)) {
      arbitrary += 1;
      continue;
    }

    if (/^[\w-]+\s*:/.test(declaration)) {
      converted += 1;
    }
  }

  return {
    mode: 'heuristic',
    converted,
    arbitrary,
    failed,
    failures,
    classEstimate: '',
  };
}

async function convertRule(transformStyleToTailwindcss, declarationsText) {
  if (!transformStyleToTailwindcss) {
    return heuristicConvert(declarationsText);
  }

  const [classEstimate, unconverted] = transformStyleToTailwindcss(declarationsText, false, false, true);
  const declarationCount = declarationsText
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean).length;
  const failed = unconverted.length;
  const converted = Math.max(0, declarationCount - failed - countArbitrary(classEstimate));
  const arbitrary = countArbitrary(classEstimate);

  return {
    mode: 'transform-to-tailwindcss-core',
    converted,
    arbitrary,
    failed,
    failures: unconverted,
    classEstimate,
  };
}

function countArbitrary(className) {
  return (className.match(/\[[^\]]+\]/g) ?? []).length;
}

function isDryRunCandidate(rule) {
  if (rule.context.insideMedia || rule.context.insideKeyframes) {
    return false;
  }

  if (rule.risk.bucket === 'manual' || rule.risk.bucket === 'keep_css') {
    return false;
  }

  if (rule.classNames.length !== 1) {
    return false;
  }

  if (rule.selector.trim() !== `.${rule.classNames[0]}`) {
    return false;
  }

  return true;
}

async function main() {
  const cssSource = readCssSource();
  const rules = collectCssRules(cssSource);
  const transformStyleToTailwindcss = await loadConverter();
  const candidates = rules.filter(isDryRunCandidate);

  const results = [];
  let full = 0;
  let partial = 0;
  let blocked = 0;
  let totalClassLength = 0;

  for (const rule of candidates) {
    const conversion = await convertRule(transformStyleToTailwindcss, rule.declarationsText);
    const outcome =
      conversion.failed === 0 && conversion.arbitrary === 0 ? 'full' : conversion.failed === 0 ? 'partial' : 'blocked';

    if (outcome === 'full') {
      full += 1;
    } else if (outcome === 'partial') {
      partial += 1;
    } else {
      blocked += 1;
    }

    totalClassLength += conversion.classEstimate.length;

    results.push({
      className: rule.classNames[0],
      outcome,
      declarationCount: rule.declarationCount,
      classLength: conversion.classEstimate.length,
      sampleClasses: conversion.classEstimate,
      unconverted: conversion.failures,
      risk: rule.risk.bucket,
    });
  }

  const payload = {
    cssModulePath,
    converter: transformStyleToTailwindcss ? 'transform-to-tailwindcss-core' : 'built-in-heuristic',
    candidateRules: candidates.length,
    totalRules: rules.length,
    outcomes: { full, partial, blocked },
    avgClassLength: candidates.length === 0 ? 0 : Math.round(totalClassLength / candidates.length),
    samples: {
      full: results.filter((entry) => entry.outcome === 'full').slice(0, 8),
      partial: results.filter((entry) => entry.outcome === 'partial').slice(0, 8),
      blocked: results.filter((entry) => entry.outcome === 'blocked').slice(0, 8),
    },
    destructiveEstimate: {
      safeAutoMigrationPercent: formatPercent(full, candidates.length),
      needsManualTouchPercent: formatPercent(partial + blocked, candidates.length),
      note: 'Only isolated single-class rules are tested. Grouped selectors, media, pseudo, and :global are excluded by design.',
    },
    nextTools: [
      'npx @tailwindcss/upgrade (Tailwind v3->v4 only, already on v4 here)',
      'npx @vyeos/css-to-tailwind-react --dry-run --diff ./components (full JSX+CSS migrator)',
      'npm i -D transform-to-tailwindcss-core (rerun this script for library-backed scoring)',
    ],
  };

  const reportPath = writeJsonReport('dry-run-convert.json', payload);

  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printHeader('Dry-run conversion (no files modified)');
  console.log(`Converter: ${payload.converter}`);
  console.log(`Candidate rules: ${candidates.length}/${rules.length} (isolated .class only)`);
  console.log('');
  console.log('Simulated outcomes on candidates:');
  console.log(
    `  full     ${full.toString().padStart(4)}  ${formatPercent(full, candidates.length)}  all declarations mapped`,
  );
  console.log(
    `  partial  ${partial.toString().padStart(4)}  ${formatPercent(partial, candidates.length)}  arbitrary values / var()`,
  );
  console.log(
    `  blocked  ${blocked.toString().padStart(4)}  ${formatPercent(blocked, candidates.length)}  hard properties remain`,
  );
  console.log(`  avg className length: ${payload.avgClassLength} chars`);
  console.log('');
  console.log('Examples (partial/blocked):');
  for (const entry of [...payload.samples.partial, ...payload.samples.blocked].slice(0, 6)) {
    const tail = entry.unconverted.length > 0 ? ` | leftover: ${entry.unconverted.join(' ')}` : '';
    console.log(`  - .${entry.className} [${entry.outcome}] ${entry.sampleClasses || '(heuristic only)'}${tail}`);
  }
  console.log('');
  if (!transformStyleToTailwindcss) {
    console.log('Note: install optional converter for better scoring:');
    console.log('  npm i -D transform-to-tailwindcss-core');
  }
  console.log('');
  console.log('Official-style workflow (best practice):');
  console.log('  1) commit clean tree');
  console.log('  2) run these audits');
  console.log('  3) migrate tokens to @theme in globals.css');
  console.log('  4) migrate smallest files first');
  console.log('  5) optional full migrator dry-run: npx @vyeos/css-to-tailwind-react --dry-run --diff ./components');
  console.log('');
  console.log(`JSON report: ${reportPath}`);
}

main();
