export type BatchKey = 'A' | 'B'

export type Metric = 'euclid' | 'manhattan' | 'chebyshev'

export type RangePolicy = 'exclude' | 'expand'

export type RecordStatus =
  | 'included'
  | 'out-of-range'
  | 'missing'
  | 'invalid-weight'
  | 'invalid-unit'
  | 'invalid-batch'
  | 'duplicate-id'

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'um'

export interface ScenarioBatch {
  key: string
  label: string
}

export interface ScenarioRange {
  lengthMin: number
  lengthMax: number
  widthMin: number
  widthMax: number
}

export interface Scenario {
  id: string
  title: string
  tagline: string
  file: string
  range: ScenarioRange
  batches: ScenarioBatch[]
  notes: string[]
  checks?: Record<string, unknown>
}

export interface ScenarioManifest {
  version: number
  generatedBy: string
  rangeUnit: string
  scenarios: Scenario[]
}

export interface ProcessedRecord {
  line: number
  id: string
  batch: string
  batchKey: BatchKey | null
  lengthRaw: string
  widthRaw: string
  lengthUnitRaw: string
  widthUnitRaw: string
  weightRaw: string
  note: string
  /** Aligned to millimetres; kept for excluded records too (never clamped). */
  lengthMm: number | null
  widthMm: number | null
  weight: number | null
  lengthFactor: number | null
  widthFactor: number | null
  outsideNominal: boolean
  status: RecordStatus
  reason: string
  /** Normalised share of its batch's effective weight (included records only). */
  share: number | null
  cell: CellRef | null
}

export interface CellRef {
  ix: number
  iy: number
}

export interface GridDomain {
  lengthMin: number
  lengthMax: number
  widthMin: number
  widthMax: number
  /** True when the domain actually extends past the nominal inspection range. */
  expanded: boolean
}

export interface CellBounds {
  ix: number
  iy: number
  lengthMin: number
  lengthMax: number
  widthMin: number
  widthMax: number
  centerLength: number
  centerWidth: number
}

export interface AxisScale {
  /** Millimetres represented by one analysis distance unit on each axis. */
  lengthMmPerUnit: number
  widthMmPerUnit: number
}

export interface WeightedStats {
  count: number
  weight: number
  meanLength: number
  meanWidth: number
  sdLength: number
  sdWidth: number
  corr: number
}

export interface UnitGroup {
  batch: BatchKey
  key: string
  count: number
  included: number
  factor: string
}

export interface SpecialGroup {
  status: RecordStatus
  count: number
  weight: number
  records: ProcessedRecord[]
}

export interface ScenarioCheck {
  id: string
  label: string
  expected: string
  observed: string
  pass: boolean
  tone: 'good' | 'warn' | 'info'
}

export interface AnalysisConfig {
  rangePolicy: RangePolicy
  gridResolution: number
  metric: Metric
  axisScale: AxisScale
}
