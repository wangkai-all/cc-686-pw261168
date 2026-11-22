import { parseNumber, parseUnit } from './units'
import type {
  BatchKey,
  CellBounds,
  GridDomain,
  LengthUnit,
  ProcessedRecord,
  RangePolicy,
  RecordStatus,
  ScenarioRange,
} from './types'
import type { CsvRecordRow } from './csv'

export interface PrepareOptions {
  rows: CsvRecordRow[]
  batchKeys: string[]
  range: ScenarioRange
  rangePolicy: RangePolicy
  resolution: number
}

export interface ClassifiedRecords {
  records: ProcessedRecord[]
  domain: GridDomain
  cells: CellBounds[]
  countX: number
  countY: number
  /** Sum of weights of records actually routed into the grid, per batch. */
  effectiveWeight: Record<BatchKey, number>
  /** Sum of finite positive weights among recognised records, per batch. */
  rawWeightTotal: Record<BatchKey, number>
}

const STATUS_LABEL: Record<RecordStatus, string> = {
  included: '纳入运输',
  'out-of-range': '超程排除',
  missing: '缺测',
  'invalid-weight': '权重无效',
  'invalid-unit': '单位无效',
  'invalid-batch': '批次未知',
  'duplicate-id': '编号冲突',
}

export function statusLabel(status: RecordStatus): string {
  return STATUS_LABEL[status]
}

const MM_PER_UNIT: Record<LengthUnit, number> = {
  um: 0.001,
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
}

export function cellIndex(
  value: number,
  min: number,
  step: number,
  count: number,
): number {
  const raw = Math.floor((value - min) / step)
  return Math.min(count - 1, Math.max(0, raw))
}

export function buildCells(
  domain: GridDomain,
  countX: number,
  countY: number,
): CellBounds[] {
  const cells: CellBounds[] = []
  const stepX = (domain.lengthMax - domain.lengthMin) / countX
  const stepY = (domain.widthMax - domain.widthMin) / countY
  for (let iy = 0; iy < countY; iy++) {
    for (let ix = 0; ix < countX; ix++) {
      const lengthMin = domain.lengthMin + ix * stepX
      const widthMin = domain.widthMin + iy * stepY
      cells.push({
        ix,
        iy,
        lengthMin,
        lengthMax: lengthMin + stepX,
        widthMin,
        widthMax: widthMin + stepY,
        centerLength: lengthMin + stepX / 2,
        centerWidth: widthMin + stepY / 2,
      })
    }
  }
  return cells
}

/**
 * Decide the transport domain and the number of cells per axis.
 *
 * The nominal range always maps to `resolution` cells per axis, which fixes
 * the analysis cell size. In `exclude` mode the domain is exactly the nominal
 * range and out-of-range samples are dropped, never clamped. In `expand` mode
 * the domain grows to cover every present coordinate, snapped outward to whole
 * cells of that same size — the grid gains rows/columns instead of silently
 * coarsening, so the bin width (and therefore transport geometry) stays
 * comparable between the two policies.
 */
export function computeDomain(
  points: Array<{ length: number; width: number }>,
  range: ScenarioRange,
  policy: RangePolicy,
  resolution: number,
): { domain: GridDomain; countX: number; countY: number } {
  const stepX = (range.lengthMax - range.lengthMin) / resolution
  const stepY = (range.widthMax - range.widthMin) / resolution
  if (policy === 'exclude' || points.length === 0) {
    return {
      domain: { ...range, expanded: false },
      countX: resolution,
      countY: resolution,
    }
  }
  let lengthMin = range.lengthMin
  let lengthMax = range.lengthMax
  let widthMin = range.widthMin
  let widthMax = range.widthMax
  for (const p of points) {
    lengthMin = Math.min(lengthMin, p.length)
    lengthMax = Math.max(lengthMax, p.length)
    widthMin = Math.min(widthMin, p.width)
    widthMax = Math.max(widthMax, p.width)
  }
  const cellsBelowX = Math.ceil((range.lengthMin - lengthMin) / stepX - 1e-9)
  const cellsAboveX = Math.ceil((lengthMax - range.lengthMax) / stepX - 1e-9)
  const cellsBelowY = Math.ceil((range.widthMin - widthMin) / stepY - 1e-9)
  const cellsAboveY = Math.ceil((widthMax - range.widthMax) / stepY - 1e-9)
  const countX = resolution + Math.max(0, cellsBelowX) + Math.max(0, cellsAboveX)
  const countY = resolution + Math.max(0, cellsBelowY) + Math.max(0, cellsAboveY)
  const domainXMin = range.lengthMin - Math.max(0, cellsBelowX) * stepX
  const domainXMax = range.lengthMax + Math.max(0, cellsAboveX) * stepX
  const domainYMin = range.widthMin - Math.max(0, cellsBelowY) * stepY
  const domainYMax = range.widthMax + Math.max(0, cellsAboveY) * stepY
  const expanded =
    Math.abs(domainXMin - range.lengthMin) > 1e-9 ||
    Math.abs(domainXMax - range.lengthMax) > 1e-9 ||
    Math.abs(domainYMin - range.widthMin) > 1e-9 ||
    Math.abs(domainYMax - range.widthMax) > 1e-9
  return {
    domain: {
      lengthMin: domainXMin,
      lengthMax: domainXMax,
      widthMin: domainYMin,
      widthMax: domainYMax,
      expanded,
    },
    countX,
    countY,
  }
}

export function classifyRecords(
  rows: CsvRecordRow[],
  batchKeys: string[],
  range: ScenarioRange,
  policy: RangePolicy,
  resolution: number,
): ClassifiedRecords {
  const idCount = new Map<string, number>()
  for (const row of rows) idCount.set(row.id, (idCount.get(row.id) ?? 0) + 1)

  const batchOf = (key: string): BatchKey | null => {
    if (batchKeys.length >= 2) {
      if (key === batchKeys[0]) return 'A'
      if (key === batchKeys[1]) return 'B'
      return null
    }
    return key === batchKeys[0] ? 'A' : null
  }

  const records: ProcessedRecord[] = rows.map((row) => {
    const lengthUnit = parseUnit(row.lengthUnitRaw)
    const widthUnit = parseUnit(row.widthUnitRaw)
    const lengthValue = parseNumber(row.lengthRaw)
    const widthValue = parseNumber(row.widthRaw)
    const weightValue = parseNumber(row.weightRaw)
    const batchKey = batchOf(row.batch)

    let status: RecordStatus = 'included'
    let reason = ''

    if (row.id === '') {
      status = 'duplicate-id'
      reason = '编号为空，无法追溯'
    } else if (batchKey === null) {
      status = 'invalid-batch'
      reason = `批次「${row.batch || '空'}」不在当前比较的两批中`
    } else if (lengthValue === null || widthValue === null) {
      status = 'missing'
      reason =
        lengthValue === null && widthValue === null
          ? '长与宽均缺失'
          : lengthValue === null
            ? '长度缺失'
            : '宽度缺失'
    } else if (lengthUnit === null || widthUnit === null) {
      status = 'invalid-unit'
      reason = `无法识别单位「${lengthUnit === null ? row.lengthUnitRaw : row.widthUnitRaw}」`
    } else if (weightValue === null || weightValue <= 0) {
      status = 'invalid-weight'
      reason = weightValue === null ? '权重无法解析' : '权重必须大于 0'
    } else if ((idCount.get(row.id) ?? 0) > 1) {
      status = 'duplicate-id'
      reason = '编号重复，需人工确认归属'
    }

    const lengthFactor = lengthUnit ? MM_PER_UNIT[lengthUnit] : null
    const widthFactor = widthUnit ? MM_PER_UNIT[widthUnit] : null
    // Align to millimetres whenever readable — excluded records keep their real
    // coordinates for audit, and are never pushed to a boundary.
    const lengthMm = lengthValue !== null && lengthFactor !== null ? lengthValue * lengthFactor : null
    const widthMm = widthValue !== null && widthFactor !== null ? widthValue * widthFactor : null
    const outsideNominal =
      lengthMm !== null &&
      widthMm !== null &&
      (lengthMm < range.lengthMin ||
        lengthMm > range.lengthMax ||
        widthMm < range.widthMin ||
        widthMm > range.widthMax)

    return {
      line: row.line,
      id: row.id,
      batch: row.batch,
      batchKey,
      lengthRaw: row.lengthRaw,
      widthRaw: row.widthRaw,
      lengthUnitRaw: row.lengthUnitRaw,
      widthUnitRaw: row.widthUnitRaw,
      weightRaw: row.weightRaw,
      note: row.note,
      lengthMm,
      widthMm,
      weight: weightValue,
      lengthFactor,
      widthFactor,
      outsideNominal,
      status,
      reason,
      share: null,
      cell: null,
    }
  })

  const located = records.filter(
    (r) => r.status === 'included' && r.lengthMm !== null && r.widthMm !== null,
  )

  if (policy === 'exclude') {
    for (const rec of located) {
      if (rec.outsideNominal) {
        rec.status = 'out-of-range'
        rec.reason = '坐标超出名义量程；当前策略为排除，不压到边界'
      }
    }
  }

  const routed = located.filter((r) => r.status === 'included')
  const { domain, countX, countY } = computeDomain(
    routed.map((r) => ({ length: r.lengthMm as number, width: r.widthMm as number })),
    range,
    policy,
    resolution,
  )
  const cells = buildCells(domain, countX, countY)
  const stepX = (domain.lengthMax - domain.lengthMin) / countX
  const stepY = (domain.widthMax - domain.widthMin) / countY

  const effectiveWeight: Record<BatchKey, number> = { A: 0, B: 0 }
  const rawWeightTotal: Record<BatchKey, number> = { A: 0, B: 0 }
  for (const rec of located) {
    if (rec.batchKey && rec.weight !== null && rec.weight > 0) {
      rawWeightTotal[rec.batchKey] += rec.weight
    }
  }
  for (const rec of routed) {
    const key = rec.batchKey as BatchKey
    effectiveWeight[key] += rec.weight as number
    rec.cell = {
      ix: cellIndex(rec.lengthMm as number, domain.lengthMin, stepX, countX),
      iy: cellIndex(rec.widthMm as number, domain.widthMin, stepY, countY),
    }
    rec.share = rec.weight as number
  }
  for (const rec of routed) {
    const key = rec.batchKey as BatchKey
    if (rec.share !== null && effectiveWeight[key] > 0) {
      rec.share = rec.share / effectiveWeight[key]
    }
  }

  return { records, domain, cells, countX, countY, effectiveWeight, rawWeightTotal }
}

export function cellKey(ix: number, iy: number): string {
  return `${ix},${iy}`
}
