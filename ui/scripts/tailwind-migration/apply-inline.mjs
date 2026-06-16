#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { collectCssRules, printHeader, readCssSource, uiRoot } from './lib.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const writeMode = args.includes('--write');
const jsonMode = args.includes('--json');
const fileArgs = args.filter((arg) => !arg.startsWith('--'));

if (!dryRun && !writeMode) {
  console.error('Pass --dry-run or --write');
  process.exit(1);
}

async function loadConverter() {
  try {
    const module = await import('transform-to-tailwindcss-core');
    return module.transformStyleToTailwindcss ?? null;
  } catch {
    return null;
  }
}

function buildYoloClassMap(rules) {
  const byClass = new Map();

  for (const rule of rules) {
    if (rule.context.insideKeyframes || rule.selector.includes(':global')) {
      continue;
    }

    for (const className of rule.classNames) {
      const bucket = byClass.get(className) ?? [];
      bucket.push(rule.declarationsText);
      byClass.set(className, bucket);
    }
  }

  return byClass;
}

async function convertDeclarations(transformStyleToTailwindcss, declarationChunks) {
  const parts = declarationChunks
    .join(' ')
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const utilities = [];
  const leftovers = [];

  for (const part of parts) {
    const declaration = `${part};`;

    try {
      const [className, unconverted] = transformStyleToTailwindcss(declaration, false, false, true);
      if (className.trim()) {
        utilities.push(className.trim());
      }

      for (const chunk of unconverted) {
        const separator = chunk.indexOf(':');
        if (separator === -1) {
          leftovers.push(chunk);
          continue;
        }

        const property = chunk.slice(0, separator).trim();
        const value = chunk
          .slice(separator + 1)
          .replace(/;$/, '')
          .trim();
        utilities.push(`[${property}:${value.replace(/\s+/g, '_')}]`);
      }
    } catch {
      const separator = part.indexOf(':');
      if (separator === -1) {
        continue;
      }

      const property = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      utilities.push(`[${property}:${value.replace(/\s+/g, '_')}]`);
    }
  }

  return [...new Set(utilities)].join(' ').trim();
}

function escapeForSingleQuotedString(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toClassNameAttribute(tailwind) {
  if (tailwind.includes('"')) {
    return `className={\`${tailwind.replace(/`/g, '\\`')}\`}`;
  }

  return `className="${tailwind}"`;
}

function normalizeClassNameAttributes(source) {
  let nextSource = source;

  nextSource = nextSource.replace(/className=\{'([^']*)'\}/g, (_match, value) => toClassNameAttribute(value));
  nextSource = nextSource.replace(/className=\{"([^"]*)"\}/g, (_match, value) => toClassNameAttribute(value));

  nextSource = nextSource.replace(/className=\{`([^`]+)`\}/g, (fullMatch, inner) => {
    if (inner.includes('${')) {
      return fullMatch;
    }

    const cleaned = inner
      .replace(/'([^']*)'/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return toClassNameAttribute(cleaned);
  });

  return nextSource;
}

function addToneAliases(classMap) {
  if (classMap.has('feedbackGood')) {
    classMap.set('tonePositive', classMap.get('feedbackGood'));
  }

  if (classMap.has('feedbackBad')) {
    classMap.set('toneNegative', classMap.get('feedbackBad'));
  }

  if (classMap.has('feedbackPending')) {
    classMap.set('toneNeutral', classMap.get('feedbackPending'));
  }
}

function buildGradeRecord(prefix, classMap) {
  const grades = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
  const entries = grades
    .map((grade) => {
      const tailwind = classMap.get(`${prefix}${grade}`);
      if (!tailwind) {
        return null;
      }

      return `  ${grade}: '${escapeForSingleQuotedString(tailwind)}'`;
    })
    .filter(Boolean);

  if (entries.length === 0) {
    return null;
  }

  return `const ${prefix}ClassByGrade = {\n${entries.join(',\n')},\n} as const satisfies Record<string, string>;`;
}

function rewriteDynamicStyleAccess(source, classMap) {
  let nextSource = source;
  const gradeRecords = [];

  for (const prefix of ['masteryGrade', 'masteryTone', 'masteryDistribution']) {
    const record = buildGradeRecord(prefix, classMap);
    if (record) {
      gradeRecords.push(record);
    }

    nextSource = nextSource.replace(
      new RegExp(`styles\\[\\s*\`${prefix}\\$\\{([^}]+)\\}\`\\s*\\]`, 'g'),
      `${prefix}ClassByGrade[$1]`,
    );
  }

  if (gradeRecords.length > 0 && nextSource.includes('masteryGradeClassByGrade[')) {
    nextSource = nextSource.replace(
      /import type \{ DeckCard, DeckFeedback \} from '@\/lib\/opening-training';\n/,
      `import type { DeckCard, DeckFeedback } from '@/lib/opening-training';\n\n${gradeRecords.join('\n\n')}\n`,
    );
  }

  nextSource = nextSource.replace(
    /function getMasteryGradeClass\(grade: MasteryGrade\) \{\n\s*return styles\[`masteryGrade\$\{grade\}`\];\n\}/,
    'function getMasteryGradeClass(grade: MasteryGrade) {\n  return masteryGradeClassByGrade[grade];\n}',
  );

  nextSource = nextSource.replace(
    /function getMasteryToneClass\(grade: MasteryGrade\) \{\n\s*return styles\[`masteryTone\$\{grade\}`\];\n\}/,
    'function getMasteryToneClass(grade: MasteryGrade) {\n  return masteryToneClassByGrade[grade];\n}',
  );

  return nextSource;
}

function applyReplacements(source, classMap) {
  const applied = new Set();
  const missing = new Set();

  let nextSource = source.replace(/styles\.([A-Za-z_][\w]*)/g, (fullMatch, className) => {
    const tailwind = classMap.get(className);
    if (!tailwind) {
      missing.add(className);
      return fullMatch;
    }

    applied.add(className);
    return `'${escapeForSingleQuotedString(tailwind)}'`;
  });

  nextSource = normalizeClassNameAttributes(nextSource);

  const remainingStyles = /styles\.[A-Za-z_][\w]*|styles\[`/.test(nextSource);
  if (!remainingStyles) {
    nextSource = nextSource.replace(/^import styles from ['"].*chess-analysis-lab\.module\.css['"];\n?/m, '');
  }

  return {
    nextSource,
    applied: [...applied],
    missing: [...missing],
    remainingStyles,
  };
}

function resolveTargetFiles() {
  if (fileArgs.length > 0) {
    return fileArgs.map((entry) => (path.isAbsolute(entry) ? entry : path.join(uiRoot, entry)));
  }

  const results = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') {
          continue;
        }
        walk(absolutePath);
        continue;
      }

      if (!/\.(tsx|jsx)$/.test(entry.name)) {
        continue;
      }

      const source = fs.readFileSync(absolutePath, 'utf8');
      if (source.includes('chess-analysis-lab.module.css')) {
        results.push(absolutePath);
      }
    }
  }

  walk(path.join(uiRoot, 'components'));
  walk(path.join(uiRoot, 'app'));
  return results;
}

async function main() {
  const transformStyleToTailwindcss = await loadConverter();
  if (!transformStyleToTailwindcss) {
    console.error('Install transform-to-tailwindcss-core first: npm i -D transform-to-tailwindcss-core');
    process.exit(1);
  }

  const rules = collectCssRules(readCssSource());
  const buckets = buildYoloClassMap(rules);
  const classMap = new Map();

  for (const [className, declarationChunks] of buckets.entries()) {
    const tailwind = await convertDeclarations(transformStyleToTailwindcss, declarationChunks);
    if (tailwind) {
      classMap.set(className, tailwind);
    }
  }

  addToneAliases(classMap);

  const targetFiles = resolveTargetFiles();
  const usedClasses = new Set();
  const fileReports = [];

  for (const filePath of targetFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(/styles\.([A-Za-z_][\w]*)/g)) {
      usedClasses.add(match[1]);
    }
  }

  const missingMappings = [...usedClasses].filter((className) => !classMap.has(className)).sort();

  for (const filePath of targetFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    let { nextSource, applied, missing, remainingStyles } = applyReplacements(source, classMap);
    nextSource = rewriteDynamicStyleAccess(nextSource, classMap);
    remainingStyles = /styles\.[A-Za-z_][\w]*|styles\[`/.test(nextSource);

    if (nextSource !== source) {
      fileReports.push({
        file: path.relative(uiRoot, filePath),
        appliedCount: applied.length,
        missing,
        remainingStyles,
      });

      if (writeMode) {
        fs.writeFileSync(filePath, nextSource, 'utf8');
      }
    }
  }

  const payload = {
    mode: writeMode ? 'write' : 'dry-run',
    mappedClasses: classMap.size,
    usedClasses: usedClasses.size,
    missingMappings,
    fileReports,
  };

  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printHeader(`YOLO inline Tailwind (${writeMode ? 'WRITE' : 'DRY RUN'})`);
  console.log(
    `Mapped ${classMap.size} CSS classes | Used in JSX: ${usedClasses.size} | Unmapped: ${missingMappings.length}`,
  );
  console.log(`Files touched: ${fileReports.length}/${targetFiles.length}`);
  console.log('');

  for (const report of fileReports) {
    console.log(`${report.file} (${report.appliedCount} classes${report.remainingStyles ? ', styles left' : ''})`);
    if (report.missing.length > 0) {
      console.log(`  unmapped: ${report.missing.join(', ')}`);
    }
  }

  if (missingMappings.length > 0) {
    console.log('');
    console.log(`Still unmapped: ${missingMappings.join(', ')}`);
  }

  if (dryRun) {
    console.log('');
    console.log('No files written. Re-run with --write');
  }
}

main();
