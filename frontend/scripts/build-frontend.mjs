import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const sourceRoot = path.join(frontendRoot, 'src');
const distRoot = path.join(frontendRoot, 'dist');
const shouldWatch = process.argv.includes('--watch');

async function buildOnce() {
  await resetDistDirectory();

  for (const sourceFile of walkSourceFiles(sourceRoot)) {
    const relativePath = path.relative(sourceRoot, sourceFile);
    const extension = path.extname(sourceFile);
    const outputFile = path.join(distRoot, relativePath).replace(/\.(tsx|ts)$/, '.js');
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });

    const input = fs.readFileSync(sourceFile, 'utf8');
    const transpiled = ts.transpileModule(input, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
      fileName: sourceFile,
    });

    const outputText = rewriteRelativeImports(transpiled.outputText, extension);
    fs.writeFileSync(outputFile, outputText, 'utf8');
  }

  fs.copyFileSync(path.join(frontendRoot, 'index.html'), path.join(distRoot, 'index.html'));
  fs.copyFileSync(path.join(sourceRoot, 'styles.css'), path.join(distRoot, 'app.css'));
  console.log('Frontend build complete');
}

await buildOnce();

if (shouldWatch) {
  let timer = null;
  fs.watch(sourceRoot, { recursive: true }, () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      buildOnce().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    }, 100);
  });
  console.log('Watching frontend source files...');
}

function walkSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(absolutePath));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(absolutePath);
    }
  }

  return files;
}

function rewriteRelativeImports(sourceText, sourceExtension) {
  return sourceText.replace(/(from\s+['"])(\.\.?\/[^'"\n]+?)(['"])/g, (match, prefix, specifier, suffix) => {
    if (path.extname(specifier)) {
      return match;
    }

    if (sourceExtension === '.tsx' || sourceExtension === '.ts') {
      return `${prefix}${specifier}.js${suffix}`;
    }

    return match;
  });
}

async function resetDistDirectory() {
  fs.mkdirSync(distRoot, { recursive: true });
  const entries = fs.readdirSync(distRoot, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(distRoot, entry.name);
    await removePathWithRetries(absolutePath);
  }
}

async function removePathWithRetries(targetPath) {
  let attempt = 0;

  while (attempt < 8) {
    attempt += 1;
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isRetriableFsError(error) || attempt >= 8) {
        throw error;
      }
      await sleep(80 * attempt);
    }
  }
}

function isRetriableFsError(error) {
  return !!error && typeof error === 'object' && 'code' in error && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}