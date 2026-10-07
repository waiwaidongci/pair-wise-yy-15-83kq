export type BarcodeMode = 'none' | 'qr' | 'code128'
export type BorderStyle = 'solid' | 'dashed' | 'dotted'

export interface Specimen {
  id: string
  accessionNo: string
  taxonName: string
  scientificName: string
  locality: string
  collectedAt: string
  collector: string
  habitat: string
  notes: string
}

export interface LabelTemplate {
  id: string
  name: string
  paperWidthMm: number
  paperHeightMm: number
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
  columns: number
  rowHeightMm: number
  columnGapMm: number
  rowGapMm: number
  lineHeightMm: number
  fontSizePt: number
  borderWidthMm: number
  borderStyle: BorderStyle
  italicScientific: boolean
  barcodeMode: BarcodeMode
  includeCollection: boolean
  includeHabitat: boolean
  includeNotes: boolean
  updatedAt: string
}

export interface ValidationIssue {
  id: string
  specimenId: string
  field: keyof Specimen
  severity: 'error' | 'warning'
  message: string
}

export interface ImportResult {
  specimens: Specimen[]
  issues: ValidationIssue[]
  ignoredRows: number
}

export type BatchStatus = 'pending' | 'claimed' | 'done' | 'void'

export interface PrintBatch {
  id: string
  seq: number
  name: string
  templateId: string
  templateName: string
  /** 生成批次时的排版依据签名，改动后未领取批次立即失效 */
  layoutSignature: string
  listSignature: string
  paperWidthMm: number
  paperHeightMm: number
  columns: number
  labelsPerPage: number
  pagesPerBatch: number
  pageCount: number
  specimenIds: string[]
  status: BatchStatus
  createdAt: string
  voidReason?: string
}

export interface BatchClaim {
  id: string
  batchId: string
  librarian: string
  claimedAt: string
  /** 领取有时限，到期自动释放 */
  expiresAt: string
  /** 领取时刻固定的纸张栏数与清单快照 */
  templateSnapshot: LabelTemplate
  specimenSnapshot: Specimen[]
}

export interface PrintReceipt {
  id: string
  batchId: string
  batchName: string
  librarian: string
  printedAt: string
  templateName: string
  paperWidthMm: number
  paperHeightMm: number
  columns: number
  pageCount: number
  labelCount: number
  firstAccession: string
  lastAccession: string
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: string }
