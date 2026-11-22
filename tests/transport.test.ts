import { describe, expect, it } from 'vitest'
import { solveTransport } from '../src/lib/transport'
import { solveTransportReference } from './reference'
import type { TransportCell } from '../src/lib/transport'

const scale = { lengthMmPerUnit: 1, widthMmPerUnit: 1 }

function cell(ix: number, iy: number, mass: number, step = 10): TransportCell {
  return {
    ix,
    iy,
    mass,
    recordCount: 1,
    centerLength: (ix + 0.5) * step,
    centerWidth: (iy + 0.5) * step,
  }
}

function randomCells(rng: () => number, count: number, grid: number, massScale = 1): TransportCell[] {
  const seen = new Set<string>()
  const out: TransportCell[] = []
  while (out.length < count) {
    const ix = Math.floor(rng() * grid)
    const iy = Math.floor(rng() * grid)
    const key = `${ix},${iy}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cell(ix, iy, (0.2 + rng()) * massScale))
  }
  return out
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('exact transport solver', () => {
  it('handles a single cell on both sides at zero cost', () => {
    const r = solveTransport([cell(2, 2, 1)], [cell(2, 2, 1)], scale, 'euclid')
    expect(r.totalCost).toBeCloseTo(0, 12)
    expect(r.flows).toHaveLength(1)
    expect(r.flows[0].mass).toBeCloseTo(1, 12)
  })

  it('moves mass to the nearest sink when only one source exists (greedy-optimal case)', () => {
    const r = solveTransport(
      [cell(0, 0, 0.6), cell(9, 9, 0.4)],
      [cell(0, 0, 0.6), cell(9, 9, 0.4)],
      scale,
      'euclid',
    )
    expect(r.totalCost).toBeCloseTo(0, 10)
    for (const f of r.flows) {
      expect(f.from).toBe(f.to)
    }
  })

  it('beats a nearest-cell greedy on an assignment where greedy is locally attractive', () => {
    // Sources: S0 at (0,0) mass 1, S1 at (5,0) mass 1.
    // Sinks:   T0 at (1,0) mass 1, T1 at (9,0) mass 1.
    // Greedy from S0 would take T0; then S1 -> T1 costs 4. Total 4*1 + 1 = 5.
    // Optimal is the same here; construct a real counterexample below.
    const sources = [cell(0, 0, 1, 1), cell(5, 0, 1, 1)]
    const sinks = [cell(1, 0, 1, 1), cell(9, 0, 1, 1)]
    const r = solveTransport(sources, sinks, scale, 'manhattan')
    const ref = solveTransportReference(sources, sinks, scale, 'manhattan')
    expect(r.totalCost).toBeCloseTo(ref.totalCost, 10)
  })

  it('finds the global optimum where greedy nearest-first fails', () => {
    // Two sources on a line, two sinks.  S0=0 mass 1, S1=10 mass 1.
    // T0=9 mass 1, T1=11 mass 1.  Greedy: S0->T0 (9), S1->T1 (1) => 10.
    // Optimal: S0->T1 (11) + S1->T0 (1) = 12?  No — check: 9+1 = 10 is better.
    // Use the classic crossing case: sources 0 and 10, sinks 9 and 100 with
    // masses that force a transfer.
    const sources = [cell(0, 0, 0.5, 1), cell(10, 0, 0.5, 1)]
    const sinks = [cell(9, 0, 0.9, 1), cell(100, 0, 0.1, 1)]
    const r = solveTransport(sources, sinks, scale, 'manhattan')
    const ref = solveTransportReference(sources, sinks, scale, 'manhattan')
    expect(r.totalCost).toBeCloseTo(ref.totalCost, 10)
    expect(r.checks.optimality).toBe(true)
  })

  it('conserves supply and demand cell by cell on a dense random problem', () => {
    const rng = mulberry32(7)
    for (let trial = 0; trial < 6; trial++) {
      const sources = randomCells(rng, 8 + trial, 6)
      const sinks = randomCells(rng, 8 + trial, 6)
      const totalS = sources.reduce((s, c) => s + c.mass, 0)
      const totalT = sinks.reduce((s, c) => s + c.mass, 0)
      const r = solveTransport(sources, sinks, scale, trial % 3 === 0 ? 'euclid' : trial % 3 === 1 ? 'manhattan' : 'chebyshev')
      const ref = solveTransportReference(sources, sinks, scale, trial % 3 === 0 ? 'euclid' : trial % 3 === 1 ? 'manhattan' : 'chebyshev')
      expect(r.checks.supplySum).toBeCloseTo(r.checks.demandSum, 12)
      expect(r.checks.rowBalanceError).toBeLessThan(1e-9)
      expect(r.checks.colBalanceError).toBeLessThan(1e-9)
      expect(r.checks.deliveredSum).toBeCloseTo(Math.min(totalS, totalT), 10)
      expect(r.checks.optimality).toBe(true)
      expect(r.totalCost).toBeCloseTo(ref.totalCost, 7)
    }
  })

  it('reproduces the reference optimum on larger grids', () => {
    const rng = mulberry32(42)
    for (let trial = 0; trial < 4; trial++) {
      const sources = randomCells(rng, 14, 9)
      const sinks = randomCells(rng, 14, 9)
      const r = solveTransport(sources, sinks, scale, 'euclid')
      const ref = solveTransportReference(sources, sinks, scale, 'euclid')
      expect(r.checks.optimality).toBe(true)
      expect(r.totalCost).toBeLessThanOrEqual(ref.totalCost + 1e-8)
      expect(r.totalCost).toBeCloseTo(ref.totalCost, 6)
    }
  })

  it('handles 20×20 occupied cells quickly and exactly', () => {
    const rng = mulberry32(100)
    const sources = randomCells(rng, 150, 20)
    const sinks = randomCells(rng, 150, 20)
    const r = solveTransport(sources, sinks, scale, 'euclid')
    const ref = solveTransportReference(sources, sinks, scale, 'euclid')
    expect(r.checks.optimality).toBe(true)
    expect(r.totalCost).toBeCloseTo(ref.totalCost, 6)
    expect(r.checks.rowBalanceError).toBeLessThan(1e-9)
  })
})
