import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STOCKFISH_URL =
  'https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1/stockfish-ubuntu-x86-64.tar';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptsDir, '..');
const outputPath = path.join(projectDir, 'bin', 'stockfish');
const outputDir = path.dirname(outputPath);
const browserStockfishDir = path.join(projectDir, 'public', 'stockfish');
const stockfishPackageBinDir = path.join(projectDir, 'node_modules', 'stockfish', 'bin');
const browserStockfishAssets = [
  'stockfish-18-single.js',
  'stockfish-18-single.wasm',
  'stockfish-18-lite-single.js',
  'stockfish-18-lite-single.wasm',
];
const shouldPrepare =
  process.env.NETLIFY === 'true' || process.env.VERCEL === '1' || process.env.PREPARE_STOCKFISH === 'true';

await prepareBrowserStockfishAssets();

if (!shouldPrepare) {
  console.log('Skipping Linux Stockfish binary preparation outside Netlify/Vercel.');
  process.exit(0);
}

if (await fileExists(outputPath)) {
  await chmod(outputPath, 0o755);
  console.log(`Stockfish binary already prepared at ${path.relative(projectDir, outputPath)}.`);
  process.exit(0);
}

const workDir = path.join(tmpdir(), `stockfish-${Date.now()}`);
const archivePath = path.join(workDir, 'stockfish.tar');
const extractDir = path.join(workDir, 'extract');

await mkdir(extractDir, { recursive: true });
await downloadFile(STOCKFISH_URL, archivePath);
await run('tar', ['-xf', archivePath, '-C', extractDir]);

const extractedBinary = await findStockfishBinary(extractDir);

if (!extractedBinary) {
  throw new Error('Stockfish archive did not contain the expected Linux binary.');
}

await mkdir(outputDir, { recursive: true });
await copyFile(extractedBinary, outputPath);
await chmod(outputPath, 0o755);
await copySiblingAssets(extractedBinary, outputDir);
await rm(workDir, { recursive: true, force: true });

console.log(`Prepared Stockfish Linux binary at ${path.relative(projectDir, outputPath)}.`);

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function prepareBrowserStockfishAssets() {
  await mkdir(browserStockfishDir, { recursive: true });

  for (const asset of browserStockfishAssets) {
    const source = path.join(stockfishPackageBinDir, asset);
    const destination = path.join(browserStockfishDir, asset);
    await copyFile(source, destination);
  }

  console.log(`Prepared browser Stockfish assets at ${path.relative(projectDir, browserStockfishDir)}.`);
}

function downloadFile(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location &&
        redirectsLeft > 0
      ) {
        response.resume();
        downloadFile(response.headers.location, destination, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download Stockfish: HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function findStockfishBinary(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const nested = await findStockfishBinary(entryPath);

      if (nested) {
        return nested;
      }
    }

    if (entry.isFile() && entry.name === 'stockfish-ubuntu-x86-64') {
      return entryPath;
    }
  }

  return null;
}

async function copySiblingAssets(binaryPath, destinationDir) {
  const sourceDir = path.dirname(binaryPath);
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.nnue')) {
      continue;
    }

    await copyFile(path.join(sourceDir, entry.name), path.join(destinationDir, entry.name));
  }
}
