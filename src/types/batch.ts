import type { LabelTemplate, Specimen } from './label'

export type BatchStatus = 'pending' | 'claimed' | 'printed' | 'stale'

export type ClaimOutcome = 'granted' | 'occupied' | 'unavailable'

export interface BatchClaim {
  holderId: string
  holderName: string
  claimedAt: string
  expiresAt: string
}

export interface PrintBatch {
  id: string
  seq: number
  status: BatchStatus
  /** 生成时排版依据的指纹；模板改动后未领取批次据此失效 */
  layoutKey: string
  /** 领取/生成时固定的纸张栏数与排版参数 */
  templateSnapshot: LabelTemplate
  /** 领取/生成时固定的清单 */
  specimens: Specimen[]
  pageCount: number
  /** 每张纸可容纳的标签数（栏数 × 每页行数） */
  capacity: number
  claim: BatchClaim | null
  receiptId: string | null
  createdAt: string
  staleReason?: string
}

export interface PrintReceipt {
  id: string
  receiptNo: string
  batchId: string
  batchSeq: number
  templateName: string
  paperSpec: string
  columns: number
  specimenCount: number
  pageCount: number
  printedAt: string
  printedBy: string
  /** 打印时固定的排版依据，便于留存与再次打印 */
  templateSnapshot: LabelTemplate
  specimens: Specimen[]
}

export interface Librarian {
  id: string
  name: string
}

export interface ClaimResult {
  outcome: ClaimOutcome
  batch?: PrintBatch
  reason?: string
  holderName?: string
  expiresAt?: string
}

export interface PrintResult {
  ok: boolean
  reason?: string
  receipt?: PrintReceipt
  batch?: PrintBatch
}
