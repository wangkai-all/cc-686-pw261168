import type { ProcessedRecord, WeightedStats } from './types'

/** Weighted descriptive statistics over records already routed into the grid. */
export function weightedStats(records: ProcessedRecord[]): WeightedStats | null {
  const usable = records.filter(
    (r) =>
      r.status === 'included' &&
      r.lengthMm !== null &&
      r.widthMm !== null &&
      r.weight !== null &&
      r.weight > 0,
  )
  if (usable.length === 0) return null
  let sw = 0
  let sx = 0
  let sy = 0
  for (const r of usable) {
    const w = r.weight as number
    sw += w
    sx += w * (r.lengthMm as number)
    sy += w * (r.widthMm as number)
  }
  const mx = sx / sw
  const my = sy / sw
  let vx = 0
  let vy = 0
  let cov = 0
  for (const r of usable) {
    const w = r.weight as number
    const dx = (r.lengthMm as number) - mx
    const dy = (r.widthMm as number) - my
    vx += w * dx * dx
    vy += w * dy * dy
    cov += w * dx * dy
  }
  vx /= sw
  vy /= sw
  cov /= sw
  const sdLength = Math.sqrt(Math.max(0, vx))
  const sdWidth = Math.sqrt(Math.max(0, vy))
  const corr = sdLength > 0 && sdWidth > 0 ? cov / (sdLength * sdWidth) : 0
  return {
    count: usable.length,
    weight: sw,
    meanLength: mx,
    meanWidth: my,
    sdLength,
    sdWidth,
    corr,
  }
}

/**
 * Mean of the raw recorded numbers, deliberately ignoring units. Used only to
 * demonstrate why unit alignment is required — never for analysis.
 */
export function rawNumericMean(records: ProcessedRecord[]): { length: number; width: number } | null {
  const usable = records.filter(
    (r) =>
      r.status === 'included' &&
      r.weight !== null &&
      r.weight > 0 &&
      r.lengthRaw.trim() !== '' &&
      r.widthRaw.trim() !== '',
  )
  let sw = 0
  let sx = 0
  let sy = 0
  let n = 0
  for (const r of usable) {
    const x = Number(r.lengthRaw)
    const y = Number(r.widthRaw)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const w = r.weight as number
    sw += w
    sx += w * x
    sy += w * y
    n += 1
  }
  if (n === 0 || sw <= 0) return null
  return { length: sx / sw, width: sy / sw }
}
