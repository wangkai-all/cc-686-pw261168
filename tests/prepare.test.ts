import { describe, expect, it } from 'vitest'
import { parseCsv, toRecordRows } from '../src/lib/csv'
import { classifyRecords } from '../src/lib/prepare'
import { runAnalysis } from '../src/lib/analysis'
import type { Scenario } from '../src/lib/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const scenario: Scenario = {
  id: 'test',
  title: 'test',
  tagline: '',
  file: '',
  range: { lengthMin: 100, lengthMax: 160, widthMin: 58, widthMax: 112 },
  batches: [
    { key: 'A', label: 'A' },
    { key: 'B', label: 'B' },
  ],
  notes: [],
}

function rows(csvText: string) {
  return toRecordRows(parseCsv(csvText))
}

const header = 'id,batch,length,width,length_unit,width_unit,weight,note\n'

describe('CSV ingestion', () => {
  it('parses quoted notes containing commas and CRLF line endings', () => {
    const csv = header.replace('\\n', '\r\n') + 'X1,A,120,80,mm,mm,1.5,"n, with comma"\r\n'
    const parsed = parseCsv(csv)
    expect(parsed.rows).toHaveLength(1)
    const records = toRecordRows(parsed)
    expect(records[0].note).toBe('n, with comma')
    expect(records[0].lengthRaw).toBe('120')
  })

  it('rejects a CSV without required columns', () => {
    expect(() => toRecordRows(parseCsv('id,batch,length\\nX,A,1\\n'))).toThrow(/width/)
  })
})

describe('unit alignment', () => {
  it('converts cm, inches and micrometres to millimetres', () => {
    const text =
      header +
      'X1,A,12,8,cm,cm,1,\n' +
      'X2,A,1,0.5,in,in,1,\n' +
      'X3,A,120000,80000,um,um,1,\n'
    const out = classifyRecords(rows(text), ['A', 'B'], scenario.range, 'exclude', 10)
    const [a, b, c] = out.records
    expect(a.lengthMm).toBeCloseTo(120, 9)
    expect(a.widthMm).toBeCloseTo(80, 9)
    expect(b.lengthMm).toBeCloseTo(25.4, 9)
    expect(c.lengthMm).toBeCloseTo(120, 9)
    // 1 inch = 25.4 mm is inside the nominal range?  no (length 25.4 < 100)
    expect(b.status).toBe('out-of-range')
  })

  it('aligns each axis independently when units are mixed', () => {
    const text = header + 'X1,B,12,80,cm,mm,1,\n'
    const out = classifyRecords(rows(text), ['A', 'B'], scenario.range, 'exclude', 10)
    const r = out.records[0]
    expect(r.lengthMm).toBeCloseTo(120, 9)
    expect(r.widthMm).toBeCloseTo(80, 9)
    expect(r.status).toBe('included')
    expect(r.lengthFactor).toBe(10)
    expect(r.widthFactor).toBe(1)
  })

  it('flags an unrecognised unit instead of guessing', () => {
    const text = header + 'X1,A,120,80,furlong,furlong,1,\n'
    const out = classifyRecords(rows(text), ['A', 'B'], scenario.range, 'exclude', 10)
    expect(out.records[0].status).toBe('invalid-unit')
  })
})

describe('special records', () => {
  it('keeps missing coordinates out of the grid and reports them separately', () => {
    const text =
      header +
      'X1,A,120,80,mm,mm,1,\n' +
      'X2,A,,80,mm,mm,2,missing length\n' +
      'X3,B,121,81,mm,mm,1,\n'
    const out = classifyRecords(rows(text), ['A', 'B'], scenario.range, 'exclude', 10)
    const missing = out.records.find((r) => r.id === 'X2')!
    expect(missing.status).toBe('missing')
    expect(missing.cell).toBeNull()
    expect(missing.lengthMm).toBeNull()
    // weight excluded from the batch normalisation
    expect(out.effectiveWeight.A).toBeCloseTo(1, 9)
    expect(out.rawWeightTotal.A).toBeCloseTo(1, 9)
  })

  it('rejects non-positive weights and duplicate ids', () => {
    const text =
      header +
      'X1,A,120,80,mm,mm,1,\n' +
      'X2,A,121,81,mm,mm,0,\n' +
      'X3,A,122,82,mm,mm,-2,\n' +
      'X1,A,123,83,mm,mm,1,\n'
    const out = classifyRecords(rows(text), ['A', 'B'], scenario.range, 'exclude', 10)
    expect(out.records.find((r) => r.line === 3)!.status).toBe('invalid-weight')
    expect(out.records.find((r) => r.line === 4)!.status).toBe('invalid-weight')
    expect(out.records.filter((r) => r.id === 'X1').every((r) => r.status === 'duplicate-id')).toBe(true)
  })
})

describe('range policy', () => {
  const text =
    header +
    'A1,A,120,80,mm,mm,1,\n' +
    'A2,A,205,80,mm,mm,3,outlier\n' +
    'B1,B,121,81,mm,mm,1,\n'

  it('excludes out-of-range samples without clamping and reports count and weight', () => {
    const out = classifyRecords(rows(text), ['A', 'B'], scenario.range, 'exclude', 10)
    const outlier = out.records.find((r) => r.id === 'A2')!
    expect(outlier.status).toBe('out-of-range')
    // real coordinate preserved
    expect(outlier.lengthMm).toBe(205)
    expect(outlier.cell).toBeNull()
    expect(out.domain.lengthMax).toBe(160)
    expect(out.effectiveWeight.A).toBeCloseTo(1, 9)
  })

  it('expands the grid to cover outliers without clamping, keeping cell size', () => {
    const out = classifyRecords(rows(text), ['A', 'B'], scenario.range, 'expand', 10)
    const outlier = out.records.find((r) => r.id === 'A2')!
    expect(outlier.status).toBe('included')
    expect(outlier.lengthMm).toBe(205)
    expect(out.domain.lengthMax).toBeGreaterThanOrEqual(205)
    expect(out.domain.expanded).toBe(true)
    // nominal span 60 mm / 10 cells = 6 mm per cell; expansion adds 8 cells right
    expect(out.countX).toBe(18)
    const step = (out.domain.lengthMax - out.domain.lengthMin) / out.countX
    expect(step).toBeCloseTo(6, 9)
    expect(outlier.cell!.ix).toBe(out.countX - 1)
  })

  it('normalises each batch by its own effective weight', () => {
    const text =
      header +
      'A1,A,120,80,mm,mm,1,\n' +
      'A2,A,130,90,mm,mm,3,\n' +
      'B1,B,120,80,mm,mm,10,\n' +
      'B2,B,140,100,mm,mm,10,\n' +
      'B3,B,150,105,mm,mm,20,\n'
    const out = classifyRecords(rows(text), ['A', 'B'], scenario.range, 'exclude', 10)
    const sumA = out.records.filter((r) => r.batchKey === 'A').reduce((s, r) => s + (r.share ?? 0), 0)
    const sumB = out.records.filter((r) => r.batchKey === 'B').reduce((s, r) => s + (r.share ?? 0), 0)
    expect(sumA).toBeCloseTo(1, 12)
    expect(sumB).toBeCloseTo(1, 12)
    expect(out.records.find((r) => r.id === 'A1')!.share).toBeCloseTo(0.25, 12)
    expect(out.records.find((r) => r.id === 'B1')!.share).toBeCloseTo(0.25, 12)
  })
})

describe('scenario fixtures', () => {
  const load = (name: string) => {
    const text = readFileSync(resolve(__dirname, `../public/data/${name}.csv`), 'utf8')
    return toRecordRows(parseCsv(text))
  }
  const manifest = JSON.parse(
    readFileSync(resolve(__dirname, '../public/data/scenarios.json'), 'utf8'),
  )

  it('bimodal scenario really has equal weighted means but different shapes', () => {
    const sc = manifest.scenarios.find((s: Scenario) => s.id === 'bimodal')
    const result = runAnalysis(load('bimodal'), sc, {
      rangePolicy: 'exclude',
      gridResolution: 12,
      metric: 'euclid',
      axisScale: { lengthMmPerUnit: 1, widthMmPerUnit: 1 },
    })
    expect(result.stats.A!.meanLength).toBeCloseTo(130, 2)
    expect(result.stats.A!.meanWidth).toBeCloseTo(90, 2)
    expect(result.stats.B!.meanLength).toBeCloseTo(130, 2)
    expect(result.stats.B!.meanWidth).toBeCloseTo(90, 2)
    // shapes differ, so transport cost must be clearly positive
    expect(result.A2B.totalCost).toBeGreaterThan(5)
    expect(result.A2B.checks.optimality).toBe(true)
  })

  it('offset scenario preserves outliers, missing rows and zero weights', () => {
    const sc = manifest.scenarios.find((s: Scenario) => s.id === 'offset')
    const result = runAnalysis(load('offset'), sc, {
      rangePolicy: 'exclude',
      gridResolution: 12,
      metric: 'euclid',
      axisScale: { lengthMmPerUnit: 1, widthMmPerUnit: 1 },
    })
    expect(result.records.find((r) => r.id === 'OFF-A-045')!.status).toBe('out-of-range')
    expect(result.records.find((r) => r.id === 'OFF-B-045')!.status).toBe('out-of-range')
    expect(result.records.find((r) => r.id === 'OFF-A-046')!.status).toBe('missing')
    expect(result.records.find((r) => r.id === 'OFF-B-046')!.status).toBe('missing')
    expect(result.records.find((r) => r.id === 'OFF-A-047')!.status).toBe('invalid-weight')
    for (const key of ['A2B', 'B2A'] as const) {
      const t = result[key]
      expect(t.checks.optimality).toBe(true)
      expect(t.checks.rowBalanceError).toBeLessThan(1e-9)
      expect(t.checks.colBalanceError).toBeLessThan(1e-9)
      expect(t.checks.costAgreement).toBeLessThan(1e-9)
    }
  })
})
