#!/usr/bin/env node

import {
  collectCssRules,
  cssModulePath,
  formatPercent,
  highestRiskForClass,
  indexRulesByClass,
  listSourceFiles,
  printHeader,
  readCssSource,
  scanStylesUsage,
  writeJsonReport,
} from './lib.mjs';

const jsonMode = process.argv.includes('--json');

function estimateFileDestructiveness(fileUsage, rulesByClass) {
  let weightedRisk = 0;
  let references = 0;

  for (const [className, count] of Object.entries(fileUsage)) {
    const classRules = rulesByClass.get(className) ?? [];
    const risk =
      classRules.length > 0 ? highestRiskForClass(classRules) : { bucket: 'manual', reasons: ['missing css rule'] };
    const weight = { auto: 1, review: 2, manual: 4, keep_css: 5 }[risk.bucket];
    weightedRisk += weight * count;
    references += count;
  }

  const score = references === 0 ? 0 : weightedRisk / references;
  let label = 'low';

  if (score >= 3.5) {
    label = 'high';
  } else if (score >= 2.2) {
    label = 'medium';
  }

  return { score: Number(score.toFixed(2)), label, references };
}

function main() {
  const cssSource = readCssSource();
  const rules = collectCssRules(cssSource);
  const rulesByClass = indexRulesByClass(rules);
  const usage = scanStylesUsage(listSourceFiles());

  const usedClasses = new Set(Object.keys(usage.usageByClass));
  const definedClasses = new Set(rulesByClass.keys());
  const unusedClasses = [...definedClasses].filter((className) => !usedClasses.has(className)).sort();
  const missingClasses = [...usedClasses].filter((className) => !definedClasses.has(className)).sort();

  const weightedUsageBuckets = { auto: 0, review: 0, manual: 0, keep_css: 0 };
  for (const [className, count] of Object.entries(usage.usageByClass)) {
    const classRules = rulesByClass.get(className) ?? [];
    const risk = classRules.length > 0 ? highestRiskForClass(classRules) : { bucket: 'manual' };
    weightedUsageBuckets[risk.bucket] += count;
  }

  const fileRanking = Object.entries(usage.usageByFile)
    .map(([relativePath, fileUsage]) => ({
      file: relativePath,
      ...estimateFileDestructiveness(fileUsage, rulesByClass),
      classes: Object.keys(fileUsage).length,
    }))
    .sort((left, right) => right.score - left.score || right.references - left.references);

  const payload = {
    cssModulePath,
    styleImportFiles: usage.styleImportFiles,
    totalStyleReferences: usage.totalReferences,
    uniqueUsedClasses: usedClasses.size,
    uniqueDefinedClasses: definedClasses.size,
    unusedClassCount: unusedClasses.length,
    missingClassCount: missingClasses.length,
    weightedUsageBuckets,
    usageByClass: usage.usageByClass,
    usageByFile: usage.usageByFile,
    fileRanking,
    unusedClasses: unusedClasses.slice(0, 80),
    missingClasses,
    recommendedOrder: fileRanking
      .slice()
      .sort((left, right) => left.references - right.references || left.score - right.score)
      .map((entry) => ({
        file: entry.file,
        destructiveness: entry.label,
        references: entry.references,
        score: entry.score,
      })),
  };

  const reportPath = writeJsonReport('audit-jsx-usage.json', payload);

  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printHeader('JSX usage audit (read-only)');
  console.log(`Files importing module CSS: ${usage.styleImportFiles.length}`);
  console.log(`Style references: ${usage.totalReferences} across ${usedClasses.size} classes`);
  console.log(`Defined classes in CSS: ${definedClasses.size}`);
  console.log(`Unused classes: ${unusedClasses.length} | Missing definitions: ${missingClasses.length}`);
  console.log('');
  console.log('Weighted usage by migration bucket (reference count):');
  console.log(
    `  auto      ${weightedUsageBuckets.auto.toString().padStart(4)}  ${formatPercent(weightedUsageBuckets.auto, usage.totalReferences)}`,
  );
  console.log(
    `  review    ${weightedUsageBuckets.review.toString().padStart(4)}  ${formatPercent(weightedUsageBuckets.review, usage.totalReferences)}`,
  );
  console.log(
    `  manual    ${weightedUsageBuckets.manual.toString().padStart(4)}  ${formatPercent(weightedUsageBuckets.manual, usage.totalReferences)}`,
  );
  console.log(
    `  keep_css  ${weightedUsageBuckets.keep_css.toString().padStart(4)}  ${formatPercent(weightedUsageBuckets.keep_css, usage.totalReferences)}`,
  );
  console.log('');
  console.log('Most destructive files first (higher = more manual/keep_css work):');
  for (const entry of fileRanking.slice(0, 8)) {
    console.log(`  - [${entry.label}] ${entry.file}  score=${entry.score} refs=${entry.references}`);
  }
  console.log('');
  console.log('Suggested migration order (least destructive first):');
  for (const entry of payload.recommendedOrder) {
    console.log(`  - ${entry.file} (${entry.destructiveness}, score=${entry.score}, ${entry.references} refs)`);
  }
  console.log('');
  console.log(`JSON report: ${reportPath}`);
}

main();
