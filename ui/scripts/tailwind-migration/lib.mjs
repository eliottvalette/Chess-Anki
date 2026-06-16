import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const uiRoot = path.resolve(scriptDirectory, '../..');
export const cssModulePath = path.join(uiRoot, 'components/chess-analysis-lab.module.css');
export const reportsDirectory = path.join(uiRoot, 'reports/tailwind-migration');

export const styleImportGlobs = ['components/**/*.{tsx,ts,jsx,js}', 'app/**/*.{tsx,ts,jsx,js}'];

export const riskOrder = ['auto', 'review', 'manual', 'keep_css'];

export function readCssSource() {
  return fs.readFileSync(cssModulePath, 'utf8');
}

export function ensureReportsDirectory() {
  fs.mkdirSync(reportsDirectory, { recursive: true });
}

export function writeJsonReport(fileName, payload) {
  ensureReportsDirectory();
  const targetPath = path.join(reportsDirectory, fileName);
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return targetPath;
}

export function parseCssModule(cssSource) {
  return postcss.parse(cssSource, { from: cssModulePath });
}

function stripSelectorToken(selector) {
  return selector
    .replace(/:global\(([^)]+)\)/g, '$1')
    .replace(/::?[a-z-]+(\([^)]*\))?/gi, '')
    .replace(/\[[^\]]+\]/g, '')
    .trim();
}

export function extractModuleClassNames(selector) {
  const names = new Set();
  const chunks = selector.split(',').map((part) => part.trim());

  for (const chunk of chunks) {
    const normalized = stripSelectorToken(chunk);
    const matches = normalized.matchAll(/\.([a-zA-Z_][\w-]*)/g);

    for (const match of matches) {
      names.add(match[1]);
    }
  }

  return [...names];
}

export function classifySelector(selector) {
  const flags = {
    grouped: selector.includes(','),
    descendant: /\s/.test(selector.trim()),
    pseudo: /::?[\w-]+/.test(selector),
    global: selector.includes(':global'),
    element: /(?:^|[\s>+~])([a-z]+|strong|span|div|button|input|textarea|label|svg|path)(?:$|[\s.:#[])/i.test(selector),
    nth: /:nth-/.test(selector),
    important: selector.includes('!important'),
  };

  return flags;
}

export function classifyDeclarations(declarationsText) {
  const text = declarationsText.toLowerCase();
  const flags = {
    cssVariables: /--[\w-]+\s*:/.test(declarationsText),
    varUsage: /var\(--/.test(declarationsText),
    gradient: /gradient\(/.test(text),
    backdrop: /backdrop-filter|backdrop-filter:/.test(text),
    multiBackground: (text.match(/background:/g) ?? []).length > 0 && text.includes(','),
    transitionList: /transition:\s*[^;]+,/.test(text),
    calc: /calc\(/.test(text),
    globalKeyword: /:\s*global/.test(declarationsText),
  };

  return flags;
}

export function scoreRuleRisk(selector, declarationsText, context) {
  const selectorFlags = classifySelector(selector);
  const declarationFlags = classifyDeclarations(declarationsText);

  if (context.insideKeyframes) {
    return { bucket: 'keep_css', reasons: ['@keyframes'] };
  }

  if (context.insideMedia) {
    return { bucket: 'manual', reasons: ['@media override'] };
  }

  if (selectorFlags.global) {
    return { bucket: 'keep_css', reasons: [':global / third-party surface'] };
  }

  if (selectorFlags.grouped) {
    return { bucket: 'manual', reasons: ['grouped selectors'] };
  }

  if (selectorFlags.descendant || selectorFlags.element || selectorFlags.nth) {
    return { bucket: 'manual', reasons: ['contextual selector'] };
  }

  if (selectorFlags.pseudo) {
    return { bucket: 'manual', reasons: ['pseudo selector'] };
  }

  const hardReasons = [];
  if (declarationFlags.cssVariables) hardReasons.push('defines CSS variables');
  if (declarationFlags.gradient) hardReasons.push('gradient');
  if (declarationFlags.backdrop) hardReasons.push('backdrop-filter');
  if (declarationFlags.multiBackground) hardReasons.push('layered background');
  if (declarationFlags.transitionList) hardReasons.push('multi-value transition');

  if (hardReasons.length > 0) {
    return { bucket: 'keep_css', reasons: hardReasons };
  }

  if (declarationFlags.varUsage || declarationFlags.calc) {
    return { bucket: 'review', reasons: declarationFlags.varUsage ? ['var(--token)'] : ['calc()'] };
  }

  return { bucket: 'auto', reasons: [] };
}

export function collectCssRules(cssSource) {
  const root = parseCssModule(cssSource);
  const rules = [];

  function walk(node, context) {
    if (node.type === 'atrule' && node.name === 'media') {
      for (const child of node.nodes ?? []) {
        walk(child, { ...context, insideMedia: true, mediaQuery: node.params });
      }
      return;
    }

    if (node.type === 'atrule' && node.name === 'keyframes') {
      for (const child of node.nodes ?? []) {
        walk(child, { ...context, insideKeyframes: true, keyframesName: node.params });
      }
      return;
    }

    if (node.type !== 'rule') {
      for (const child of node.nodes ?? []) {
        walk(child, context);
      }
      return;
    }

    const declarations = [];
    for (const child of node.nodes ?? []) {
      if (child.type === 'decl') {
        declarations.push(`${child.prop}: ${child.value}${child.important ? ' !important' : ''};`);
      }
    }

    const declarationsText = declarations.join(' ');
    const selector = node.selector ?? '';
    const classNames = extractModuleClassNames(selector);
    const risk = scoreRuleRisk(selector, declarationsText, context);

    rules.push({
      selector,
      classNames,
      declarationsText,
      declarationCount: declarations.length,
      risk,
      context: {
        insideMedia: Boolean(context.insideMedia),
        mediaQuery: context.mediaQuery ?? null,
        insideKeyframes: Boolean(context.insideKeyframes),
        keyframesName: context.keyframesName ?? null,
      },
    });

    for (const child of node.nodes ?? []) {
      if (child.type === 'rule') {
        walk(child, { ...context, nestedRule: true });
      }
    }
  }

  walk(root, { insideMedia: false, insideKeyframes: false });

  return rules;
}

export function summarizeRiskBuckets(rules) {
  const summary = { auto: 0, review: 0, manual: 0, keep_css: 0 };

  for (const rule of rules) {
    summary[rule.risk.bucket] += 1;
  }

  return summary;
}

export function indexRulesByClass(rules) {
  const byClass = new Map();

  for (const rule of rules) {
    for (const className of rule.classNames) {
      const existing = byClass.get(className) ?? [];
      existing.push(rule);
      byClass.set(className, existing);
    }
  }

  return byClass;
}

export function highestRiskForClass(classRules) {
  const priority = { keep_css: 4, manual: 3, review: 2, auto: 1 };
  let winner = classRules[0]?.risk ?? { bucket: 'auto', reasons: [] };

  for (const rule of classRules) {
    if (priority[rule.risk.bucket] > priority[winner.bucket]) {
      winner = rule.risk;
    }
  }

  return winner;
}

export function listSourceFiles() {
  const results = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') {
          continue;
        }
        walk(absolutePath);
        continue;
      }

      if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        continue;
      }

      results.push(absolutePath);
    }
  }

  for (const relativeDirectory of ['components', 'app']) {
    walk(path.join(uiRoot, relativeDirectory));
  }

  return results;
}

export function scanStylesUsage(sourceFiles) {
  const usageByClass = new Map();
  const usageByFile = new Map();
  const styleImportFiles = [];

  const directUsagePattern = /styles\.([A-Za-z_][\w]*)/g;
  const importPattern = /chess-analysis-lab\.module\.css/;

  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, 'utf8');

    if (!importPattern.test(source)) {
      continue;
    }

    styleImportFiles.push(filePath);
    const perFile = new Map();
    directUsagePattern.lastIndex = 0;

    let match = directUsagePattern.exec(source);
    while (match) {
      const className = match[1];
      usageByClass.set(className, (usageByClass.get(className) ?? 0) + 1);
      perFile.set(className, (perFile.get(className) ?? 0) + 1);
      match = directUsagePattern.exec(source);
    }

    usageByFile.set(path.relative(uiRoot, filePath), Object.fromEntries(perFile));
  }

  return {
    styleImportFiles: styleImportFiles.map((filePath) => path.relative(uiRoot, filePath)),
    usageByClass: Object.fromEntries([...usageByClass.entries()].sort((left, right) => right[1] - left[1])),
    usageByFile: Object.fromEntries(usageByFile),
    totalReferences: [...usageByClass.values()].reduce((sum, count) => sum + count, 0),
  };
}

export function formatPercent(part, total) {
  if (total === 0) {
    return '0%';
  }

  return `${Math.round((part / total) * 100)}%`;
}

export function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}
