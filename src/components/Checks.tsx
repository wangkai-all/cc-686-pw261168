import type { AnalysisResult } from '../lib/analysis'
import type { TransportResult } from '../lib/transport'
import { fmt, fmtPercent } from '../lib/units'

export function ConservationChecks({ transport }: { transport: TransportResult }) {
  const c = transport.checks
  const tol = 1e-9
  const rows = [
    {
      label: '供给总和',
      detail: '源批次归一化质量',
      value: fmtPercent(c.supplySum, 4),
      tone: Math.abs(c.supplySum - 1) < tol ? 'good' : 'warn',
    },
    {
      label: '需求总和',
      detail: '目标批次归一化质量',
      value: fmtPercent(c.demandSum, 4),
      tone: Math.abs(c.demandSum - 1) < tol ? 'good' : 'warn',
    },
    {
      label: '实际送达',
      detail: '全部流的质量之和',
      value: fmtPercent(c.deliveredSum, 4),
      tone: Math.abs(c.deliveredSum - 1) < tol ? 'good' : 'warn',
    },
    {
      label: '逐行守恒误差',
      detail: '最差一行：Σ 流出 − 供给',
      value: c.rowBalanceError.toExponential(1),
      tone: c.rowBalanceError < 1e-9 ? 'good' : 'critical',
    },
    {
      label: '逐列守恒误差',
      detail: '最差一列：Σ 流入 − 需求',
      value: c.colBalanceError.toExponential(1),
      tone: c.colBalanceError < 1e-9 ? 'good' : 'critical',
    },
    {
      label: '原始/对偶代价一致',
      detail: '相对差：|原始 − 对偶| / 原始',
      value: c.costAgreement.toExponential(1),
      tone: c.costAgreement < 1e-9 ? 'good' : 'critical',
    },
    {
      label: '最优性证书',
      detail: `最小检验数 ${c.minReducedCost.toExponential(1)}`,
      value: c.optimality ? '全部 ≥ 0' : '存在负检验数',
      tone: c.optimality ? 'good' : 'critical',
    },
    {
      label: '非零流',
      detail: `增广次数 ${c.augmentations} · 最小流 ${c.minFlow.toExponential(1)}`,
      value: `${c.nonZeroFlowCount} 条`,
      tone: 'neutral',
    },
  ] as const

  return (
    <div className="check-list" role="list" aria-label="供需守恒逐格核对">
      {rows.map((row) => (
        <div className="check-row" role="listitem" key={row.label}>
          <span className={`check-dot ${row.tone}`} aria-hidden="true" />
          <span>
            <span className="check-label">{row.label}</span>
            <br />
            <span className="check-detail">{row.detail}</span>
          </span>
          <span className="check-value">
            {row.tone === 'warn' || row.tone === 'critical' ? '⚠ ' : ''}
            {row.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ScenarioChecks({ result }: { result: AnalysisResult }) {
  const checks: Array<{ label: string; expected: string; observed: string; pass: boolean }> = []
  const a = result.stats.A
  const b = result.stats.B
  if (result.scenario.checks?.equalWeightedMeans && a && b) {
    const dl = Math.abs(a.meanLength - b.meanLength)
    const dw = Math.abs(a.meanWidth - b.meanWidth)
    checks.push({
      label: '两批加权均值相同',
      expected: '长、宽差均 < 0.01 mm',
      observed: `Δ长 ${fmt(dl, 4)} · Δ宽 ${fmt(dw, 4)} mm`,
      pass: dl < 0.01 && dw < 0.01,
    })
    checks.push({
      label: '均值相同但分布不同',
      expected: '运输代价 > 0',
      observed: `代价 ${fmt(result.A2B.totalCost, 2)}`,
      pass: result.A2B.totalCost > 0.01,
    })
  }
  if (typeof result.scenario.checks?.expectWidthOffsetMm === 'number' && a && b) {
    const expected = result.scenario.checks.expectWidthOffsetMm as number
    const observed = b.meanWidth - a.meanWidth
    checks.push({
      label: `宽向整体偏移 ≈ ${expected} mm`,
      expected: `${expected} mm（B − A，量程内样本）`,
      observed: `${fmt(observed, 2)} mm`,
      pass: Math.abs(observed - expected) < 1.5,
    })
  }
  if (result.scenario.checks?.expectRawUnitsMismatch) {
    // Naive mean of the raw numbers, ignoring the per-row unit column: this is
    // what the sample would look like if units were never aligned.
    const raw = { A: [] as number[], B: [] as number[] }
    for (const rec of result.records) {
      if (rec.status !== 'included' || (rec.batchKey !== 'A' && rec.batchKey !== 'B')) continue
      const l = Number(rec.lengthRaw)
      if (Number.isFinite(l)) raw[rec.batchKey].push(l)
    }
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null)
    const rawA = mean(raw.A)
    const rawB = mean(raw.B)
    checks.push({
      label: '单位对齐已生效',
      expected: '不换算单位直接比原始数值会失真；按行内单位换算到 mm 后两批均值处于同一量级',
      observed:
        rawA !== null && rawB !== null && a && b
          ? `原始数值 ${fmt(rawA, 1)} vs ${fmt(rawB, 1)}（差 ${fmt(Math.abs(rawA - rawB), 1)}）→ 对齐后 ${fmt(a.meanLength, 1)} vs ${fmt(b.meanLength, 1)} mm`
          : a && b
            ? `对齐后长 ${fmt(a.meanLength, 1)} vs ${fmt(b.meanLength, 1)} mm`
            : '—',
      pass: Boolean(
        a &&
          b &&
          Math.abs(a.meanLength - b.meanLength) < 20 &&
          rawA !== null &&
          rawB !== null &&
          Math.abs(rawA - rawB) > 20,
      ),
    })
  }
  if (checks.length === 0) return null
  return (
    <div className="check-list" role="list" aria-label="场景自检">
      {checks.map((check) => (
        <div className="check-row" role="listitem" key={check.label}>
          <span className={`check-dot ${check.pass ? 'good' : 'critical'}`} aria-hidden="true" />
          <span>
            <span className="check-label">{check.label}</span>
            <br />
            <span className="check-detail">{check.expected}</span>
          </span>
          <span className="check-value">
            {check.pass ? '✓ ' : '✗ '}
            {check.observed}
          </span>
        </div>
      ))}
    </div>
  )
}
