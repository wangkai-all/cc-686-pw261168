import type { LengthUnit } from './types'

/** Factor converting one of `unit` into millimetres. */
export const MM_PER_UNIT: Record<LengthUnit, number> = {
  um: 0.001,
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
}

export const UNIT_LABEL: Record<LengthUnit, string> = {
  um: 'µm',
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  in: 'in',
}

const ALIASES: Record<string, LengthUnit> = {
  um: 'um',
  'µm': 'um',
  'μm': 'um',
  micrometer: 'um',
  micrometre: 'um',
  mm: 'mm',
  millimeter: 'mm',
  millimetre: 'mm',
  cm: 'cm',
  centimeter: 'cm',
  centimetre: 'cm',
  m: 'm',
  meter: 'm',
  metre: 'm',
  in: 'in',
  inch: 'in',
  inches: 'in',
  '"': 'in',
}

export function parseUnit(raw: string): LengthUnit | null {
  const key = raw.trim().toLowerCase()
  return ALIASES[key] ?? null
}

export function factorsFor(lengthUnit: LengthUnit, widthUnit: LengthUnit) {
  return { lengthMm: MM_PER_UNIT[lengthUnit], widthMm: MM_PER_UNIT[widthUnit] }
}

export function parseNumber(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  // Accept a decimal comma only when there is no dot, and strip thin spaces.
  const cleaned = /^\d+,\d+$/.test(t) ? t.replace(',', '.') : t.replace(/[\s ]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) {
    return value.toExponential(2)
  }
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtCompact(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

export function fmtPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`
}
