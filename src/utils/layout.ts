import type { BarcodeMode, LabelTemplate, Specimen } from '../types/label'

export function rowsPerPage(template: LabelTemplate) {
  const contentHeight =
    template.paperHeightMm - template.marginTopMm - template.marginBottomMm
  return Math.max(1, Math.floor((contentHeight + template.rowGapMm) / (template.rowHeightMm + template.rowGapMm)))
}

export function labelsPerPage(template: LabelTemplate) {
  return Math.max(1, template.columns * rowsPerPage(template))
}

export function paginateSpecimens(specimens: Specimen[], template: LabelTemplate) {
  const perPage = labelsPerPage(template)
  const pages: Specimen[][] = []
  for (let index = 0; index < specimens.length; index += perPage) {
    pages.push(specimens.slice(index, index + perPage))
  }
  return pages.length ? pages : [[]]
}

export function formatDate(value: string) {
  if (!value) return '日期待补'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

export function scientificFontScale(name: string, template: LabelTemplate) {
  const availableMm = labelInnerWidth(template) - 4
  const estimatedWidth = name.length * template.fontSizePt * 0.19
  if (estimatedWidth <= availableMm) return 1
  return Math.max(0.74, availableMm / estimatedWidth)
}

export function labelInnerWidth(template: LabelTemplate) {
  const contentWidth =
    template.paperWidthMm - template.marginLeftMm - template.marginRightMm
  return (
    contentWidth -
    (template.columns - 1) * template.columnGapMm
  ) / template.columns
}

export function barcodeLabel(mode: BarcodeMode) {
  if (mode === 'qr') return '二维码'
  if (mode === 'code128') return 'Code 128'
  return '不打印'
}

export function safeFilePart(value: string) {
  return value.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/-+/g, '-')
}

/** \u6392\u7248\u4f9d\u636e\u7b7e\u540d\uff1a\u4efb\u4f55\u5f71\u54cd\u6210\u54c1\u7684\u7248\u9762\u5b57\u6bb5\u53d8\u5316\u90fd\u4f1a\u5f97\u5230\u4e0d\u540c\u7b7e\u540d */
export function layoutSignature(template: LabelTemplate) {
  return JSON.stringify([
    template.paperWidthMm,
    template.paperHeightMm,
    template.marginTopMm,
    template.marginRightMm,
    template.marginBottomMm,
    template.marginLeftMm,
    template.columns,
    template.rowHeightMm,
    template.columnGapMm,
    template.rowGapMm,
    template.lineHeightMm,
    template.fontSizePt,
    template.borderWidthMm,
    template.borderStyle,
    template.italicScientific,
    template.barcodeMode,
    template.includeCollection,
    template.includeHabitat,
    template.includeNotes,
  ])
}

/** \u6e05\u5355\u7b7e\u540d\uff1a\u8bb0\u5f55 id \u7684\u6709\u5e8f\u5e8f\u5217\uff0c\u589e\u5220\u6216\u8c03\u5e8f\u90fd\u4f1a\u53d8\u5316 */
export function listSignature(specimens: Specimen[]) {
  return specimens.map((item) => item.id).join('|')
}
