/**
 * Small RFC-4180-ish CSV reader. Local inspection exports use comma
 * separators and may quote notes containing commas; no delimiter sniffing.
 */
export interface ParsedCsv {
  header: string[]
  rows: string[][]
}

export class CsvError extends Error {}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, '')
  const table: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    // Skip purely blank physical lines.
    if (row.some((cell) => cell.trim() !== '')) table.push(row)
    row = []
  }

  while (i < clean.length) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      if (field.trim() !== '') {
        throw new CsvError('CSV 引号出现在字段中间，无法解析')
      }
      field = ''
      quoted = true
      i += 1
      continue
    }
    if (ch === ',') {
      pushField()
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      pushRow()
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (quoted) throw new CsvError('CSV 末尾存在未闭合的引号')
  if (field !== '' || row.length > 0) pushRow()

  if (table.length === 0) throw new CsvError('CSV 为空')
  const header = table[0].map((h) => h.trim().toLowerCase())
  return { header, rows: table.slice(1) }
}

const REQUIRED = ['id', 'batch', 'length', 'width', 'length_unit', 'width_unit', 'weight'] as const

export interface CsvRecordRow {
  line: number
  id: string
  batch: string
  lengthRaw: string
  widthRaw: string
  lengthUnitRaw: string
  widthUnitRaw: string
  weightRaw: string
  note: string
}

export function toRecordRows(csv: ParsedCsv): CsvRecordRow[] {
  const index = new Map<string, number>()
  csv.header.forEach((name, i) => {
    if (!index.has(name)) index.set(name, i)
  })
  const missing = REQUIRED.filter((name) => !index.has(name))
  if (missing.length > 0) {
    throw new CsvError(`CSV 缺少列：${missing.join('、')}`)
  }
  const get = (row: string[], name: string) => {
    const at = index.get(name)
    return at === undefined ? '' : (row[at] ?? '')
  }
  return csv.rows.map((row, i) => ({
    // +2: one for the header, one for 1-based line numbers.
    line: i + 2,
    id: get(row, 'id').trim(),
    batch: get(row, 'batch').trim(),
    lengthRaw: get(row, 'length'),
    widthRaw: get(row, 'width'),
    lengthUnitRaw: get(row, 'length_unit'),
    widthUnitRaw: get(row, 'width_unit'),
    weightRaw: get(row, 'weight'),
    note: get(row, 'note').trim(),
  }))
}
