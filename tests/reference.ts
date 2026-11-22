/**
 * Independent exact oracle for the transport tests.
 *
 * Solves the same balanced transportation problem as a minimum-cost flow via
 * successive shortest augmenting paths with Bellman–Ford (which is safe with
 * the negative-cost residual edges). A different algorithm from the MODI
 * network simplex used by the app, so agreement is meaningful evidence.
 */
import type { AxisScale, Metric } from '../src/lib/types'
import type { TransportCell } from '../src/lib/transport'
import { cellDistance } from '../src/lib/transport'

interface Edge {
  to: number
  cap: number
  cost: number
  rev: number
}

export function solveTransportReference(
  sources: TransportCell[],
  sinks: TransportCell[],
  scale: AxisScale,
  metric: Metric,
): { totalCost: number } {
  const m = sources.length
  const n = sinks.length
  if (m === 0 || n === 0) return { totalCost: 0 }
  const totalS = sources.reduce((s, c) => s + c.mass, 0)
  const totalT = sinks.reduce((s, c) => s + c.mass, 0)
  const total = Math.min(totalS, totalT)

  const N = m + n + 2
  const S = m + n
  const T = m + n + 1
  const g: Edge[][] = Array.from({ length: N }, () => [])
  const add = (u: number, v: number, cap: number, cost: number) => {
    g[u].push({ to: v, cap, cost, rev: g[v].length })
    g[v].push({ to: u, cap: 0, cost: -cost, rev: g[u].length - 1 })
  }
  for (let i = 0; i < m; i++) add(S, i, (sources[i].mass / totalS) * total, 0)
  for (let j = 0; j < n; j++) add(m + j, T, (sinks[j].mass / totalT) * total, 0)
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      add(i, m + j, total, cellDistance(sources[i], sinks[j], scale, metric))
    }
  }

  let flowCost = 0
  const maxAug = 200_000
  for (let aug = 0; aug < maxAug; aug++) {
    const dist = new Float64Array(N).fill(Number.POSITIVE_INFINITY)
    const prevV = new Int32Array(N).fill(-1)
    const prevE = new Int32Array(N).fill(-1)
    dist[S] = 0
    // Bellman–Ford (SPFA-style queue) on the residual graph.
    const inQueue = new Uint8Array(N)
    const queue = [S]
    inQueue[S] = 1
    let head = 0
    while (head < queue.length) {
      const u = queue[head++]
      inQueue[u] = 0
      for (let ei = 0; ei < g[u].length; ei++) {
        const e = g[u][ei]
        if (e.cap <= 1e-15) continue
        if (dist[u] + e.cost < dist[e.to] - 1e-12) {
          dist[e.to] = dist[u] + e.cost
          prevV[e.to] = u
          prevE[e.to] = ei
          if (!inQueue[e.to]) {
            inQueue[e.to] = 1
            queue.push(e.to)
          }
        }
      }
      if (head > 4 * N * N) break
    }
    if (!Number.isFinite(dist[T])) break
    let push = Number.POSITIVE_INFINITY
    for (let v = T; v !== S; v = prevV[v]) {
      if (prevV[v] === -1) return { totalCost: Number.NaN }
      push = Math.min(push, g[prevV[v]][prevE[v]].cap)
    }
    if (!Number.isFinite(push) || push <= 1e-15) break
    for (let v = T; v !== S; v = prevV[v]) {
      const u = prevV[v]
      const e = g[u][prevE[v]]
      e.cap -= push
      g[v][e.rev].cap += push
      flowCost += push * e.cost
    }
  }
  return { totalCost: flowCost }
}
