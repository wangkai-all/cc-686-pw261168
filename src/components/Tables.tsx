import type { AnalysisResult } from '../lib/analysis'
import type { TransportResult } from '../lib/transport'
import { downloadCsv } from '../lib/export'
import { fmt, fmtPercent } from '../lib/units'
import { statusLabel } from '../lib/prepare'

export function TransportTable({ transport, direction }: { transport: TransportResult; direction: 'A2B' | 'B2A' }) {
  const sourceName = direction === 'A2B' ? 'A' : 'B'
  const sinkName = direction === 'A2B' ? 'B' : 'A'
  const rows = transport.flows.slice(0, 500)
  const total = transport.flows.reduce((s, f) => s + f.mass, 0)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span className="inline-note">
          {sourceName} → {sinkName} · 共 {transport.flows.length} 条非零流
          {transport.flows.length > rows.length ? `（显示前 ${rows.length} 条）` : ''} · 求解{' '}
          {fmt(transport.solveMs, 0)} ms
        </span>
        <button
          type="button"
          className="icon-button"
          style={{ marginLeft: 'auto', width: 'auto', padding: '0 10px', height: 28, fontSize: 11.5 }}
          onClick={() =>
            downloadCsv(
              `transport-${direction}.csv`,
              ['from_cell_x', 'from_cell_y', 'to_cell_x', 'to_cell_y', 'mass_share', 'distance_units'],
              transport.flows.map((f) => {
                const s = transport.sources[f.from]
                const t = transport.sinks[f.to]
                return [s.ix, s.iy, t.ix, t.iy, f.mass, f.cost]
              }),
            )
          }
        >
          导出流明细 CSV
        </button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>源格</th>
              <th>目标格</th>
              <th className="num">质量占比</th>
              <th className="num">距离（单位）</th>
              <th className="num">代价贡献</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f, i) => {
              const s = transport.sources[f.from]
              const t = transport.sinks[f.to]
              return (
                <tr key={`${f.from}-${f.to}-${i}`}>
                  <td className="mono">
                    ({s.ix}, {s.iy})
                  </td>
                  <td className="mono">
                    ({t.ix}, {t.iy})
                  </td>
                  <td className="num">{fmtPercent(total > 0 ? f.mass / total : 0, 2)}</td>
                  <td className="num">{fmt(f.cost, 3)}</td>
                  <td className="num">{fmt(f.mass * f.cost, 3)}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                  没有可运输的质量。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function CellTable({ result }: { result: AnalysisResult }) {
  const occupancy = result.density.filter((d) => d.massA > 0 || d.massB > 0)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span className="inline-note">
          有样本的格共 {occupancy.length} 个（总格数 {result.cells.length}）；空格不参与运输距离。
        </span>
        <button
          type="button"
          className="icon-button"
          style={{ marginLeft: 'auto', width: 'auto', padding: '0 10px', height: 28, fontSize: 11.5 }}
          onClick={() =>
            downloadCsv(
              'grid-density.csv',
              ['cell_x', 'cell_y', 'length_min_mm', 'length_max_mm', 'width_min_mm', 'width_max_mm', 'mass_A', 'mass_B', 'records_A', 'records_B'],
              occupancy.map((d) => [
                d.cell.ix,
                d.cell.iy,
                d.cell.lengthMin,
                d.cell.lengthMax,
                d.cell.widthMin,
                d.cell.widthMax,
                d.massA,
                d.massB,
                d.countA,
                d.countB,
              ]),
            )
          }
        >
          导出网格 CSV
        </button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>格</th>
              <th className="num">长区间 (mm)</th>
              <th className="num">宽区间 (mm)</th>
              <th className="num">A 质量</th>
              <th className="num">B 质量</th>
              <th className="num">A 件数</th>
              <th className="num">B 件数</th>
            </tr>
          </thead>
          <tbody>
            {occupancy.map((d) => (
              <tr key={`${d.cell.ix}-${d.cell.iy}`}>
                <td className="mono">
                  ({d.cell.ix}, {d.cell.iy})
                </td>
                <td className="num">
                  {fmt(d.cell.lengthMin, 1)}–{fmt(d.cell.lengthMax, 1)}
                </td>
                <td className="num">
                  {fmt(d.cell.widthMin, 1)}–{fmt(d.cell.widthMax, 1)}
                </td>
                <td className="num">{fmtPercent(d.massA, 2)}</td>
                <td className="num">{fmtPercent(d.massB, 2)}</td>
                <td className="num">{d.countA}</td>
                <td className="num">{d.countB}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function RecordTable({ result }: { result: AnalysisResult }) {
  const rows = result.records
  const specialCount = rows.filter((r) => r.status !== 'included').length
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span className="inline-note">
          原始读入 {rows.length} 行 · 特殊行 {specialCount} 行（缺测 / 超程 / 无效权重 / 单位异常 / 编号冲突）·
          坐标均已按行内单位对齐到 mm
        </span>
        <button
          type="button"
          className="icon-button"
          style={{ marginLeft: 'auto', width: 'auto', padding: '0 10px', height: 28, fontSize: 11.5 }}
          onClick={() =>
            downloadCsv(
              'records-audit.csv',
              [
                'line',
                'id',
                'batch',
                'length_raw',
                'width_raw',
                'length_unit',
                'width_unit',
                'weight_raw',
                'length_mm',
                'width_mm',
                'status',
                'reason',
                'cell_x',
                'cell_y',
                'share',
                'note',
              ],
              rows.map((r) => [
                r.line,
                r.id,
                r.batch,
                r.lengthRaw,
                r.widthRaw,
                r.lengthUnitRaw,
                r.widthUnitRaw,
                r.weightRaw,
                r.lengthMm,
                r.widthMm,
                statusLabel(r.status),
                r.reason,
                r.cell?.ix ?? null,
                r.cell?.iy ?? null,
                r.share,
                r.note,
              ]),
            )
          }
        >
          导出逐条审计 CSV
        </button>
      </div>
      <div className="table-wrap" style={{ maxHeight: 460 }}>
        <table className="data">
          <thead>
            <tr>
              <th className="num">行</th>
              <th>编号</th>
              <th>批次</th>
              <th className="num">长（原值 / 单位）</th>
              <th className="num">宽（原值 / 单位）</th>
              <th className="num">长 mm</th>
              <th className="num">宽 mm</th>
              <th className="num">权重</th>
              <th className="num">占比</th>
              <th>格</th>
              <th>状态</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.line}-${r.id}`}>
                <td className="num mono">{r.line}</td>
                <td className="mono">{r.id || '∅'}</td>
                <td>{r.batch}</td>
                <td className="num">
                  {r.lengthRaw || '∅'} {r.lengthUnitRaw}
                </td>
                <td className="num">
                  {r.widthRaw || '∅'} {r.widthUnitRaw}
                </td>
                <td className="num">{r.lengthMm === null ? '—' : fmt(r.lengthMm, 2)}</td>
                <td className="num">{r.widthMm === null ? '—' : fmt(r.widthMm, 2)}</td>
                <td className="num">{r.weight === null ? '—' : fmt(r.weight, 3)}</td>
                <td className="num">{r.share === null ? '—' : fmtPercent(r.share, 2)}</td>
                <td className="mono">{r.cell ? `(${r.cell.ix}, ${r.cell.iy})` : '—'}</td>
                <td>
                  <span
                    className={`tag ${
                      r.status === 'included'
                        ? 'good'
                        : r.status === 'out-of-range' || r.status === 'invalid-weight'
                          ? 'warn'
                          : 'critical'
                    }`}
                  >
                    {statusLabel(r.status)}
                  </span>
                  {r.reason ? (
                    <>
                      <br />
                      <span className="check-detail">{r.reason}</span>
                    </>
                  ) : null}
                </td>
                <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
