import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLabelStore } from './labelStore'
import type { LabelTemplate } from '../types/label'
import type {
  ClaimResult,
  Librarian,
  PrintBatch,
  PrintReceipt,
  PrintResult,
} from '../types/batch'
import { labelsPerPage } from '../utils/layout'

const STORAGE_KEY = 'pair-wise-yy-15-print-batches'
/** 领取租约时长：5 分钟，超时自动释放回批次池 */
const LEASE_MS = 5 * 60 * 1000
const TICK_MS = 1000

export const LIBRARIANS: Librarian[] = [
  { id: 'lib-shen', name: '馆员·沈砚' },
  { id: 'lib-meng', name: '馆员·孟川' },
  { id: 'lib-zhao', name: '馆员·赵禾' },
]

interface PersistShape {
  batches: PrintBatch[]
  receipts: PrintReceipt[]
  currentLibrarianId: string
}

export function layoutKeyOf(template: LabelTemplate) {
  return [
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
  ].join('|')
}

export function paperSpecOf(template: LabelTemplate) {
  return `${template.paperWidthMm}×${template.paperHeightMm}mm · ${template.columns}栏`
}

export function fmtTime(iso: string) {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

export function fmtDateTime(iso: string) {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${fmtTime(iso)}`
}

function loadPersisted(): PersistShape | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistShape) : null
  } catch {
    return null
  }
}

export const usePrintBatchStore = defineStore('print-batch', () => {
  const labelStore = useLabelStore()
  const persisted = loadPersisted()

  const batches = ref<PrintBatch[]>(persisted?.batches ?? [])
  const receipts = ref<PrintReceipt[]>(persisted?.receipts ?? [])
  const currentLibrarianId = ref(persisted?.currentLibrarianId ?? LIBRARIANS[0].id)
  const now = ref(Date.now())

  const currentLibrarian = computed<Librarian>(
    () => LIBRARIANS.find((item) => item.id === currentLibrarianId.value) ?? LIBRARIANS[0],
  )
  const currentLayoutKey = computed(() => layoutKeyOf(labelStore.activeTemplate))
  const capacity = computed(() => labelsPerPage(labelStore.activeTemplate))

  const pendingBatches = computed(() => batches.value.filter((item) => item.status === 'pending'))
  const claimedBatches = computed(() => batches.value.filter((item) => item.status === 'claimed'))
  const printedBatches = computed(() => batches.value.filter((item) => item.status === 'printed'))
  const staleBatches = computed(() => batches.value.filter((item) => item.status === 'stale'))
  const hasStale = computed(() => staleBatches.value.length > 0)

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        batches: batches.value,
        receipts: receipts.value,
        currentLibrarianId: currentLibrarianId.value,
      }),
    )
  }

  function isLeaseActive(batch: PrintBatch) {
    return !!batch.claim && new Date(batch.claim.expiresAt).getTime() > now.value
  }

  function remainingLeaseMs(batch: PrintBatch) {
    if (!batch.claim) return 0
    return Math.max(0, new Date(batch.claim.expiresAt).getTime() - now.value)
  }

  function leaseCountdown(batch: PrintBatch) {
    const ms = remainingLeaseMs(batch)
    if (ms <= 0) return '00:00'
    const total = Math.floor(ms / 1000)
    const minute = Math.floor(total / 60)
    const second = total % 60
    return `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
  }

  /** 排版依据变化后，未领取批次立即失效 */
  function invalidatePending(reason: string) {
    let changed = false
    batches.value.forEach((batch) => {
      if (batch.status === 'pending' && batch.layoutKey !== currentLayoutKey.value) {
        batch.status = 'stale'
        batch.staleReason = reason
        changed = true
      }
    })
    if (changed) persist()
  }

  // 跨会话载入后先对账一次：排版已变则未领取批次失效
  invalidatePending('排版已变更，批次容量变化，已失效')

  watch(currentLayoutKey, () => {
    invalidatePending('排版已变更，批次容量变化，已失效')
  })

  // 每秒走动：驱动租约倒计时，并在租约到期时把批次释放回待领取池
  setInterval(() => {
    now.value = Date.now()
    let changed = false
    batches.value.forEach((batch) => {
      if (
        batch.status === 'claimed' &&
        batch.claim &&
        new Date(batch.claim.expiresAt).getTime() <= Date.now()
      ) {
        batch.status = 'pending'
        batch.claim = null
        changed = true
      }
    })
    if (changed) persist()
  }, TICK_MS)

  /**
   * 按当前排版把“尚未被领取/打印”的标本重新排进批次。
   * 已领取或已打印的批次保留不动；超出纸张容量的标签自然排队到下一批。
   */
  function generateBatches() {
    const template = labelStore.activeTemplate
    const cap = labelsPerPage(template)
    const busy = new Set<string>()
    batches.value.forEach((batch) => {
      if (batch.status === 'claimed' || batch.status === 'printed') {
        batch.specimens.forEach((specimen) => busy.add(specimen.id))
      }
    })
    const remaining = labelStore.specimens.filter((specimen) => !busy.has(specimen.id))

    // 清掉待领取与已失效批次，重新规划；保留领取中与已打印
    batches.value = batches.value.filter(
      (batch) => batch.status !== 'pending' && batch.status !== 'stale',
    )
    const baseSeq = batches.value.reduce((max, batch) => Math.max(max, batch.seq), 0)
    const key = layoutKeyOf(template)
    const created: PrintBatch[] = []
    for (let index = 0; index < remaining.length; index += cap) {
      const chunk = remaining.slice(index, index + cap)
      created.push({
        id: crypto.randomUUID(),
        seq: baseSeq + created.length + 1,
        status: 'pending',
        layoutKey: key,
        templateSnapshot: { ...template },
        specimens: chunk,
        pageCount: 1,
        capacity: cap,
        claim: null,
        receiptId: null,
        createdAt: new Date().toISOString(),
      })
    }
    batches.value.push(...created)
    persist()
    return created.length
  }

  /** 领取：固定当时的纸张栏数与清单，先到者拿到有时限的租约 */
  function claimBatch(batchId: string, librarian: Librarian): ClaimResult {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch) return { outcome: 'unavailable', reason: '批次不存在或已被移除' }
    if (batch.status === 'printed') return { outcome: 'unavailable', reason: '该批次已打印，回执已生成' }
    if (batch.status === 'stale' || batch.layoutKey !== currentLayoutKey.value) {
      batch.status = 'stale'
      batch.staleReason = '排版已变更，批次容量变化，已失效'
      persist()
      return { outcome: 'unavailable', reason: '排版已变更，该批次已失效，请重新生成批次' }
    }
    if (batch.claim && new Date(batch.claim.expiresAt).getTime() > Date.now()) {
      return {
        outcome: 'occupied',
        reason: `该批次已被 ${batch.claim.holderName} 领取，租约至 ${fmtTime(batch.claim.expiresAt)}`,
        holderName: batch.claim.holderName,
        expiresAt: batch.claim.expiresAt,
      }
    }
    const nowMs = Date.now()
    batch.claim = {
      holderId: librarian.id,
      holderName: librarian.name,
      claimedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + LEASE_MS).toISOString(),
    }
    batch.status = 'claimed'
    batch.templateSnapshot = { ...labelStore.activeTemplate }
    persist()
    return { outcome: 'granted', batch }
  }

  function releaseBatch(batchId: string, librarian: Librarian): ClaimResult {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch) return { outcome: 'unavailable', reason: '批次不存在' }
    if (batch.status !== 'claimed' || !batch.claim) {
      return { outcome: 'unavailable', reason: '该批次未被领取' }
    }
    if (batch.claim.holderId !== librarian.id) {
      return {
        outcome: 'unavailable',
        reason: `该批次由 ${batch.claim.holderName} 领取，仅本人可放弃`,
      }
    }
    batch.status = 'pending'
    batch.claim = null
    persist()
    return { outcome: 'granted', batch }
  }

  /** 打印：校验领取人与租约，生成成品回执并保留 */
  function printBatch(batchId: string, librarian: Librarian): PrintResult {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch) return { ok: false, reason: '批次不存在' }
    if (batch.status === 'printed') return { ok: false, reason: '该批次已打印' }
    if (batch.status !== 'claimed' || !batch.claim) {
      return { ok: false, reason: '请先领取该批次再打印' }
    }
    if (batch.claim.holderId !== librarian.id) {
      return { ok: false, reason: `该批次由 ${batch.claim.holderName} 领取，仅本人可打印` }
    }
    if (new Date(batch.claim.expiresAt).getTime() <= Date.now()) {
      batch.status = 'pending'
      batch.claim = null
      persist()
      return { ok: false, reason: '领取租约已过期，请重新领取' }
    }
    const receipt: PrintReceipt = {
      id: crypto.randomUUID(),
      receiptNo: `RCP-${new Date().getFullYear()}-${String(receipts.value.length + 1).padStart(4, '0')}`,
      batchId: batch.id,
      batchSeq: batch.seq,
      templateName: batch.templateSnapshot.name,
      paperSpec: paperSpecOf(batch.templateSnapshot),
      columns: batch.templateSnapshot.columns,
      specimenCount: batch.specimens.length,
      pageCount: batch.pageCount,
      printedAt: new Date().toISOString(),
      printedBy: librarian.name,
      templateSnapshot: { ...batch.templateSnapshot },
      specimens: [...batch.specimens],
    }
    receipts.value.unshift(receipt)
    batch.status = 'printed'
    batch.receiptId = receipt.id
    batch.claim = null
    persist()
    return { ok: true, receipt, batch }
  }

  function clearStale() {
    batches.value = batches.value.filter((batch) => batch.status !== 'stale')
    persist()
  }

  function removeReceipt(id: string) {
    receipts.value = receipts.value.filter((receipt) => receipt.id !== id)
    persist()
  }

  function setLibrarian(id: string) {
    if (!LIBRARIANS.some((item) => item.id === id)) return
    currentLibrarianId.value = id
    persist()
  }

  function getReceipt(id: string) {
    return receipts.value.find((receipt) => receipt.id === id)
  }

  return {
    LIBRARIANS,
    batches,
    receipts,
    currentLibrarianId,
    currentLibrarian,
    currentLayoutKey,
    capacity,
    pendingBatches,
    claimedBatches,
    printedBatches,
    staleBatches,
    hasStale,
    now,
    isLeaseActive,
    remainingLeaseMs,
    leaseCountdown,
    generateBatches,
    claimBatch,
    releaseBatch,
    printBatch,
    clearStale,
    removeReceipt,
    setLibrarian,
    getReceipt,
    layoutKeyOf,
    paperSpecOf,
    fmtTime,
    fmtDateTime,
  }
})
