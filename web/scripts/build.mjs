import { execSync } from 'node:child_process'

import './webcrypto.cjs'

execSync('tsc -b', { stdio: 'inherit' })

const { build } = await import('vite')
await build()
