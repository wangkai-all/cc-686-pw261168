import type { AnalysisResult } from '../lib/analysis'
import type { TransportResult } from '../lib/transport'
import { fmt, fmtPercent } from '../lib/units'

export interface ResolvedSelection {
  ix: number
  iy: number
  sourceIndex: number
  inside: boolean
}

interface SelectionDetailsProps {
  result: AnalysisResult
  transport: TransportResult
  resolved: ResolvedSelection | null
  direction: 'A2B' | 'B2A'
  onClear: () => void
}

export function SelectionDetails({ result, transport, resolved, direction, onClear }: SelectionDetailsProps) {
  const sourceName = direction === 'A2B' ? '批次 A' : '批次 B'
  const sinkName = direction === 'A2B' ? '批次 B' : '批次 A'

  if (!resolved || !resolved.inside) {
    return (
      <div className="detail-empty">
        {resolved && !resolved.inside
          ? '当前点选的物理位置在网格范围之外（切换「排除超程」后可能发生）。清除后重新点选，或改用「扩展网格纳入」。'
          : '点选网格中任一有质量的格，查看该格把质量分给了哪些目标格。选中后再切换网格分辨率或距离尺度，可直接看到同一物理位置的代价变化。'}
        {resolved && !resolved.inside && (
          <>
            <br />
            <button type="button" className="tab" onClick={onClear} style={{ paddingLeft: 0 }}>
              清除选择
            </button>
          </>
        )}
      </div>
    )
  }

  if (resolved.sourceIndex < 0) {
    return (
      <div className="detail-empty">
        格 ({resolved.ix}, {resolved.iy}) 在当前方向没有{sourceName}的质量，无法查看去向。
        <br />
        <button type="button" className="tab" onClick={onClear} style={{ paddingLeft: 0 }}>
          清除选择
        </button>
      </div>
    )
  }

  const source = transport.sources[resolved.sourceIndex]
  const flows = transport.flows
    .filter((f) => f.from === resolved.sourceIndex)
    .sort((p, q) => q.mass - p.mass)
  const total = flows.reduce((s, f) => s + f.mass, 0)
  const cost = flows.reduce((s, f) => s + f.mass * f.cost, 0)
  const maxMass = flows.length > 0 ? flows[0].mass : 0
  const diagonal = flows
    .filter((f) => {
      const sink = transport.sinks[f.to]
      return sink.ix === source.ix && sink.iy === source.iy
    })
    .reduce((s, f) => s + f.mass, 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h4 style={{ fontSize: 13.5, fontWeight: 650 }}>
          格 ({resolved.ix}, {resolved.iy}) · {sourceName} → {sinkName}
        </h4>
        <button
          type="button"
          className="tab"
          onClick={onClear}
          style={{ marginLeft: 'auto', padding: '2px 8px' }}
        >
          清除
        </button>
      </div>
      <div className="inline-note" style={{ marginTop: 3 }}>
        {source.recordCount} 件样本 · 归一化质量 {fmtPercent(source.mass, 2)} · 分往 {flows.length} 个目标格 · 本格代价贡献{' '}
        {fmt(cost, 4)}
      </div>

      <div className="flow-list" style={{ marginTop: 12 }}>
        {flows.map((f) => {
          const sink = transport.sinks[f.to]
          const share = total > 0 ? f.mass / total : 0
          const same = sink.ix === source.ix && sink.iy === source.iy
          return (
            <div className="flow-item" key={`${f.from}-${f.to}`}>
              <span className="flow-meta" style={{ textAlign: 'right' }}>
                →({sink.ix},{sink.iy})
              </span>
              <span className="flow-bar" title={same ? '对角保留在源格' : '搬到该目标格'}>
                <span
                  style={{
                    width: `${maxMass > 0 ? (f.mass / maxMass) * 100 : 0}%`,
                    background: same ? 'var(--text-muted)' : 'var(--text-primary)',
                  }}
                />
              </span>
              <span className="flow-meta">
                {fmtPercent(share, 1)} · 距 {fmt(f.cost, 2)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="divider" />
      <div className="chip-row">
        <span className="chip">本格转出 {fmtPercent(source.mass, 2)}</span>
        <span className="chip">对角保留 {fmtPercent(diagonal, 2)}</span>
        <span className="chip">本格代价 {fmt(cost, 4)}</span>
        <span className="chip">全局平均距离 {fmt(result[direction].meanDistance, 2)}</span>
      </div>
      <p className="inline-note" style={{ marginTop: 10 }}>
        目标格中心：长 {fmt(Math.min(...flows.map((f) => transport.sinks[f.to].centerLength)), 1)}–
        {fmt(Math.max(...flows.map((f) => transport.sinks[f.to].centerLength)), 1)} mm，宽{' '}
        {fmt(Math.min(...flows.map((f) => transport.sinks[f.to].centerWidth)), 1)}–
        {fmt(Math.max(...flows.map((f) => transport.sinks[f.to].centerWidth)), 1)} mm。运输距离按格心计算；
        格内样本先聚合再搬移，不单独移动。
      </p>
    </div>
  )
}
