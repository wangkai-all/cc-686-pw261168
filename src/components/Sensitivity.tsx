import type { AnalysisResult } from '../lib/analysis'
import type { AxisScale, Metric, RangePolicy } from '../lib/types'
import { fmt, fmtPercent } from '../lib/units'
import type { CsvRecordRow } from '../lib/csv'
import { runAnalysis } from '../lib/analysis'

interface SensitivityProps {
  result: AnalysisResult
  rows: CsvRecordRow[]
  rangePolicy: RangePolicy
  resolution: number
  metric: Metric
  scale: AxisScale
  onMetric: (metric: Metric) => void
  onResolution: (resolution: number) => void
}

const RESOLUTIONS = [6, 8, 10, 12, 16, 20]
const METRICS: Array<{ key: Metric; label: string }> = [
  { key: 'euclid', label: '欧氏' },
  { key: 'manhattan', label: '曼哈顿' },
  { key: 'chebyshev', label: '切比雪夫' },
]

export function Sensitivity({
  result,
  rows,
  rangePolicy,
  resolution,
  metric,
  scale,
  onMetric,
  onResolution,
}: SensitivityProps) {
  const byResolution = RESOLUTIONS.map((res) => {
    if (res === resolution) return { res, cost: result.A2B.totalCost, mean: result.A2B.meanDistance }
    const r = runAnalysis(rows, result.scenario, {
      rangePolicy,
      gridResolution: res,
      metric,
      axisScale: scale,
    })
    return { res, cost: r.A2B.totalCost, mean: r.A2B.meanDistance }
  })
  const maxCost = Math.max(...byResolution.map((d) => d.cost), 1e-9)

  const byMetric = METRICS.map((m) => {
    if (m.key === metric) return { ...m, cost: result.A2B.totalCost }
    const r = runAnalysis(rows, result.scenario, {
      rangePolicy,
      gridResolution: resolution,
      metric: m.key,
      axisScale: scale,
    })
    return { ...m, cost: r.A2B.totalCost }
  })
  const maxMetric = Math.max(...byMetric.map((d) => d.cost), 1e-9)

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h4 style={{ fontSize: 12.5, fontWeight: 650 }}>网格分辨率 → 运输代价</h4>
          <span className="inline-note">同一距离尺度与量纲；点选任一分辨率直接切换</span>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {byResolution.map((d) => {
            const active = d.res === resolution
            return (
              <button
                key={d.res}
                type="button"
                onClick={() => onResolution(d.res)}
                aria-pressed={active}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  display: 'grid',
                  gridTemplateColumns: '42px minmax(0,1fr) 84px',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                }}
              >
                <span
                  className="flow-meta"
                  style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
                >
                  {d.res}×{d.res}
                </span>
                <span
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: 'var(--surface-3)',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      inset: '0 auto 0 0',
                      width: `${(d.cost / maxCost) * 100}%`,
                      background: active ? 'var(--accent)' : 'var(--seq-300)',
                      borderRadius: 4,
                    }}
                  />
                </span>
                <span
                  className="flow-meta"
                  style={{ textAlign: 'right', color: active ? 'var(--text-primary)' : undefined }}
                >
                  {fmt(d.cost, 2)}
                </span>
              </button>
            )
          })}
        </div>
        <p className="inline-note" style={{ marginTop: 8 }}>
          格越细，单次搬移越短，但会有更多格参与；代价不一定单调，也不应把某个分辨率的数值当成唯一真值。它随分辨率的变化本身是离散化下界效应的一部分。
        </p>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h4 style={{ fontSize: 12.5, fontWeight: 650 }}>距离尺度 → 运输代价</h4>
          <span className="inline-note">同一分辨率与量纲</span>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {byMetric.map((d) => {
            const active = d.key === metric
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => onMetric(d.key)}
                aria-pressed={active}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  display: 'grid',
                  gridTemplateColumns: '58px minmax(0,1fr) 84px',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                }}
              >
                <span
                  className="flow-meta"
                  style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
                >
                  {d.label}
                </span>
                <span
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: 'var(--surface-3)',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      inset: '0 auto 0 0',
                      width: `${(d.cost / maxMetric) * 100}%`,
                      background: active ? 'var(--accent)' : 'var(--seq-300)',
                      borderRadius: 4,
                    }}
                  />
                </span>
                <span
                  className="flow-meta"
                  style={{ textAlign: 'right', color: active ? 'var(--text-primary)' : undefined }}
                >
                  {fmt(d.cost, 2)}
                </span>
              </button>
            )
          })}
        </div>
        <p className="inline-note" style={{ marginTop: 8 }}>
          欧氏是直线距离；曼哈顿按长、宽方向分别累计；切比雪夫取两方向中较大者。三种尺度回答不同的“搬运”定义，切换后最优流会整体重算，而不是缩放旧结果。
        </p>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h4 style={{ fontSize: 12.5, fontWeight: 650 }}>长轴 / 宽轴量纲</h4>
          <span className="inline-note">改变分析单位的“真实长度”，不重新标准化样本</span>
        </div>
        <div className="inline-note" style={{ marginTop: 8 }}>
          当前：长 1 单位 = {fmt(scale.lengthMmPerUnit, 2)} mm，宽 1 单位 = {fmt(scale.widthMmPerUnit, 2)} mm。
          两轴比例 {fmt(scale.lengthMmPerUnit / scale.widthMmPerUnit, 3)}。坐标与样本占比不随量纲改变；
          改变的是格心之间的距离，因此代价只反映“多远算远”的设定，不会把两批的真实偏移抹掉。
        </div>
      </div>

      <div className="callout">
        <strong>代价怎么读。</strong> 代价 = Σ 流质量 × 格心距离，单位为「分析距离单位 × 归一化占比」。
        它把一批的占比搬到另一批所需的最小总调整量；两批完全相同则为 0。均值差只描述中心位置，
        双峰错位或方差异常会在此表现为明显大于 0 的代价。当前 A→B 的搬移质量为{' '}
        {fmtPercent(result.A2B.movedMass, 1)}。
      </div>
    </div>
  )
}
