import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const scanRoots = [path.join(uiRoot, 'components'), path.join(uiRoot, 'app')];

const sourceExtensions = new Set(['.tsx', '.ts', '.jsx', '.js']);

function fixVarBrackets(text) {
  let result = text;
  let changed = true;

  while (changed) {
    changed = false;
    result = result.replace(/\[var\((--[\w-]+)\)\]/g, (match, token) => {
      changed = true;
      return `(${token})`;
    });
  }

  changed = true;
  while (changed) {
    changed = false;
    result = result.replace(/\[var\((--[\w-]+,[^[\]]+)\)\]/g, (match, inner) => {
      changed = true;
      return `(${inner})`;
    });
  }

  return result;
}

const staticReplacements = [
  ['[overflow-wrap:anywhere]', 'wrap-anywhere'],
  ['border-b-[1px]', 'border-b'],
  ['border-[1px]', 'border'],
  ['font-[400]', 'font-normal'],
  ['font-[500]', 'font-medium'],
  ['rounded-[0]', 'rounded-none'],
  ['backdrop-blur-[16px]', 'backdrop-blur-lg'],
  ['duration-[180ms]', 'duration-180'],
  ['duration-[220ms]', 'duration-220'],
  ['duration-[240ms]', 'duration-240'],
  ['z-[2]', 'z-2'],
  ['z-[5]', 'z-5'],
  ['[inset:0]', 'inset-0'],
  ['[inset:0_auto_0_0]', 'inset-[0_auto_0_0]'],
  ['bg-[position:center]', 'bg-center'],
  ['bg-[length:contain]', 'bg-contain'],
  [
    'bg-[position:calc(100%-18px)_calc(50%+2px),calc(100%-12px)_calc(50%+2px)]',
    'bg-position-[calc(100%-18px)_calc(50%+2px),calc(100%-12px)_calc(50%+2px)]',
  ],
  ['bg-[length:6px_6px,6px_6px]', 'bg-size-[6px_6px,6px_6px]'],
  ['[&_.react-flow__edge-path]:[stroke-width:1.7]', '[&_.react-flow__edge-path]:stroke-[1.7]'],
];

function canonicalizeTailwindClasses(content) {
  let text = fixVarBrackets(content);

  for (const [from, to] of staticReplacements) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
    }
  }

  return text;
}

function walkSourceFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') {
        continue;
      }
      walkSourceFiles(absolutePath, files);
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

function main() {
  const files = scanRoots.flatMap((root) => walkSourceFiles(root));
  let changedFileCount = 0;

  for (const filePath of files) {
    const original = fs.readFileSync(filePath, 'utf8');
    const updated = canonicalizeTailwindClasses(original);

    if (updated === original) {
      continue;
    }

    changedFileCount += 1;
    fs.writeFileSync(filePath, updated);
    console.log(`updated ${path.relative(uiRoot, filePath)}`);
  }

  console.log(`done: ${changedFileCount} file(s) updated`);
}

main();
