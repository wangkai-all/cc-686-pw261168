import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { DensityCell } from '../lib/analysis'
import type { GridDomain, ProcessedRecord } from '../lib/types'
import type { TransportResult } from '../lib/transport'
import { fmtPercent } from '../lib/units'

export interface GridSelection {
  direction: 'A2B' | 'B2A'
  /** Physical anchor (cell centre in mm) so the selection survives regridding. */
  lengthMm: number
  widthMm: number
}

interface HoverState {
  ix: number
  iy: number
  px: number
  py: number
}

interface TransportGridProps {
  domain: GridDomain
  nominal: { lengthMin: number; lengthMax: number; widthMin: number; widthMax: number }
  countX: number
  countY: number
  density: DensityCell[]
  transport: TransportResult
  direction: 'A2B' | 'B2A'
  selection: GridSelection | null
  onSelectionChange: (selection: GridSelection | null) => void
  showDensity: boolean
  /** Out-of-nominal records that the expand policy has pulled into the grid. */
  outsideRecords: ProcessedRecord[]
}

const WIDTH = 780
const HEIGHT = 570
const M = { top: 16, right: 20, bottom: 44, left: 60 }

export function TransportGrid({
  domain,
  nominal,
  countX,
  countY,
  density,
  transport,
  direction,
  selection,
  onSelectionChange,
  showDensity,
  outsideRecords,
}: TransportGridProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const plotW = WIDTH - M.left - M.right
  const plotH = HEIGHT - M.top - M.bottom
  const stepX = plotW / countX
  const stepY = plotH / countY
  const sourceName = direction === 'A2B' ? '批次 A' : '批次 B'
  const sinkName = direction === 'A2B' ? '批次 B' : '批次 A'

  const cellByKey = useMemo(() => {
    const map = new Map<string, DensityCell>()
    for (const d of density) map.set(`${d.cell.ix},${d.cell.iy}`, d)
    return map
  }, [density])

  const maxMass = useMemo(() => {
    let m = 0
    for (const d of density) m = Math.max(m, d.massA, d.massB)
    return m
  }, [density])

  const selectionIndex = useMemo(() => {
    if (!selection) return null
    const sx = (domain.lengthMax - domain.lengthMin) / countX
    const sy = (domain.widthMax - domain.widthMin) / countY
    const ix = clamp(Math.floor((selection.lengthMm - domain.lengthMin) / sx), 0, countX - 1)
    const iy = clamp(Math.floor((selection.widthMm - domain.widthMin) / sy), 0, countY - 1)
    const inside =
      selection.lengthMm >= domain.lengthMin &&
      selection.lengthMm <= domain.lengthMax &&
      selection.widthMm >= domain.widthMin &&
      selection.widthMm <= domain.widthMax
    return { ix, iy, inside }
  }, [selection, domain, countX, countY])

  const sourceIndex = useMemo(() => {
    if (!selectionIndex || !selectionIndex.inside) return -1
    return transport.sources.findIndex(
      (c) => c.ix === selectionIndex.ix && c.iy === selectionIndex.iy,
    )
  }, [selectionIndex, transport])

  const selectedFlows = useMemo(
    () => (sourceIndex >= 0 ? transport.flows.filter((f) => f.from === sourceIndex) : []),
    [sourceIndex, transport],
  )
  const selectedMass = sourceIndex >= 0 ? transport.sources[sourceIndex].mass : 0
  const selectedRecords = sourceIndex >= 0 ? selectedFlows.reduce((s, f) => s + f.mass, 0) : 0

  const hoverDensity = hover ? cellByKey.get(`${hover.ix},${hover.iy}`) : null
  const hoverSourceIndex = hover
    ? transport.sources.findIndex((c) => c.ix === hover.ix && c.iy === hover.iy)
    : -1
  const hoverSourceMass = hoverSourceIndex >= 0 ? transport.sources[hoverSourceIndex].mass : 0

  const x = (v: number) => M.left + ((v - domain.lengthMin) / (domain.lengthMax - domain.lengthMin)) * plotW
  const y = (v: number) => M.top + plotH - ((v - domain.widthMin) / (domain.widthMax - domain.widthMin)) * plotH

  const hitCell = (px: number, py: number) => {
    const ix = Math.floor((px - M.left) / stepX)
    const rowFromTop = Math.floor((py - M.top) / stepY)
    if (ix < 0 || ix >= countX || rowFromTop < 0 || rowFromTop >= countY) return null
    return { ix, iy: countY - 1 - rowFromTop }
  }

  const localPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      px: ((clientX - rect.left) / rect.width) * WIDTH,
      py: ((clientY - rect.top) / rect.height) * HEIGHT,
    }
  }

  const cellCenter = (ix: number, iy: number) => ({
    lengthMm: domain.lengthMin + (ix + 0.5) * (domain.lengthMax - domain.lengthMin) / countX,
    widthMm: domain.widthMin + (iy + 0.5) * (domain.widthMax - domain.widthMin) / countY,
  })

  const select = useCallback(
    (ix: number, iy: number) => {
      if (selectionIndex && selectionIndex.inside && selectionIndex.ix === ix && selectionIndex.iy === iy) {
        onSelectionChange(null)
      } else {
        const center = cellCenter(ix, iy)
        onSelectionChange({ direction, ...center })
      }
    },
    // cellCenter depends on the same values as selectionIndex
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectionIndex, onSelectionChange, direction, domain, countX, countY],
  )

  const onPointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const p = localPoint(event.clientX, event.clientY)
    if (!p) return
    const hit = hitCell(p.px, p.py)
    if (!hit) {
      setHover(null)
      return
    }
    setHover({ ...hit, px: p.px, py: p.py })
  }

  const onKeyDown = (event: React.KeyboardEvent<SVGRectElement>) => {
    // With nothing selected, start from the occupied source cell nearest the
    // grid centre so the first keypress lands on something with a flow to show.
    const base =
      selectionIndex ??
      transport.sources.reduce(
        (best, cell) => {
          const d =
            Math.abs(cell.ix - (countX - 1) / 2) + Math.abs(cell.iy - (countY - 1) / 2)
          return d < best.d ? { ix: cell.ix, iy: cell.iy, d } : best
        },
        { ix: Math.floor(countX / 2), iy: Math.floor(countY / 2), d: Infinity },
      )
    let { ix, iy } = base
    const wasEmpty = !selectionIndex
    switch (event.key) {
      case 'ArrowLeft':
        ix = Math.max(0, ix - 1)
        break
      case 'ArrowRight':
        ix = Math.min(countX - 1, ix + 1)
        break
      case 'ArrowUp':
        iy = Math.min(countY - 1, iy + 1)
        break
      case 'ArrowDown':
        iy = Math.max(0, iy - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        select(ix, iy)
        return
      case 'Escape':
        event.preventDefault()
        onSelectionChange(null)
        return
      default:
        return
    }
    event.preventDefault()
    // First arrow key selects the starting cell; later ones move from it.
    if (wasEmpty) {
      const start = cellCenter(base.ix, base.iy)
      onSelectionChange({ direction, ...start })
      return
    }
    const center = cellCenter(ix, iy)
    onSelectionChange({ direction, ...center })
  }

  const radiusFor = (mass: number) => {
    if (mass <= 0 || maxMass <= 0) return 0
    const maxR = Math.min(stepX, stepY) * 0.3
    return Math.max(1.8, maxR * Math.sqrt(mass / maxMass))
  }

  const xTicks = niceTicks(domain.lengthMin, domain.lengthMax, 6)
  const yTicks = niceTicks(domain.widthMin, domain.widthMax, 6)
  const nominalLeft = x(nominal.lengthMin)
  const nominalRight = x(nominal.lengthMax)
  const nominalTop = y(nominal.widthMax)
  const nominalBottom = y(nominal.widthMin)

  return (
    <div className="plot-wrap">
      <svg
        ref={svgRef}
        className="plot-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${sourceName} 到 ${sinkName} 的二维网格运输图，网格 ${countX} × ${countY}；点选有质量的格查看其去向`}
      >
        {showDensity &&
          density.map((d) => {
            const left = M.left + d.cell.ix * stepX
            const top = M.top + (countY - 1 - d.cell.iy) * stepY
            const a = d.massA
            const b = d.massB
            if (a <= 0 && b <= 0) return null
            const centerY = top + stepY / 2
            return (
              <g key={`d-${d.cell.ix}-${d.cell.iy}`} aria-hidden="true">
                <rect
                  x={left + 0.5}
                  y={top + 0.5}
                  width={stepX - 1}
                  height={stepY - 1}
                  rx={2}
                  fill="var(--text-primary)"
                  fillOpacity={0.035}
                />
                {a > 0 && (
                  <circle
                    cx={left + stepX * 0.29}
                    cy={centerY}
                    r={radiusFor(a)}
                    fill="var(--series-a)"
                    fillOpacity={0.72}
                    stroke="var(--surface-1)"
                    strokeWidth={1.25}
                  />
                )}
                {b > 0 && (
                  <circle
                    cx={left + stepX * 0.71}
                    cy={centerY}
                    r={radiusFor(b)}
                    fill="var(--series-b)"
                    fillOpacity={0.72}
                    stroke="var(--surface-1)"
                    strokeWidth={1.25}
                  />
                )}
              </g>
            )
          })}

        {outsideRecords.map((rec) => {
          if (rec.lengthMm === null || rec.widthMm === null) return null
          return (
            <circle
              key={`out-${rec.id}`}
              cx={x(rec.lengthMm)}
              cy={y(rec.widthMm)}
              r={7}
              fill="none"
              stroke="var(--warning)"
              strokeWidth={2}
              aria-hidden="true"
            />
          )
        })}

        <g aria-hidden="true">
          {Array.from({ length: countX + 1 }, (_, i) => (
            <line
              key={`gx-${i}`}
              x1={M.left + i * stepX}
              x2={M.left + i * stepX}
              y1={M.top}
              y2={M.top + plotH}
              stroke="var(--grid)"
              strokeWidth={0.7}
            />
          ))}
          {Array.from({ length: countY + 1 }, (_, i) => (
            <line
              key={`gy-${i}`}
              x1={M.left}
              x2={M.left + plotW}
              y1={M.top + i * stepY}
              y2={M.top + i * stepY}
              stroke="var(--grid)"
              strokeWidth={0.7}
            />
          ))}
        </g>

        {domain.expanded && (
          <g aria-hidden="true">
            <rect
              x={nominalLeft}
              y={nominalTop}
              width={nominalRight - nominalLeft}
              height={nominalBottom - nominalTop}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={1.25}
              strokeDasharray="5 4"
            />
            <text x={nominalLeft + 6} y={nominalBottom - 6} className="tick-label">
              名义量程（虚线内）
            </text>
          </g>
        )}

        {selectionIndex && (
          <rect
            x={M.left + selectionIndex.ix * stepX + 1.5}
            y={M.top + (countY - 1 - selectionIndex.iy) * stepY + 1.5}
            width={stepX - 3}
            height={stepY - 3}
            rx={3}
            fill="none"
            stroke={selectionIndex.inside ? 'var(--text-primary)' : 'var(--text-muted)'}
            strokeWidth={2}
            strokeDasharray={selectionIndex.inside ? undefined : '4 3'}
            aria-hidden="true"
          />
        )}

        {sourceIndex >= 0 && (
          <g aria-hidden="true">
            {selectedFlows.map((f) => {
              const src = transport.sources[sourceIndex]
              const sink = transport.sinks[f.to]
              const x1 = M.left + (src.ix + 0.5) * stepX
              const y1 = M.top + (countY - 1 - src.iy + 0.5) * stepY
              const x2 = M.left + (sink.ix + 0.5) * stepX
              const y2 = M.top + (countY - 1 - sink.iy + 0.5) * stepY
              const share = selectedMass > 0 ? f.mass / selectedMass : 0
              const same = src.ix === sink.ix && src.iy === sink.iy
              return (
                <g key={`f-${f.from}-${f.to}`}>
                  {!same && (
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="var(--text-primary)"
                      strokeOpacity={0.18 + 0.5 * share}
                      strokeWidth={1 + 4.5 * share}
                      strokeLinecap="round"
                    />
                  )}
                  <circle
                    cx={x2}
                    cy={y2}
                    r={Math.max(2.4, 3 + 6 * Math.sqrt(share))}
                    fill={same ? 'var(--text-muted)' : 'var(--text-primary)'}
                    fillOpacity={same ? 0.55 : 0.85}
                    stroke="var(--surface-1)"
                    strokeWidth={1.5}
                  />
                </g>
              )
            })}
          </g>
        )}

        <rect
          x={M.left}
          y={M.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          tabIndex={0}
          role="application"
          aria-label="网格交互区：方向键移动，回车选中或取消，Esc 清除选择"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          onClick={(event) => {
            const p = localPoint(event.clientX, event.clientY)
            if (!p) return
            const hit = hitCell(p.px, p.py)
            if (!hit) onSelectionChange(null)
            else select(hit.ix, hit.iy)
          }}
          onKeyDown={onKeyDown}
          style={{ cursor: 'crosshair', outline: 'none' }}
          className="grid-hit"
        />

        {hover && (
          <rect
            x={M.left + hover.ix * stepX}
            y={M.top + (countY - 1 - hover.iy) * stepY}
            width={stepX}
            height={stepY}
            fill="var(--text-primary)"
            fillOpacity={0.05}
            stroke="var(--text-secondary)"
            strokeWidth={1}
            pointerEvents="none"
            aria-hidden="true"
          />
        )}

        <g aria-hidden="true">
          <line x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} stroke="var(--axis)" />
          <line x1={M.left} x2={M.left} y1={M.top} y2={M.top + plotH} stroke="var(--axis)" />
          {xTicks.map((t) => (
            <g key={`tx-${t}`}>
              <line x1={x(t)} x2={x(t)} y1={M.top + plotH} y2={M.top + plotH + 4} stroke="var(--axis)" />
              <text x={x(t)} y={M.top + plotH + 17} textAnchor="middle" className="tick-label">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {yTicks.map((t) => (
            <g key={`ty-${t}`}>
              <line x1={M.left - 4} x2={M.left} y1={y(t)} y2={y(t)} stroke="var(--axis)" />
              <text x={M.left - 8} y={y(t) + 3.5} textAnchor="end" className="tick-label">
                {formatTick(t)}
              </text>
            </g>
          ))}
          <text x={M.left + plotW / 2} y={HEIGHT - 8} textAnchor="middle" className="axis-title">
            长度（mm）
          </text>
          <text
            x={15}
            y={M.top + plotH / 2}
            textAnchor="middle"
            className="axis-title"
            transform={`rotate(-90 15 ${M.top + plotH / 2})`}
          >
            宽度（mm）
          </text>
        </g>
      </svg>

      {hover && (
        <div
          className="tooltip"
          style={{
            left: `${(hover.px / WIDTH) * 100}%`,
            top: `${(hover.py / HEIGHT) * 100}%`,
            transform: hover.px > WIDTH * 0.68 ? 'translate(-108%, -50%)' : 'translate(14px, -50%)',
          }}
          role="status"
        >
          <div className="tt-value">格 ({hover.ix}, {hover.iy})</div>
          <div className="tt-row">
            <span className="legend-swatch" style={{ background: 'var(--series-a)' }} />
            <span className="tt-label">A</span>
            <strong>{fmtPercent(hoverDensity?.massA ?? 0, 2)}</strong>
            <span className="tt-label">· {hoverDensity?.countA ?? 0} 件</span>
          </div>
          <div className="tt-row">
            <span className="legend-swatch" style={{ background: 'var(--series-b)' }} />
            <span className="tt-label">B</span>
            <strong>{fmtPercent(hoverDensity?.massB ?? 0, 2)}</strong>
            <span className="tt-label">· {hoverDensity?.countB ?? 0} 件</span>
          </div>
          {hoverSourceMass > 0 && (
            <div className="tt-label" style={{ marginTop: 6 }}>
              {sourceName}在此有 {fmtPercent(hoverSourceMass, 2)} 质量可被搬移 · 点击查看去向
            </div>
          )}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {selection && selectionIndex
          ? `已选中格 (${selectionIndex.ix}, ${selectionIndex.iy})，${sourceName} 在此有 ${fmtPercent(
              selectedMass,
              2,
            )} 质量，分到 ${selectedFlows.length} 个目标格，合计 ${fmtPercent(
              selectedRecords,
              2,
            )}。`
          : '未选中任何格。'}
      </p>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function niceTicks(min: number, max: number, target: number): number[] {
  const span = max - min
  if (!(span > 0)) return [min]
  const raw = span / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const first = Math.ceil(min / step - 1e-9) * step
  const out: number[] = []
  for (let v = first; v <= max + step * 1e-6; v += step) out.push(Math.round(v / step) * step)
  return out
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  const decimals = Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 1
  return v.toLocaleString('zh-CN', { maximumFractionDigits: decimals })
}
