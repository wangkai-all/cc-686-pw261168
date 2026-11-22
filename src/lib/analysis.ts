import { classifyRecords } from './prepare'
import { solveTransport } from './transport'
import type { TransportCell, TransportResult } from './transport'
import { weightedStats } from './stats'
import type { CsvRecordRow } from './csv'
import type {
  AnalysisConfig,
  BatchKey,
  CellBounds,
  GridDomain,
  ProcessedRecord,
  RecordStatus,
  Scenario,
  SpecialGroup,
  UnitGroup,
  WeightedStats,
} from './types'
import { MM_PER_UNIT, UNIT_LABEL } from './units'
import type { LengthUnit } from './types'

export type Direction = 'A2B' | 'B2A'

export interface DensityCell {
  cell: CellBounds
  massA: number
  massB: number
  countA: number
  countB: number
}

export interface AnalysisResult {
  scenario: Scenario
  config: AnalysisConfig
  records: ProcessedRecord[]
  domain: GridDomain
  cells: CellBounds[]
  countX: number
  countY: number
  density: DensityCell[]
  stats: Record<BatchKey, WeightedStats | null>
  meanDiff: { length: number; width: number; inAnalysisUnits: { length: number; width: number } } | null
  A2B: TransportResult
  B2A: TransportResult
  specialGroups: Array<SpecialGroup & { batch: BatchKey | 'unknown' }>
  unitGroups: UnitGroup[]
  effectiveWeight: Record<BatchKey, number>
  rawWeightTotal: Record<BatchKey, number>
  report: {
    included: Record<BatchKey, number>
    excluded: Record<BatchKey, number>
    missing: Record<BatchKey, number>
    invalid: number
    outOfRangeWeight: Record<BatchKey, number>
  }
  analysisMs: number
}

export function runAnalysis(
  rows: CsvRecordRow[],
  scenario: Scenario,
  config: AnalysisConfig,
): AnalysisResult {
  const started = performance.now()
  const batchKeys = scenario.batches.map((b) => b.key)
  const prepared = classifyRecords(
    rows,
    batchKeys,
    scenario.range,
    config.rangePolicy,
    config.gridResolution,
  )
  const { records, domain, cells, countX, countY } = prepared

  const byBatch = (key: BatchKey) =>
    records.filter((r) => r.batchKey === key && r.status === 'included')

  const stats: Record<BatchKey, WeightedStats | null> = {
    A: weightedStats(byBatch('A')),
    B: weightedStats(byBatch('B')),
  }

  const index = new Map<string, DensityCell>()
  for (const cell of cells) {
    index.set(`${cell.ix},${cell.iy}`, {
      cell,
      massA: 0,
      massB: 0,
      countA: 0,
      countB: 0,
    })
  }
  for (const rec of records) {
    if (rec.status !== 'included' || !rec.cell || rec.share === null || rec.batchKey === null) {
      continue
    }
    const entry = index.get(`${rec.cell.ix},${rec.cell.iy}`)
    if (!entry) continue
    if (rec.batchKey === 'A') {
      entry.massA += rec.share
      entry.countA += 1
    } else {
      entry.massB += rec.share
      entry.countB += 1
    }
  }
  const density = [...index.values()]

  const toTransportCells = (key: BatchKey): TransportCell[] =>
    density
      .filter((c) => (key === 'A' ? c.massA : c.massB) > 0)
      .map((c) => ({
        ix: c.cell.ix,
        iy: c.cell.iy,
        centerLength: c.cell.centerLength,
        centerWidth: c.cell.centerWidth,
        mass: key === 'A' ? c.massA : c.massB,
        recordCount: key === 'A' ? c.countA : c.countB,
      }))

  const A2B = solveTransport(toTransportCells('A'), toTransportCells('B'), config.axisScale, config.metric)
  const B2A = solveTransport(toTransportCells('B'), toTransportCells('A'), config.axisScale, config.metric)

  const meanDiff =
    stats.A && stats.B
      ? {
          length: stats.A.meanLength - stats.B.meanLength,
          width: stats.A.meanWidth - stats.B.meanWidth,
          inAnalysisUnits: {
            length: (stats.A.meanLength - stats.B.meanLength) / config.axisScale.lengthMmPerUnit,
            width: (stats.A.meanWidth - stats.B.meanWidth) / config.axisScale.widthMmPerUnit,
          },
        }
      : null

  const specialGroups = buildSpecialGroups(records)
  const unitGroups = buildUnitGroups(records, batchKeys)
  const report = buildReport(records)

  return {
    scenario,
    config,
    records,
    domain,
    cells,
    countX,
    countY,
    density,
    stats,
    meanDiff,
    A2B,
    B2A,
    specialGroups,
    unitGroups,
    effectiveWeight: prepared.effectiveWeight,
    rawWeightTotal: prepared.rawWeightTotal,
    report,
    analysisMs: performance.now() - started,
  }
}

function buildSpecialGroups(records: ProcessedRecord[]) {
  const map = new Map<string, SpecialGroup & { batch: BatchKey | 'unknown' }>()
  for (const rec of records) {
    if (rec.status === 'included') continue
    const batch: BatchKey | 'unknown' =
      rec.batchKey ?? (rec.status === 'invalid-batch' ? 'unknown' : 'unknown')
    const key = `${rec.status}|${batch}`
    let group = map.get(key)
    if (!group) {
      group = {
        status: rec.status,
        batch,
        count: 0,
        weight: 0,
        records: [],
      }
      map.set(key, group)
    }
    group.count += 1
    if (rec.weight !== null && rec.weight > 0) group.weight += rec.weight
    group.records.push(rec)
  }
  return [...map.values()].sort(
    (a, b) => a.batch.localeCompare(b.batch) || statusOrder(a.status) - statusOrder(b.status),
  )
}

function statusOrder(status: RecordStatus): number {
  switch (status) {
    case 'out-of-range':
      return 0
    case 'missing':
      return 1
    case 'invalid-weight':
      return 2
    case 'invalid-unit':
      return 3
    case 'duplicate-id':
      return 4
    case 'invalid-batch':
      return 5
    default:
      return 6
  }
}

function buildUnitGroups(records: ProcessedRecord[], batchKeys: string[]): UnitGroup[] {
  const out: UnitGroup[] = []
  for (const key of batchKeys.slice(0, 2)) {
    const batch: BatchKey = key === batchKeys[0] ? 'A' : 'B'
    const groups = new Map<string, { count: number; included: number; lengthUnit: LengthUnit; widthUnit: LengthUnit }>()
    for (const rec of records) {
      if (rec.batchKey !== batch) continue
      const lu = rec.lengthFactor === null ? null : rec.lengthUnitRaw.trim().toLowerCase()
      const wu = rec.widthFactor === null ? null : rec.widthUnitRaw.trim().toLowerCase()
      const label = `${lu ?? '?'} / ${wu ?? '?'}`
      let g = groups.get(label)
      if (!g) {
        g = {
          count: 0,
          included: 0,
          lengthUnit: inferUnit(rec.lengthFactor),
          widthUnit: inferUnit(rec.widthFactor),
        }
        groups.set(label, g)
      }
      g.count += 1
      if (rec.status === 'included') g.included += 1
    }
    for (const [label, g] of groups) {
      const [luRaw, wuRaw] = label.split(' / ')
      void luRaw
      void wuRaw
      out.push({
        batch,
        key: label,
        count: g.count,
        included: g.included,
        factor: `长 ${fmtFactor(g.lengthUnit)} · 宽 ${fmtFactor(g.widthUnit)}`,
      })
    }
  }
  return out.sort((a, b) => a.batch.localeCompare(b.batch) || a.key.localeCompare(b.key))
}

function inferUnit(factor: number | null): LengthUnit {
  if (factor === null) return 'mm'
  let best: LengthUnit = 'mm'
  let bestDiff = Number.POSITIVE_INFINITY
  for (const [unit, value] of Object.entries(MM_PER_UNIT) as Array<[LengthUnit, number]>) {
    const diff = Math.abs(value - factor)
    if (diff < bestDiff) {
      bestDiff = diff
      best = unit
    }
  }
  return best
}

function fmtFactor(unit: LengthUnit): string {
  const v = MM_PER_UNIT[unit]
  if (unit === 'mm') return 'mm'
  return `${UNIT_LABEL[unit]} × ${v.toLocaleString('zh-CN')} → mm`
}

function buildReport(records: ProcessedRecord[]) {
  const report: AnalysisResult['report'] = {
    included: { A: 0, B: 0 },
    excluded: { A: 0, B: 0 },
    missing: { A: 0, B: 0 },
    invalid: 0,
    outOfRangeWeight: { A: 0, B: 0 },
  }
  for (const rec of records) {
    if (rec.status === 'included' && rec.batchKey) report.included[rec.batchKey] += 1
    else if (rec.status === 'out-of-range' && rec.batchKey) {
      report.excluded[rec.batchKey] += 1
      report.outOfRangeWeight[rec.batchKey] += rec.weight ?? 0
    } else if (rec.status === 'missing' && rec.batchKey) report.missing[rec.batchKey] += 1
    else report.invalid += 1
  }
  return report
}
