#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { __getTests, __resetTests } from '../index.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'run'

if (command !== 'run') {
  console.error(`Unsupported command: ${command}`)
  process.exit(1)
}

const rootDir = process.cwd()
const srcDir = path.join(rootDir, 'src')
const outDir = path.join(rootDir, '.vitest-tmp')
const testFiles = collectTestFiles(srcDir)

if (testFiles.length === 0) {
  console.log('No test files found.')
  process.exit(0)
}

rmSync(outDir, { recursive: true, force: true })

const tscPath = path.join(rootDir, 'node_modules', 'typescript', 'lib', 'tsc.js')
if (!existsSync(tscPath)) {
  console.error('typescript compiler not found in node_modules.')
  process.exit(1)
}

const compileResult = spawnSync(
  process.execPath,
  [
    tscPath,
    '--pretty',
    'false',
    '--module',
    'ESNext',
    '--target',
    'ES2022',
    '--moduleResolution',
    'bundler',
    '--esModuleInterop',
    '--skipLibCheck',
    '--rootDir',
    rootDir,
    '--outDir',
    outDir,
    ...testFiles,
  ],
  { stdio: 'inherit' },
)

if (compileResult.status !== 0) {
  process.exit(compileResult.status ?? 1)
}

const localVitestPackagePath = path.join(rootDir, 'node_modules', 'vitest')
if (!existsSync(localVitestPackagePath)) {
  console.error('vitest package is not installed in node_modules.')
  process.exit(1)
}

__resetTests()

for (const sourceFile of testFiles) {
  const builtFile = path.join(outDir, sourceFile).replace(/\.ts$/, '.js')
  await import(pathToFileURL(builtFile).href)
}

const tests = __getTests()
let passed = 0
let failed = 0

for (const test of tests) {
  try {
    await test.fn()
    passed += 1
    console.log(`\u2713 ${test.name}`)
  } catch (error) {
    failed += 1
    console.error(`\u2717 ${test.name}`)
    console.error(formatError(error))
  }
}

rmSync(outDir, { recursive: true, force: true })

if (failed > 0) {
  console.error(`\nFailed: ${failed}, Passed: ${passed}`)
  process.exit(1)
}

console.log(`\nPassed: ${passed}`)
process.exit(0)

function collectTestFiles(directory) {
  if (!existsSync(directory)) {
    return []
  }

  const entries = readdirSync(directory, { withFileTypes: true })
  const testFiles = []

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      testFiles.push(...collectTestFiles(absolutePath))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      testFiles.push(path.relative(rootDir, absolutePath))
    }
  }

  return testFiles.sort((a, b) => a.localeCompare(b))
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  return String(error)
}
