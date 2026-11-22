import type { AnalysisResult } from '../lib/analysis'
import type { AxisScale, Metric, RangePolicy } from '../lib/types'
import { fmt } from '../lib/units'

interface ControlsProps {
  result: AnalysisResult
  rangePolicy: RangePolicy
  onRangePolicy: (value: RangePolicy) => void
  resolution: number
  onResolution: (value: number) => void
  metric: Metric
  onMetric: (value: Metric) => void
  scale: AxisScale
  onScale: (value: AxisScale) => void
  onResetScale: () => void
  showDensity: boolean
  onShowDensity: (value: boolean) => void
}

const RESOLUTIONS = [6, 8, 10, 12, 16, 20]

export function Controls({
  result,
  rangePolicy,
  onRangePolicy,
  resolution,
  onResolution,
  metric,
  onMetric,
  scale,
  onScale,
  onResetScale,
  showDensity,
  onShowDensity,
}: ControlsProps) {
  const outsideCount = result.records.filter(
    (r) => r.outsideNominal && (r.status === 'included' || r.status === 'out-of-range'),
  ).length
  const domainStepX = (result.domain.lengthMax - result.domain.lengthMin) / result.countX
  const domainStepY = (result.domain.widthMax - result.domain.widthMin) / result.countY

  return (
    <div className="control-row" role="group" aria-label="分析设定">
      <div className="field">
        <span className="field-label">超程样本</span>
        <div className="segmented" role="group" aria-label="超程样本处理">
          <button
            type="button"
            aria-pressed={rangePolicy === 'exclude'}
            onClick={() => onRangePolicy('exclude')}
          >
            排除
          </button>
          <button
            type="button"
            aria-pressed={rangePolicy === 'expand'}
            onClick={() => onRangePolicy('expand')}
          >
            扩展网格纳入
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">网格分辨率</span>
        <div className="segmented" role="group" aria-label="网格分辨率">
          {RESOLUTIONS.map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={resolution === value}
              onClick={() => onResolution(value)}
            >
              {value}×{value}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">距离尺度</span>
        <select
          className="select"
          value={metric}
          onChange={(event) => onMetric(event.target.value as Metric)}
          aria-label="运输距离尺度"
        >
          <option value="euclid">欧氏距离</option>
          <option value="manhattan">曼哈顿距离</option>
          <option value="chebyshev">切比雪夫距离</option>
        </select>
      </div>

      <div className="field">
        <span className="field-label">长轴量纲（mm / 分析单位）</span>
        <input
          className="number-input"
          type="number"
          min={0.001}
          step={1}
          value={scale.lengthMmPerUnit}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value) && value > 0) onScale({ ...scale, lengthMmPerUnit: value })
          }}
          aria-label="长轴每分析单位对应的毫米数"
        />
      </div>

      <div className="field">
        <span className="field-label">宽轴量纲（mm / 分析单位）</span>
        <input
          className="number-input"
          type="number"
          min={0.001}
          step={1}
          value={scale.widthMmPerUnit}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value) && value > 0) onScale({ ...scale, widthMmPerUnit: value })
          }}
          aria-label="宽轴每分析单位对应的毫米数"
        />
      </div>

      <button
        type="button"
        className="reset-button"
        onClick={onResetScale}
        title="恢复 1 mm = 1 分析单位"
      >
        复位
      </button>

      <div className="field">
        <span className="field-label">图层</span>
        <div className="segmented" role="group" aria-label="图层显示">
          <button type="button" aria-pressed={showDensity} onClick={() => onShowDensity(true)}>
            密度
          </button>
          <button type="button" aria-pressed={!showDensity} onClick={() => onShowDensity(false)}>
            仅搬移
          </button>
        </div>
      </div>

      <div className="inline-note" style={{ marginLeft: 'auto', maxWidth: 430 }}>
        <div>
          格宽：长 {fmt(domainStepX, 2)} mm × 宽 {fmt(domainStepY, 2)} mm
          {result.domain.expanded ? '（已扩展）' : '（名义量程）'}
        </div>
        <div>
          {rangePolicy === 'exclude'
            ? `超程 ${outsideCount} 件已排除，不参与运输。`
            : `超程 ${outsideCount} 件已纳入扩展网格，保留真实坐标。`}
        </div>
      </div>
    </div>
  )
}
