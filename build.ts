#!/usr/bin/env bun

import { $ } from 'bun';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { resolve } from 'path';

interface BuildTarget {
  platform: string;
  arch: string;
  target: string;
  outfile: string;
}

const targets: BuildTarget[] = [
  { platform: 'linux', arch: 'x64', target: 'bun-linux-x64', outfile: 'flip-cc-linux-x64' },
  { platform: 'darwin', arch: 'x64', target: 'bun-darwin-x64', outfile: 'flip-cc-macos-x64' },
  { platform: 'darwin', arch: 'arm64', target: 'bun-darwin-arm64', outfile: 'flip-cc-macos-arm64' },
  { platform: 'win32', arch: 'x64', target: 'bun-windows-x64', outfile: 'flip-cc-windows-x64.exe' },
];

const distDir = resolve(import.meta.dir, 'dist');

// Ensure dist directory exists
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

console.log('Building flip-cc for multiple platforms...\n');

const results = new Map<string, boolean>();

for (const t of targets) {
  const outpath = resolve(distDir, t.outfile);
  console.log(`Building for ${t.platform}-${t.arch}...`);

  try {
    await $`bun build src/index.ts --compile --target=${t.target} --outfile=${outpath}`;
    console.log(`  ✓ ${t.outfile}`);
    results.set(`${t.platform}-${t.arch}`, true);
  } catch (error) {
    console.error(`  ✗ ${t.outfile} failed`);
    results.set(`${t.platform}-${t.arch}`, false);
  }
}

const hasError = [...results.values()].some((ok) => !ok);
console.log('\n' + (hasError ? 'Build completed with errors.' : 'All builds completed successfully!'));
console.log(`Output directory: ${distDir}`);

// Create platform-specific symlink/binary for current platform
const currentPlatform = process.platform;
const currentArch = process.arch;
const currentKey = `${currentPlatform}-${currentArch}`;

if (results.get(currentKey)) {
  const currentTarget = targets.find(
    (t) => t.platform === currentPlatform && t.arch === currentArch
  )!;

  const sourceFile = resolve(distDir, currentTarget.outfile);
  const isWindows = currentPlatform === 'win32';
  const destName = isWindows ? 'flip-cc.exe' : 'flip-cc';
  const destFile = resolve(distDir, destName);

  try {
    copyFileSync(sourceFile, destFile);
    if (!isWindows) {
      chmodSync(destFile, 0o755);
    }
    console.log(`\n✓ Created ${destName} for current platform (${currentPlatform}-${currentArch})`);
  } catch (error) {
    console.error(`\n✗ Failed to create ${destName}:`, error);
  }
} else if (!results.has(currentKey)) {
  console.log(`\nNote: No prebuilt binary for current platform (${currentPlatform}-${currentArch})`);
} else {
  console.log(`\nSkipping local binary — build for ${currentKey} failed.`);
}

if (hasError) {
  process.exit(1);
}
