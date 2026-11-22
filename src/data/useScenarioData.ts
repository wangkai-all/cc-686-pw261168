import { useEffect, useState } from 'react'
import type { Scenario, ScenarioManifest } from '../lib/types'
import { parseCsv, toRecordRows, type CsvRecordRow } from '../lib/csv'

export interface ScenarioData {
  scenario: Scenario
  rows: CsvRecordRow[]
  rawCsv: string
}

export type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; manifest: ScenarioManifest; data: Record<string, ScenarioData> }

/** Load every local scenario CSV once; they are small (< 10 KB each). */
export function useScenarioData(): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    ;(async () => {
      try {
        const res = await fetch('data/scenarios.json', { signal: controller.signal })
        if (!res.ok) throw new Error(`清单读取失败（HTTP ${res.status}）`)
        const manifest = (await res.json()) as ScenarioManifest
        const entries = await Promise.all(
          manifest.scenarios.map(async (scenario) => {
            const csvRes = await fetch(`data/${scenario.file}`, { signal: controller.signal })
            if (!csvRes.ok) throw new Error(`${scenario.file} 读取失败（HTTP ${csvRes.status}）`)
            const rawCsv = await csvRes.text()
            const rows = toRecordRows(parseCsv(rawCsv))
            return [scenario.id, { scenario, rows, rawCsv }] as const
          }),
        )
        if (cancelled) return
        setState({ status: 'ready', manifest, data: Object.fromEntries(entries) })
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  return state
}
