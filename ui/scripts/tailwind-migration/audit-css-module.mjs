#!/usr/bin/env node

import {
  collectCssRules,
  cssModulePath,
  formatPercent,
  indexRulesByClass,
  printHeader,
  readCssSource,
  summarizeRiskBuckets,
  writeJsonReport,
} from './lib.mjs';

const jsonMode = process.argv.includes('--json');

function main() {
  const cssSource = readCssSource();
  const lineCount = cssSource.split('\n').length;
  const rules = collectCssRules(cssSource);
  const buckets = summarizeRiskBuckets(rules);
  const byClass = indexRulesByClass(rules);
  const pageRule = rules.find((rule) => rule.classNames.includes('page'));
  const cssVariablesOnPage = pageRule
    ? [...pageRule.declarationsText.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1])
    : [];

  const globalRules = rules.filter((rule) => rule.selector.includes(':global'));
  const mediaRules = rules.filter((rule) => rule.context.insideMedia);
  const keyframeRules = rules.filter((rule) => rule.context.insideKeyframes);

  const classRisk = [...byClass.entries()]
    .map(([className, classRules]) => {
      const bucketsForClass = summarizeRiskBuckets(classRules);
      const worst = classRules.reduce((current, rule) => {
        const order = { keep_css: 4, manual: 3, review: 2, auto: 1 };
        return order[rule.risk.bucket] > order[current.risk.bucket] ? rule : current;
      }, classRules[0]);

      return {
        className,
        ruleCount: classRules.length,
        buckets: bucketsForClass,
        worstBucket: worst.risk.bucket,
        reasons: worst.risk.reasons,
        sampleSelector: worst.selector,
      };
    })
    .sort((left, right) => {
      const order = { keep_css: 4, manual: 3, review: 2, auto: 1 };
      return order[right.worstBucket] - order[left.worstBucket] || left.className.localeCompare(right.className);
    });

  const payload = {
    cssModulePath,
    lineCount,
    ruleCount: rules.length,
    uniqueClasses: byClass.size,
    buckets,
    cssVariablesOnPage,
    globalRuleCount: globalRules.length,
    mediaRuleCount: mediaRules.length,
    keyframeRuleCount: keyframeRules.length,
    classRisk,
    hardestRules: rules
      .filter((rule) => rule.risk.bucket === 'keep_css' || rule.risk.bucket === 'manual')
      .slice(0, 40)
      .map((rule) => ({
        selector: rule.selector,
        bucket: rule.risk.bucket,
        reasons: rule.risk.reasons,
        declarationCount: rule.declarationCount,
      })),
  };

  const reportPath = writeJsonReport('audit-css-module.json', payload);

  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printHeader('CSS module migration audit (read-only)');
  console.log(`File: ${cssModulePath}`);
  console.log(`Lines: ${lineCount} | Rules: ${rules.length} | Unique classes: ${byClass.size}`);
  console.log('');
  console.log('Risk buckets (rule-level, not class-level):');
  console.log(
    `  auto      ${buckets.auto.toString().padStart(4)}  ${formatPercent(buckets.auto, rules.length)}  likely utility-friendly`,
  );
  console.log(
    `  review    ${buckets.review.toString().padStart(4)}  ${formatPercent(buckets.review, rules.length)}  var()/calc(), needs @theme tokens`,
  );
  console.log(
    `  manual    ${buckets.manual.toString().padStart(4)}  ${formatPercent(buckets.manual, rules.length)}  grouped/context/media/pseudo`,
  );
  console.log(
    `  keep_css  ${buckets.keep_css.toString().padStart(4)}  ${formatPercent(buckets.keep_css, rules.length)}  gradients, backdrop, :global, keyframes`,
  );
  console.log('');
  console.log(`Design tokens on .page: ${cssVariablesOnPage.length}`);
  console.log(
    `:global rules: ${globalRules.length} | @media rules: ${mediaRules.length} | @keyframes rules: ${keyframeRules.length}`,
  );
  console.log('');
  console.log('Top 12 classes by migration friction:');
  for (const entry of classRisk.filter((item) => item.worstBucket !== 'auto').slice(0, 12)) {
    const reasonText = entry.reasons.length > 0 ? entry.reasons.join(', ') : entry.sampleSelector;
    console.log(`  - ${entry.className} [${entry.worstBucket}] ${reasonText}`);
  }
  console.log('');
  console.log(`JSON report: ${reportPath}`);
  console.log('');
  console.log('Interpretation:');
  console.log('  <40% auto  => expect heavy manual work');
  console.log('  >60% auto  => incremental file-by-file migration is realistic');
  console.log('  keep_css >15% => plan a small global CSS layer (@utility / react-flow overrides)');
}

main();
