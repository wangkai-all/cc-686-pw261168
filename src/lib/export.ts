export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null>>) {
  const escape = (value: string | number | null) => {
    if (value === null || value === undefined) return ''
    const s = String(value)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [header.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))]
  // BOM so spreadsheet apps detect UTF-8 and render Chinese correctly.
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
