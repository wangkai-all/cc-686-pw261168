import type { AnalysisResult } from '../lib/analysis'
import { statusLabel } from '../lib/prepare'
import { fmt } from '../lib/units'

/**
 * Unit alignment and special-row accounting. Every number here is derived from
 * the same processed records as the audit table, so the two can be reconciled
 * line by line.
 */
export function DataPrep({ result }: { result: AnalysisResult }) {
  const batchLabel = (key: 'A' | 'B') =>
    result.scenario.batches[key === 'A' ? 0 : 1]?.label ?? `批次 ${key}`

  const unitGroups = result.unitGroups
  const specials = result.specialGroups
  const outsideIncluded = result.records.filter(
    (r) => r.outsideNominal && r.status === 'included',
  ).length

  return (
    <section className="panel" aria-label="数据准备：单位对齐与特殊样本">
      <div className="panel-head">
        <h3>数据准备 · 单位对齐与特殊样本</h3>
        <span className="hint" style={{ marginLeft: 'auto' }}>
          与逐条审计表同一批记录，可逐行对照
        </span>
      </div>
      <div className="panel-body">
        <div className="prep-grid">
          <div>
            <h4 className="prep-title">按行内单位对齐到 mm</h4>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>批次</th>
                    <th>原始单位（长 / 宽）</th>
                    <th className="num">行数</th>
                    <th className="num">纳入运输</th>
                    <th>换算关系</th>
                  </tr>
                </thead>
                <tbody>
                  {unitGroups.map((g) => (
                    <tr key={`${g.batch}-${g.key}`}>
                      <td>{batchLabel(g.batch)}</td>
                      <td className="mono">{g.key}</td>
                      <td className="num">{g.count}</td>
                      <td className="num">{g.included}</td>
                      <td className="mono">{g.factor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="inline-note" style={{ marginTop: 8 }}>
              混合单位在同一批内逐行换算；页面设定的是「分析单位 = 多少 mm」，不会按当前批次重新标准化。
            </p>
          </div>

          <div>
            <h4 className="prep-title">特殊样本单列</h4>
            {specials.length === 0 && outsideIncluded === 0 ? (
              <p className="inline-note">本场景全部行均纳入运输，没有缺测、超程或无效权重行。</p>
            ) : specials.length === 0 ? null : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>类别</th>
                      <th>批次</th>
                      <th className="num">行数</th>
                      <th className="num">权重合计</th>
                      <th>示例编号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specials.map((g) => (
                      <tr key={`${g.status}-${g.batch}`}>
                        <td>
                          <span
                            className={`tag ${
                              g.status === 'out-of-range' || g.status === 'invalid-weight'
                                ? 'warn'
                                : 'critical'
                            }`}
                          >
                            {statusLabel(g.status)}
                          </span>
                        </td>
                        <td>{g.batch === 'unknown' ? '未知' : batchLabel(g.batch)}</td>
                        <td className="num">{g.count}</td>
                        <td className="num">{fmt(g.weight, 2)}</td>
                        <td className="mono">
                          {g.records
                            .slice(0, 3)
                            .map((r) => r.id || `行 ${r.line}`)
                            .join('、')}
                          {g.records.length > 3 ? '…' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="inline-note" style={{ marginTop: 8 }}>
              缺测行没有网格位置，不参与运输距离；超程行保留真实坐标，按当前策略排除或进入扩展网格；两类都不压到边界。
              {outsideIncluded > 0 && (
                <>
                  {' '}
                  当前策略下另有 {outsideIncluded} 行超程样本已进入扩展网格（坐标真实，未压边界），因此不再列在排除组。
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
