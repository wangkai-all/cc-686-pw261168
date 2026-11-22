import type { AnalysisResult } from '../lib/analysis'
import { fmt, fmtPercent } from '../lib/units'

interface SummaryProps {
  result: AnalysisResult
}

export function Summary({ result }: SummaryProps) {
  const { stats, A2B, B2A, report, meanDiff, config } = result
  const a = stats.A
  const b = stats.B
  const cost = A2B.totalCost
  const reverse = B2A.totalCost
  const sameDirection = Math.abs(cost - reverse) < 1e-9

  return (
    <div className="stats" role="group" aria-label="关键指标">
      <div className="stat">
        <span className="stat-label">运输代价 · A → B</span>
        <span className="stat-value">
          {fmt(A2B.totalCost, 2)}
          <small>单位·占比</small>
        </span>
        <span className="stat-sub">
          平均搬移距离 {fmt(A2B.meanDistance, 2)} · 搬移质量 {fmtPercent(A2B.movedMass, 1)}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">运输代价 · B → A</span>
        <span className="stat-value">
          {fmt(B2A.totalCost, 2)}
          <small>单位·占比</small>
        </span>
        <span className="stat-sub">
          {sameDirection
            ? `核对：与 A→B 相同（转置同一最优解）· 平均距离 ${fmt(B2A.meanDistance, 2)}`
            : `核对：与反向差 ${fmt(Math.abs(cost - reverse), 2)}`}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">加权均值差 · 长 / 宽</span>
        <span className="stat-value" style={{ fontSize: 17, whiteSpace: 'nowrap' }}>
          {meanDiff ? `${nearZero(meanDiff.length)} / ${nearZero(meanDiff.width)}` : '—'}
          <small>mm</small>
        </span>
        <span className="stat-sub">
          {meanDiff
            ? `${nearZero(meanDiff.inAnalysisUnits.length)} / ${nearZero(meanDiff.inAnalysisUnits.width)} 分析单位 · 与代价独立`
            : '无有效样本'}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">纳入样本 · A / B</span>
        <span className="stat-value" style={{ fontSize: 18 }}>
          {report.included.A} <small>/</small> {report.included.B}
          <small>件</small>
        </span>
        <span className="stat-sub">
          有效权重 {fmt(result.effectiveWeight.A, 2)} / {fmt(result.effectiveWeight.B, 2)}
          {' '}· 各批归一化 100%
        </span>
      </div>
      {a && b && (
        <div className="stat">
          <span className="stat-label">加权标准差 · A / B</span>
          <span className="stat-value" style={{ fontSize: 17 }}>
            长 {fmt(a.sdLength, 1)} / {fmt(b.sdLength, 1)}
            <small>mm</small>
          </span>
          <span className="stat-sub">
            宽 {fmt(a.sdWidth, 1)} / {fmt(b.sdWidth, 1)} mm · 相关 {fmt(a.corr, 2)} /{' '}
            {fmt(b.corr, 2)}
          </span>
        </div>
      )}
      <div className="stat">
        <span className="stat-label">距离尺度 · 轴量纲</span>
        <span className="stat-value" style={{ fontSize: 16 }}>
          {config.metric === 'euclid' ? '欧氏' : config.metric === 'manhattan' ? '曼哈顿' : '切比雪夫'}
        </span>
        <span className="stat-sub">
          长 1 单位 = {fmt(config.axisScale.lengthMmPerUnit, 2)} mm · 宽 1 单位 ={' '}
          {fmt(config.axisScale.widthMmPerUnit, 2)} mm
        </span>
      </div>
    </div>
  )
}

/** Differences below display precision are shown as an explicit zero, not as 1e-6. */
function nearZero(value: number): string {
  return Math.abs(value) < 5e-4 ? '≈0.00' : fmt(value, 2)
}

export function BatchLegend({ result }: { result: AnalysisResult }) {  const labelA = result.scenario.batches[0]?.label ?? 'A'
  const labelB = result.scenario.batches[1]?.label ?? 'B'
  return (
    <div className="legend">
      <span className="legend-item">
        <span className="legend-swatch" style={{ background: 'var(--series-a)' }} />
        {labelA}
      </span>
      <span className="legend-item">
        <span className="legend-swatch" style={{ background: 'var(--series-b)' }} />
        {labelB}
      </span>
      {result.records.some((r) => r.outsideNominal && r.status === 'included') && (
        <span className="legend-item">
          <span
            className="legend-ring"
            style={{ borderColor: 'var(--warning)' }}
            aria-hidden="true"
          />
          扩展纳入的超程样本
        </span>
      )}
      <span className="legend-item">
        <span className="legend-line" style={{ background: 'var(--text-primary)', opacity: 0.8 }} />
        选中格的搬移去向
      </span>
    </div>
  )
}
