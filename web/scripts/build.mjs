import { execSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

import './webcrypto.cjs'

execSync('tsc -b', { stdio: 'inherit' })

const { build } = await import('vite')
await build()

// Public commit identifier lets a release verify the version served by the domain.
const commit =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(commit))
  throw new Error('A valid source commit is required for the release manifest')
await writeFile(
  new URL('../dist/version.json', import.meta.url),
  JSON.stringify({ commit }) + '\n',
)
