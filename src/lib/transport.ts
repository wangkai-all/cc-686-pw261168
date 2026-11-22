import type { AxisScale, Metric } from './types'

export interface TransportCell {
  ix: number
  iy: number
  centerLength: number
  centerWidth: number
  /** Normalised mass at this cell (sum of member records' shares). */
  mass: number
  /** Number of records behind the mass, for drill-down. */
  recordCount: number
}

export interface Flow {
  from: number
  to: number
  mass: number
  /** Transport distance per unit mass, in analysis distance units. */
  cost: number
}

export interface TransportChecks {
  supplySum: number
  demandSum: number
  deliveredSum: number
  rowBalanceError: number
  colBalanceError: number
  costFromFlows: number
  costFromDual: number
  costAgreement: number
  minFlow: number
  maxFlow: number
  nonZeroFlowCount: number
  augmentations: number
  optimality: boolean
  minReducedCost: number
}

export interface TransportResult {
  sources: TransportCell[]
  sinks: TransportCell[]
  supply: Float64Array
  demand: Float64Array
  flows: Flow[]
  totalCost: number
  /** Mass that actually leaves its source cell (sum of non-diagonal flows). */
  movedMass: number
  /** Cost-weighted mean transport distance over moved mass. */
  meanDistance: number
  checks: TransportChecks
  method: string
  solveMs: number
}

export function cellDistance(
  a: { centerLength: number; centerWidth: number },
  b: { centerLength: number; centerWidth: number },
  scale: AxisScale,
  metric: Metric,
): number {
  const dx = Math.abs(a.centerLength - b.centerLength) / scale.lengthMmPerUnit
  const dy = Math.abs(a.centerWidth - b.centerWidth) / scale.widthMmPerUnit
  switch (metric) {
    case 'manhattan':
      return dx + dy
    case 'chebyshev':
      return Math.max(dx, dy)
    case 'euclid':
      return Math.hypot(dx, dy)
  }
}

/**
 * Exact minimum-cost transport of normalised shares from one batch's occupied
 * cells to the other's.
 *
 * This solves the full transportation linear programme — it is not a
 * nearest-cell greedy. The implementation is successive shortest augmenting
 * paths on the residual network:
 *
 *   - network: S → source cells (capacity = remaining mass), source → sink
 *     cells (capacity ∞, cost = cell-centre distance), sink cells → T
 *     (capacity = remaining mass);
 *   - each round runs Dijkstra on reduced costs (Johnson potentials keep all
 *     residual reduced costs non-negative), then augments the bottleneck;
 *   - the loop ends when T is unreachable — every residual reduced cost is
 *     then ≥ 0, and the final potentials satisfy the LP dual, certifying
 *     optimality (the dual objective is reported and compared to the primal).
 *
 * Cells with zero mass must be filtered out by the caller: they never supply,
 * demand, or contribute transport distance.
 */
export function solveTransport(
  sources: TransportCell[],
  sinks: TransportCell[],
  scale: AxisScale,
  metric: Metric,
): TransportResult {
  const started = performance.now()
  const m = sources.length
  const n = sinks.length
  const supply = Float64Array.from(sources, (c) => c.mass)
  const demand = Float64Array.from(sinks, (c) => c.mass)
  const supplySum = sum(supply)
  const demandSum = sum(demand)

  if (m === 0 || n === 0 || supplySum <= 0 || demandSum <= 0) {
    return {
      sources,
      sinks,
      supply,
      demand,
      flows: [],
      totalCost: 0,
      movedMass: 0,
      meanDistance: 0,
      checks: {
        supplySum,
        demandSum,
        deliveredSum: 0,
        rowBalanceError: Math.abs(supplySum - demandSum),
        colBalanceError: Math.abs(supplySum - demandSum),
        costFromFlows: 0,
        costFromDual: 0,
        costAgreement: 0,
        minFlow: 0,
        maxFlow: 0,
        nonZeroFlowCount: 0,
        augmentations: 0,
        optimality: false,
        minReducedCost: 0,
      },
      method: '无可用质量格，未求解',
      solveMs: performance.now() - started,
    }
  }

  // Both sides are shares of their own batch, so both totals are 1 by
  // construction; rescale to the smaller anyway so the LP is exactly balanced.
  const total = Math.min(supplySum, demandSum)
  for (let i = 0; i < m; i++) supply[i] = (supply[i] / supplySum) * total
  for (let j = 0; j < n; j++) demand[j] = (demand[j] / demandSum) * total

  const cost = new Float64Array(m * n)
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      cost[i * n + j] = cellDistance(sources[i], sinks[j], scale, metric)
    }
  }

  const solved = minCostFlow(cost, m, n, supply, demand)
  const flow = solved.flow

  const outflow = new Float64Array(m)
  const inflow = new Float64Array(n)
  const flows: Flow[] = []
  let deliveredSum = 0
  let costFromFlows = 0
  let movedMass = 0
  let minFlow = Number.POSITIVE_INFINITY
  let maxFlow = 0
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const f = flow[i * n + j]
      if (!(f > 0)) continue
      const c = cost[i * n + j]
      outflow[i] += f
      inflow[j] += f
      deliveredSum += f
      costFromFlows += f * c
      const diagonal =
        sources[i].ix === sinks[j].ix && sources[i].iy === sinks[j].iy
      if (!diagonal) movedMass += f
      flows.push({ from: i, to: j, mass: f, cost: c })
      if (f < minFlow) minFlow = f
      if (f > maxFlow) maxFlow = f
    }
  }
  flows.sort((a, b) => b.mass - a.mass || a.from - b.from || a.to - b.to)

  let rowBalanceError = 0
  let colBalanceError = 0
  for (let i = 0; i < m; i++) {
    rowBalanceError = Math.max(rowBalanceError, Math.abs(outflow[i] - supply[i]))
  }
  for (let j = 0; j < n; j++) {
    colBalanceError = Math.max(colBalanceError, Math.abs(inflow[j] - demand[j]))
  }

  const tol = 1e-9 * Math.max(1, maxAbs(cost))
  let minReducedCost = Number.POSITIVE_INFINITY
  let optimality = true
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const rc = cost[i * n + j] + solved.hSource[i] - solved.hSink[j]
      if (rc < minReducedCost) minReducedCost = rc
      if (rc < -tol * 10) optimality = false
    }
  }
  if (!Number.isFinite(minReducedCost)) minReducedCost = 0

  let costFromDual = 0
  for (let i = 0; i < m; i++) costFromDual += -solved.hSource[i] * supply[i]
  for (let j = 0; j < n; j++) costFromDual += solved.hSink[j] * demand[j]

  const checks: TransportChecks = {
    supplySum: sum(supply),
    demandSum: sum(demand),
    deliveredSum,
    rowBalanceError,
    colBalanceError,
    costFromFlows,
    costFromDual,
    costAgreement: costFromFlows > 0 ? Math.abs(costFromFlows - costFromDual) / costFromFlows : 0,
    minFlow: Number.isFinite(minFlow) ? minFlow : 0,
    maxFlow,
    nonZeroFlowCount: flows.length,
    augmentations: solved.augmentations,
    optimality,
    minReducedCost,
  }

  return {
    sources,
    sinks,
    supply,
    demand,
    flows,
    totalCost: costFromFlows,
    movedMass,
    meanDistance: movedMass > 0 ? costFromFlows / movedMass : 0,
    checks,
    method: '逐次最短路最小费用流（精确运输 LP）',
    solveMs: performance.now() - started,
  }
}

function sum(a: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]
  return s
}

function maxAbs(a: Float64Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i])
    if (v > m) m = v
  }
  return m
}

interface MinCostOutput {
  flow: Float64Array
  hSource: Float64Array
  hSink: Float64Array
  augmentations: number
}

/** Binary min-heap of node indices keyed by distance. */
class MinHeap {
  private keys: Float64Array
  private vals: Int32Array
  private size = 0

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity)
    this.vals = new Int32Array(capacity)
  }

  get length(): number {
    return this.size
  }

  clear(): void {
    this.size = 0
  }

  push(key: number, val: number): void {
    let i = this.size++
    if (i >= this.keys.length) this.grow()
    this.keys[i] = key
    this.vals[i] = val
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p] <= this.keys[i]) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    if (this.size === 0) return -1
    const top = this.vals[0]
    this.size -= 1
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size]
      this.vals[0] = this.vals[this.size]
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let best = i
        if (l < this.size && this.keys[l] < this.keys[best]) best = l
        if (r < this.size && this.keys[r] < this.keys[best]) best = r
        if (best === i) break
        this.swap(i, best)
        i = best
      }
    }
    return top
  }

  peekKey(): number {
    return this.keys[0]
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]
    this.keys[a] = this.keys[b]
    this.keys[b] = k
    const v = this.vals[a]
    this.vals[a] = this.vals[b]
    this.vals[b] = v
  }

  private grow(): void {
    const keys = new Float64Array(this.keys.length * 2)
    keys.set(this.keys)
    this.keys = keys
    const vals = new Int32Array(this.vals.length * 2)
    vals.set(this.vals)
    this.vals = vals
  }
}

/**
 * Dense bipartite min-cost flow. Node ids:
 *   0 = S, 1..m = sources, 1+m..m+n = sinks, m+n+1 = T.
 * Middle edges are implicit: forward capacity is unbounded, reverse capacity
 * equals the current flow.
 */
function minCostFlow(
  cost: Float64Array,
  m: number,
  n: number,
  supply0: Float64Array,
  demand0: Float64Array,
): MinCostOutput {
  const flow = new Float64Array(m * n)
  const supply = Float64Array.from(supply0)
  const demand = Float64Array.from(demand0)
  const N = m + n + 2
  const S = 0
  const T = m + n + 1
  const srcNode = (i: number) => 1 + i
  const sinkNode = (j: number) => 1 + m + j

  const h = new Float64Array(N) // Johnson potentials, start at 0
  const dist = new Float64Array(N)
  const prev = new Int32Array(N)
  const done = new Uint8Array(N)
  const heap = new MinHeap(N * 2 + 8)
  const eps = 1e-13
  let augmentations = 0

  // Each augmentation saturates at least one supply or demand arc; allow
  // generous slack for rerouting before declaring numerical termination.
  const maxAugmentations = 4 * (m + n) * (m + n) + 64

  for (let aug = 0; aug < maxAugmentations; aug++) {
    dist.fill(Number.POSITIVE_INFINITY)
    prev.fill(-1)
    done.fill(0)
    heap.clear()
    dist[S] = 0
    heap.push(0, S)

    while (heap.length > 0) {
      const key = heap.peekKey()
      const u = heap.pop()
      if (done[u]) continue
      done[u] = 1
      if (u === T) break

      if (u === S) {
        for (let i = 0; i < m; i++) {
          if (supply[i] <= eps) continue
          const v = srcNode(i)
          const rc = h[S] - h[v]
          const nd = key + Math.max(0, rc)
          if (nd < dist[v] - 1e-15) {
            dist[v] = nd
            prev[v] = S
            heap.push(nd, v)
          }
        }
        continue
      }
      if (u > S && u <= m) {
        const i = u - 1
        const base = i * n
        for (let j = 0; j < n; j++) {
          const v = sinkNode(j)
          if (done[v]) continue
          const rc = cost[base + j] + h[u] - h[v]
          const nd = key + Math.max(0, rc)
          if (nd < dist[v] - 1e-15) {
            dist[v] = nd
            prev[v] = u
            heap.push(nd, v)
          }
        }
        continue
      }
      if (u > m && u <= m + n) {
        const j = u - m - 1
        if (demand[j] > eps) {
          const v = T
          const rc = h[u] - h[T]
          const nd = key + Math.max(0, rc)
          if (nd < dist[v] - 1e-15) {
            dist[v] = nd
            prev[v] = u
            heap.push(nd, v)
          }
        }
        for (let i = 0; i < m; i++) {
          const f = flow[i * n + j]
          if (!(f > 0)) continue
          const v = srcNode(i)
          if (done[v]) continue
          const rc = -cost[i * n + j] + h[u] - h[v]
          const nd = key + Math.max(0, rc)
          if (nd < dist[v] - 1e-15) {
            dist[v] = nd
            prev[v] = u
            heap.push(nd, v)
          }
        }
        continue
      }
      // T has no outgoing residual edges.
    }

    if (!Number.isFinite(dist[T])) break

    // Johnson update. Unreached nodes advance by dist[T] too: that is the
    // standard fix that keeps every residual reduced cost non-negative
    // (an arc from an unreached node to a reached one would otherwise lose
    // its margin and could turn negative).
    const distT = dist[T]
    for (let v = 0; v < N; v++) h[v] += Math.min(dist[v], distT)

    // Bottleneck along the path T ← … ← S.
    let bottleneck = Number.POSITIVE_INFINITY
    for (let v = T; v !== S; v = prev[v]) {
      const u = prev[v]
      if (u < 0) {
        bottleneck = 0
        break
      }
      if (u === S) {
        bottleneck = Math.min(bottleneck, supply[v - 1])
      } else if (v === T) {
        bottleneck = Math.min(bottleneck, demand[u - m - 1])
      } else if (v <= m) {
        // sink u → source v: reverse edge, capacity = current flow.
        bottleneck = Math.min(bottleneck, flow[(v - 1) * n + (u - m - 1)])
      }
      // forward source→sink edges are unbounded
    }
    if (!(bottleneck > eps) || !Number.isFinite(bottleneck)) break

    // Apply the augmentation.
    for (let v = T; v !== S; v = prev[v]) {
      const u = prev[v]
      if (u === S) {
        supply[v - 1] -= bottleneck
      } else if (v === T) {
        demand[u - m - 1] -= bottleneck
      } else if (v <= m) {
        flow[(v - 1) * n + (u - m - 1)] -= bottleneck
      } else {
        flow[(u - 1) * n + (v - m - 1)] += bottleneck
      }
    }
    augmentations += 1
  }

  // Scrub floating-point residue so row sums match supply exactly.
  for (let i = 0; i < m; i++) {
    let rowSum = 0
    for (let j = 0; j < n; j++) rowSum += flow[i * n + j]
    const delta = supply0[i] - rowSum
    if (Math.abs(delta) > 1e-18) {
      let pick = 0
      for (let j = 1; j < n; j++) if (flow[i * n + j] > flow[i * n + pick]) pick = j
      flow[i * n + pick] += delta
    }
  }

  const hSource = new Float64Array(m)
  const hSink = new Float64Array(n)
  for (let i = 0; i < m; i++) hSource[i] = h[srcNode(i)]
  for (let j = 0; j < n; j++) hSink[j] = h[sinkNode(j)]
  return { flow, hSource, hSink, augmentations }
}
