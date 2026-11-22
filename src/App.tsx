import { useEffect, useMemo, useState } from 'react'
import { useScenarioData } from './data/useScenarioData'
import { runAnalysis } from './lib/analysis'
import type { AxisScale, Metric, RangePolicy } from './lib/types'
import { Controls } from './components/Controls'
import { Summary, BatchLegend } from './components/Summary'
import { TransportGrid, type GridSelection } from './components/TransportGrid'
import { SelectionDetails, type ResolvedSelection } from './components/SelectionDetails'
import { ConservationChecks, ScenarioChecks } from './components/Checks'
import { Sensitivity } from './components/Sensitivity'
import { DataPrep } from './components/DataPrep'
import { CellTable, RecordTable, TransportTable } from './components/Tables'
import { fmt } from './lib/units'
import type { TransportResult } from './lib/transport'

type Tab = 'transport' | 'cells' | 'records'
type Direction = 'A2B' | 'B2A'

export default function App() {
  const load = useScenarioData()
  const [scenarioId, setScenarioId] = useState('bimodal')
  const [rangePolicy, setRangePolicy] = useState<RangePolicy>('exclude')
  const [resolution, setResolution] = useState(12)
  const [metric, setMetric] = useState<Metric>('euclid')
  const [scale, setScale] = useState<AxisScale>({ lengthMmPerUnit: 1, widthMmPerUnit: 1 })
  const [showDensity, setShowDensity] = useState(true)
  const [direction, setDirection] = useState<Direction>('A2B')
  const [selection, setSelection] = useState<GridSelection | null>(null)
  const [tab, setTab] = useState<Tab>('transport')
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system')

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  const scenarioData = load.status === 'ready' ? load.data[scenarioId] : null
  const manifest = load.status === 'ready' ? load.manifest : null

  useEffect(() => {
    if (!manifest) return
    setRangePolicy('exclude')
    setSelection(null)
    setDirection('A2B')
  }, [scenarioId, manifest])

  const result = useMemo(() => {
    if (!scenarioData) return null
    return runAnalysis(scenarioData.rows, scenarioData.scenario, {
      rangePolicy,
      gridResolution: resolution,
      metric,
      axisScale: scale,
    })
  }, [scenarioData, rangePolicy, resolution, metric, scale])

  const transport: TransportResult | null = result
    ? direction === 'A2B'
      ? result.A2B
      : result.B2A
    : null

  const resolved = useMemo<ResolvedSelection | null>(() => {
    if (!result || !selection) return null
    const sx = (result.domain.lengthMax - result.domain.lengthMin) / result.countX
    const sy = (result.domain.widthMax - result.domain.widthMin) / result.countY
    const inside =
      selection.lengthMm >= result.domain.lengthMin &&
      selection.lengthMm <= result.domain.lengthMax &&
      selection.widthMm >= result.domain.widthMin &&
      selection.widthMm <= result.domain.widthMax
    const ix = Math.min(
      result.countX - 1,
      Math.max(0, Math.floor((selection.lengthMm - result.domain.lengthMin) / sx)),
    )
    const iy = Math.min(
      result.countY - 1,
      Math.max(0, Math.floor((selection.widthMm - result.domain.widthMin) / sy)),
    )
    const t = direction === 'A2B' ? result.A2B : result.B2A
    const sourceIndex = inside ? t.sources.findIndex((c) => c.ix === ix && c.iy === iy) : -1
    return { ix, iy, inside, sourceIndex }
  }, [result, selection, direction])

  const scenarioList = manifest?.scenarios ?? []
  const current = scenarioData?.scenario

  if (load.status === 'loading') {
    return (
      <div style={{ padding: 40, color: 'var(--text-secondary)' }}>正在载入本地抽检数据…</div>
    )
  }
  if (load.status === 'error') {
    return (
      <div style={{ padding: 40, maxWidth: 620 }}>
        <h2 style={{ fontSize: 16 }}>数据载入失败</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>{load.message}</p>
        <p style={{ color: 'var(--text-muted)', marginTop: 12, fontSize: 12 }}>
          请从仓库根目录运行 <code>npm run dev</code>，并确认 <code>public/data/</code> 下存在 CSV 与
          scenarios.json。
        </p>
      </div>
    )
  }

  if (!result || !transport || !current) {
    return <div style={{ padding: 40 }}>场景数据缺失。</div>
  }

  const excludedCount = result.report.excluded.A + result.report.excluded.B
  const outsideCount = result.records.filter(
    (r) => r.outsideNominal && (r.status === 'included' || r.status === 'out-of-range'),
  ).length
  const specialCount = result.records.filter((r) => r.status !== 'included').length
  const outOfRangeGroups = result.specialGroups.filter((g) => g.status === 'out-of-range')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>尺寸迁移 · 工件抽检</h1>
          <p>对齐单位后，在两维尺寸空间比较两批的分布差异，并给出把一批占比搬到另一批的完整最小费用运输方案。</p>
        </div>

        <nav className="nav" aria-label="本地场景">
          <div className="nav-label">本地抽检场景</div>
          {scenarioList.map((scenario) => {
            const active = scenario.id === scenarioId
            return (
              <button
                key={scenario.id}
                type="button"
                aria-current={active}
                onClick={() => setScenarioId(scenario.id)}
              >
                <strong>{scenario.title}</strong>
                <span>{scenario.tagline}</span>
              </button>
            )
          })}
        </nav>

        <div className="nav" aria-label="场景说明">
          <div className="nav-label">这个场景在验证什么</div>
          <ul style={{ margin: 0, padding: '0 10px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {current.notes.map((note, i) => (
              <li key={i} style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                · {note}
              </li>
            ))}
          </ul>
        </div>

        <div className="sidebar-foot">
          <dl>
            <dt>数据源</dt>
            <dd className="mono">public/data/{current.file}</dd>
            <dt>名义量程</dt>
            <dd>
              {current.range.lengthMin}–{current.range.lengthMax} × {current.range.widthMin}–
              {current.range.widthMax} mm
            </dd>
            <dt>读入行数</dt>
            <dd>{result.records.length}</dd>
            <dt>特殊行</dt>
            <dd>{specialCount}</dd>
            <dt>求解耗时</dt>
            <dd>
              {fmt(result.A2B.solveMs + result.B2A.solveMs, 1)} ms（双向）
            </dd>
          </dl>
          <p style={{ marginTop: 10 }}>
            数据由 <span className="mono">scripts/gen_data.py</span> 生成，可复现；页面所有数字均可追溯到逐条审计表。
          </p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h2>{current.title}</h2>
            <p>{current.tagline}</p>
          </div>
          <div className="topbar-actions">
            <div className="segmented" role="group" aria-label="主题">
              <button type="button" aria-pressed={theme === 'system'} onClick={() => setTheme('system')}>
                自动
              </button>
              <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
                亮
              </button>
              <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
                暗
              </button>
            </div>
          </div>
        </header>

        <div className="stack">
          <Controls
            result={result}
            rangePolicy={rangePolicy}
            onRangePolicy={(value) => {
              setRangePolicy(value)
              if (value === 'exclude') setSelection(null)
            }}
            resolution={resolution}
            onResolution={setResolution}
            metric={metric}
            onMetric={setMetric}
            scale={scale}
            onScale={setScale}
            onResetScale={() => setScale({ lengthMmPerUnit: 1, widthMmPerUnit: 1 })}
            showDensity={showDensity}
            onShowDensity={setShowDensity}
          />

          <Summary result={result} />

          {excludedCount > 0 && rangePolicy === 'exclude' && (
            <div className="callout warn">
              <strong>超程样本已排除。</strong>共 {excludedCount} 件不在名义量程内：
              {outOfRangeGroups.map((g) => (
                <span key={g.batch}>
                  {' '}
                  批次 {g.batch} 有 {g.count} 件（权重 {fmt(g.weight, 2)}）；
                </span>
              ))}
              它们保留真实坐标但未进入网格，也未被压到边界。切换到「扩展网格纳入」可把它们纳入比较。
              被排除后，各批仍按自身剩余有效权重归一化，因此比较的是形状而不是抽检数量。
            </div>
          )}

          <div className="grid-2">
            <section className="panel" aria-label="二维网格运输图">
              <div className="panel-head">
                <h3>二维尺寸网格</h3>
                <div className="segmented" role="group" aria-label="运输方向">
                  <button
                    type="button"
                    aria-pressed={direction === 'A2B'}
                    onClick={() => {
                      setDirection('A2B')
                    }}
                  >
                    A → B
                  </button>
                  <button
                    type="button"
                    aria-pressed={direction === 'B2A'}
                    onClick={() => {
                      setDirection('B2A')
                    }}
                  >
                    B → A
                  </button>
                </div>
                <span className="hint" style={{ marginLeft: 'auto' }}>
                  {result.countX}×{result.countY} 格 · {result.density.filter((d) => d.massA > 0 || d.massB > 0).length} 个有样本
                </span>
              </div>
              <div className="panel-body">
                <div style={{ marginBottom: 10 }}>
                  <BatchLegend result={result} />
                </div>
                <TransportGrid
                  domain={result.domain}
                  nominal={current.range}
                  countX={result.countX}
                  countY={result.countY}
                  density={result.density}
                  transport={transport}
                  direction={direction}
                  selection={selection}
                  onSelectionChange={(next) => setSelection(next)}
                  showDensity={showDensity}
                  outsideRecords={result.records.filter(
                    (r) => r.outsideNominal && r.status === 'included',
                  )}
                />
                <p className="inline-note" style={{ marginTop: 8 }}>
                  点选一块查看它分去了哪些目标格；方向键可移动点选，回车选中。切换网格分辨率或距离尺度后，点选位置按物理坐标保留，代价变化会直接反映在下方明细与右侧核对中。
                  {rangePolicy === 'expand' && outsideCount > 0 && (
                    <> 黄色圆环标出 {outsideCount} 件由扩展网格纳入的超程样本，坐标保持真实值。</>
                  )}
                </p>
              </div>
            </section>

            <div className="stack">
              <section className="panel" aria-label="选中格的搬移明细">
                <div className="panel-head">
                  <h3>搬移明细</h3>
                  <span className="hint" style={{ marginLeft: 'auto' }}>
                    {direction === 'A2B' ? 'A → B' : 'B → A'}
                  </span>
                </div>
                <div className="panel-body">
                  <SelectionDetails
                    result={result}
                    transport={transport}
                    resolved={resolved}
                    direction={direction}
                    onClear={() => setSelection(null)}
                  />
                </div>
              </section>

              <section className="panel" aria-label="供需守恒核对">
                <div className="panel-head">
                  <h3>供需守恒逐格核对</h3>
                  <span className="hint" style={{ marginLeft: 'auto' }}>
                    {direction === 'A2B' ? 'A → B' : 'B → A'}
                  </span>
                </div>
                <div className="panel-body" style={{ paddingTop: 8 }}>
                  <ConservationChecks transport={transport} />
                </div>
              </section>
            </div>
          </div>

          <div className="grid-2">
            <section className="panel" aria-label="场景自检">
              <div className="panel-head">
                <h3>场景自检</h3>
                <span className="hint" style={{ marginLeft: 'auto' }}>
                  用数据本身验证“均值相同 ≠ 分布相同”
                </span>
              </div>
              <div className="panel-body" style={{ paddingTop: 8 }}>
                <ScenarioChecks result={result} />
                <div className="divider" />
                <div className="callout">
                  <strong>为什么不用贪心。</strong>最近格贪心在二维运输中会先占掉近格，后续质量被迫绕远，
                  总代价高于最优解。这里用完整的最小费用运输 LP：每个源格可以分给任意多个目标格，
                  供需守恒逐格核对，并由检验数全非负给出最优性证书。
                </div>
              </div>
            </section>

            <section className="panel" aria-label="口径摘要">
              <div className="panel-head">
                <h3>口径摘要</h3>
                <span className="hint" style={{ marginLeft: 'auto' }}>
                  当前生效的设定与读数
                </span>
              </div>
              <div className="panel-body" style={{ paddingTop: 10 }}>
                <dl className="glossary">
                  <div>
                    <dt>代价单位</dt>
                    <dd>
                      Σ 归一化质量 × 格心距离，量纲为「分析距离单位·占比」，两批完全相同时为 0。
                    </dd>
                  </div>
                  <div>
                    <dt>平均搬移距离</dt>
                    <dd>
                      代价 ÷ 实际搬移质量；{fmt(result.A2B.movedMass, 3)} 的占比离开了原格，其余对角保留。
                    </dd>
                  </div>
                  <div>
                    <dt>归一化</dt>
                    <dd>
                      A、B 各按自身有效权重归一化，比较形状；件数 {result.report.included.A} /{' '}
                      {result.report.included.B} 不直接进入代价。
                    </dd>
                  </div>
                  <div>
                    <dt>超程处理</dt>
                    <dd>
                      {rangePolicy === 'exclude'
                        ? `当前排除 ${outsideCount} 件，只比较量程内样本，坐标不压边界。`
                        : `当前扩展网格纳入 ${outsideCount} 件，格宽不变，保留真实坐标。`}
                    </dd>
                  </div>
                  <div>
                    <dt>距离与量纲</dt>
                    <dd>
                      {metric === 'euclid' ? '欧氏' : metric === 'manhattan' ? '曼哈顿' : '切比雪夫'}距离，
                      长 1 单位 = {fmt(scale.lengthMmPerUnit, 2)} mm，宽 1 单位 ={' '}
                      {fmt(scale.widthMmPerUnit, 2)} mm。
                    </dd>
                  </div>
                </dl>
              </div>
            </section>
          </div>

          <div className="grid-2">
            <DataPrep result={result} />
            <section className="panel" aria-label="分辨率与距离尺度敏感性">
              <div className="panel-head">
                <h3>分辨率与距离尺度</h3>
                <span className="hint" style={{ marginLeft: 'auto' }}>
                  A → B 代价
                </span>
              </div>
              <div className="panel-body">
                <Sensitivity
                  result={result}
                  rows={scenarioData!.rows}
                  rangePolicy={rangePolicy}
                  resolution={resolution}
                  metric={metric}
                  scale={scale}
                  onMetric={setMetric}
                  onResolution={setResolution}
                />
              </div>
            </section>
          </div>

          <section className="panel" aria-label="数据与运输明细">
            <div className="panel-head">
              <h3>数据与运输明细</h3>
              <span className="hint" style={{ marginLeft: 'auto' }}>
                全部可导出，便于与源 CSV 互相追溯
              </span>
            </div>
            <div className="panel-body" style={{ paddingTop: 10 }}>
              <div className="tabs" role="tablist" aria-label="明细视图">
                <button
                  role="tab"
                  className="tab"
                  aria-selected={tab === 'transport'}
                  onClick={() => setTab('transport')}
                >
                  运输流明细
                </button>
                <button
                  role="tab"
                  className="tab"
                  aria-selected={tab === 'cells'}
                  onClick={() => setTab('cells')}
                >
                  网格聚合
                </button>
                <button
                  role="tab"
                  className="tab"
                  aria-selected={tab === 'records'}
                  onClick={() => setTab('records')}
                >
                  逐条审计
                </button>
              </div>
              {tab === 'transport' && <TransportTable transport={transport} direction={direction} />}
              {tab === 'cells' && <CellTable result={result} />}
              {tab === 'records' && <RecordTable result={result} />}
            </div>
          </section>

          <section className="panel" aria-label="口径说明">
            <div className="panel-head">
              <h3>口径与边界说明</h3>
            </div>
            <div className="panel-body">
              <div className="grid-2" style={{ gap: 24 }}>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.75 }}>
                  <li>每行先按行内单位换算到 mm，再由页面设定的长/宽量纲换算到分析单位；不会按当前批次重新标准化，真实偏移保留。</li>
                  <li>各批按自身有效权重归一化到 1，比较的是分布形状；抽检数量不同不会自动变成分布差。</li>
                  <li>缺测样本不生成网格位置，不参与运输距离；零或负权重单列为无效权重。</li>
                  <li>超程样本保留真实坐标：选择排除时只比较量程内样本，并显示被排除的数量与权重；选择扩展网格时才纳入，不压到边界。</li>

                </ul>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.75 }}>
                  <li>没有样本的网格格不参与运输距离，也不作为特殊格进入供需。</li>
                  <li>运输距离按格心计算，同一格内的样本先聚合。</li>
                  <li>求解为完整最小费用运输（逐次最短路 / 网络单纯形等价形式），并对每行、每列的质量守恒和原始/对偶代价一致性逐项核对。</li>
                  <li>距离尺度与网格分辨率是显示口径，不影响原始记录与单位对齐结果。</li>
                  <li>
                    当前读入：{result.records.length} 行，其中运输 {result.report.included.A + result.report.included.B} 行，
                    超程 {excludedCount} 行，缺测 {result.report.missing.A + result.report.missing.B} 行，
                    其他异常 {result.report.invalid} 行。
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
