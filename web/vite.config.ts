import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { deriveTaskPulseState } from './src/lib/taskPulse'

const MESSAGE_STATE_PATH = '/Users/tristdrum/.openclaw/workspace/tmp/message-watch/state.json'
const UNRESOLVED_PATH = '/Users/tristdrum/.openclaw/workspace/tmp/message-watch/unresolved.json'
const WORKER_RUNS_PATH = '/Users/tristdrum/.openclaw/workspace/tmp/worker-runs.jsonl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), taskPulseApiPlugin()],
})

function taskPulseApiPlugin(): Plugin {
  return {
    name: 'task-pulse-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost')
        if (requestUrl.pathname !== '/api/task-pulse/state') {
          next()
          return
        }

        if (req.method && req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }

        const thresholdQuery = requestUrl.searchParams.get('threshold')
        const threshold = thresholdQuery === null ? undefined : parseThreshold(thresholdQuery)

        try {
          const [stateData, unresolvedData, workerRuns] = await Promise.all([
            readJsonFile(MESSAGE_STATE_PATH),
            readJsonFile(UNRESOLVED_PATH),
            readJsonLinesFile(WORKER_RUNS_PATH),
          ])

          const payload = deriveTaskPulseState({
            stateData,
            unresolvedData,
            workerRuns,
            deadThresholdMinutes: threshold,
          })

          sendJson(res, 200, payload)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown server error'
          sendJson(res, 500, {
            error: 'Failed to load task pulse state',
            details: message,
          })
        }
      })
    },
  }
}

function parseThreshold(input: string): number | undefined {
  const numeric = Number(input)
  if (!Number.isFinite(numeric)) {
    return undefined
  }

  return Math.max(1, Math.floor(numeric))
}

function sendJson(res: ServerResponse<IncomingMessage>, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    const content = await readFile(path, 'utf8')
    return JSON.parse(content) as unknown
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    if (error instanceof SyntaxError) {
      return null
    }

    throw error
  }
}

async function readJsonLinesFile(path: string): Promise<unknown[]> {
  try {
    const content = await readFile(path, 'utf8')
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          return null
        }
      })
      .filter((entry): entry is unknown => entry !== null)
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
  }
}

function isMissingFileError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  return 'code' in error && (error as { code?: string }).code === 'ENOENT'
}
