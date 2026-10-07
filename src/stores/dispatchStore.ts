import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLabelStore } from './labelStore'
import type {
  BatchClaim,
  ClaimResult,
  PrintBatch,
  PrintReceipt,
} from '../types/label'
import { labelsPerPage, layoutSignature, listSignature } from '../utils/layout'

const DISPATCH_KEY = 'pair-wise-yy-15-dispatch'
/** 领取时限：10 分钟，到期自动释放 */
export const CLAIM_TTL_MS = 10 * 60 * 1000

interface DispatchState {
  batches: PrintBatch[]
  claims: BatchClaim[]
  receipts: PrintReceipt[]
  pagesPerBatch: number
  batchSeq: number
}

function emptyState(): DispatchState {
  return { batches: [], claims: [], receipts: [], pagesPerBatch: 2, batchSeq: 0 }
}

/** localStorage 是各标签页共享的唯一事实来源，领取等操作都基于新鲜读取 */
function loadState(): DispatchState {
  try {
    const raw = localStorage.getItem(DISPATCH_KEY)
    if (!raw) return emptyState()
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<DispatchState>) }
  } catch {
    return emptyState()
  }
}

function writeState(state: DispatchState) {
  localStorage.setItem(DISPATCH_KEY, JSON.stringify(state))
}

function isClaimActive(claim: BatchClaim, now: number) {
  return new Date(claim.expiresAt).getTime() > now
}

/** 清理过期领取：批次回到待领取。返回是否有改动 */
function releaseExpiredInState(state: DispatchState, now: number) {
  const expired = state.claims.filter((claim) => !isClaimActive(claim, now))
  if (!expired.length) return false
  const expiredIds = new Set(expired.map((claim) => claim.id))
  state.claims = state.claims.filter((claim) => !expiredIds.has(claim.id))
  for (const claim of expired) {
    const batch = state.batches.find((item) => item.id === claim.batchId)
    if (batch && batch.status === 'claimed') batch.status = 'pending'
  }
  return true
}

export const useDispatchStore = defineStore('label-dispatch', () => {
  const labelStore = useLabelStore()
  const initial = loadState()
  releaseExpiredInState(initial, Date.now())

  const batches = ref<PrintBatch[]>(initial.batches)
  const claims = ref<BatchClaim[]>(initial.claims)
  const receipts = ref<PrintReceipt[]>(initial.receipts)
  const pagesPerBatch = ref(initial.pagesPerBatch)
  const batchSeq = ref(initial.batchSeq)

  function currentState(): DispatchState {
    return {
      batches: batches.value,
      claims: claims.value,
      receipts: receipts.value,
      pagesPerBatch: pagesPerBatch.value,
      batchSeq: batchSeq.value,
    }
  }

  function applyState(state: DispatchState) {
    batches.value = state.batches
    claims.value = state.claims
    receipts.value = state.receipts
    pagesPerBatch.value = state.pagesPerBatch
    batchSeq.value = state.batchSeq
  }

  function persist() {
    writeState(currentState())
  }

  // 其他标签页（其他馆员）的改动实时同步进来
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== DISPATCH_KEY) return
      applyState(loadState())
    })
  }

  const currentLayoutSignature = computed(() => layoutSignature(labelStore.activeTemplate))
  const currentListSignature = computed(() => listSignature(labelStore.specimens))

  /** 排版依据或清单一改动，未领取批次立即失效（已领取的按快照继续，回执保留） */
  function invalidatePendingBatches() {
    let changed = false
    for (const batch of batches.value) {
      if (batch.status !== 'pending') continue
      const layoutChanged = batch.layoutSignature !== currentLayoutSignature.value
      const listChanged = batch.listSignature !== currentListSignature.value
      if (!layoutChanged && !listChanged) continue
      batch.status = 'void'
      batch.voidReason = layoutChanged
        ? '版面参数已改动，页数需按新版面重算'
        : '标本清单已改动，页数需按新清单重算'
      changed = true
    }
    if (changed) persist()
  }

  watch(
    [currentLayoutSignature, currentListSignature],
    () => invalidatePendingBatches(),
    // 同步刷新：排版依据一改动，未领取批次立即失效
    { immediate: true, flush: 'sync' },
  )

  const perPage = computed(() => labelsPerPage(labelStore.activeTemplate))
  const batchCapacity = computed(() => perPage.value * pagesPerBatch.value)
  const plannedBatchCount = computed(() =>
    labelStore.specimens.length ? Math.ceil(labelStore.specimens.length / batchCapacity.value) : 0,
  )

  const sortedBatches = computed(() => [...batches.value].sort((a, b) => b.seq - a.seq))
  const sortedReceipts = computed(() =>
    [...receipts.value].sort((a, b) => b.printedAt.localeCompare(a.printedAt)),
  )

  function claimFor(batchId: string, now = Date.now()) {
    return claims.value.find((claim) => claim.batchId === batchId && isClaimActive(claim, now))
  }

  /** 释放到期领取，返回释放数量 */
  function releaseExpiredClaims() {
    const state = loadState()
    if (!releaseExpiredInState(state, Date.now())) return 0
    writeState(state)
    applyState(state)
    return 1
  }

  function setPagesPerBatch(value: number) {
    pagesPerBatch.value = Math.min(10, Math.max(1, Math.round(value) || 1))
    persist()
  }

  /** 生成批次：超出每批纸张容量的标签依次排入下一批；旧的未领取批次被取代 */
  function generateBatches() {
    releaseExpiredClaims()
    const specimens = labelStore.specimens
    if (!specimens.length) return 0
    const template = labelStore.activeTemplate
    const perBatch = perPage.value * pagesPerBatch.value
    const layoutSig = currentLayoutSignature.value
    const listSig = currentListSignature.value
    for (const batch of batches.value) {
      if (batch.status !== 'pending') continue
      batch.status = 'void'
      batch.voidReason = '已被新的发放批次取代'
    }
    const created: PrintBatch[] = []
    for (let offset = 0; offset < specimens.length; offset += perBatch) {
      const slice = specimens.slice(offset, offset + perBatch)
      batchSeq.value += 1
      created.push({
        id: crypto.randomUUID(),
        seq: batchSeq.value,
        name: `批次 ${String(batchSeq.value).padStart(2, '0')}`,
        templateId: template.id,
        templateName: template.name,
        layoutSignature: layoutSig,
        listSignature: listSig,
        paperWidthMm: template.paperWidthMm,
        paperHeightMm: template.paperHeightMm,
        columns: template.columns,
        labelsPerPage: perPage.value,
        pagesPerBatch: pagesPerBatch.value,
        pageCount: Math.ceil(slice.length / perPage.value),
        specimenIds: slice.map((item) => item.id),
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
    }
    batches.value = [...batches.value, ...created]
    persist()
    return created.length
  }

  /**
   * 领取批次：先读共享存储再判定再写入，同一批次只有先到者能拿到；
   * 后到者得到占用原因。领取成功即固定当时的纸张栏数与清单快照。
   */
  function claimBatch(batchId: string, librarian: string): ClaimResult {
    const state = loadState()
    const now = Date.now()
    releaseExpiredInState(state, now)
    const batch = state.batches.find((item) => item.id === batchId)
    if (!batch) return { ok: false, reason: '批次不存在或已被移除' }
    if (batch.status === 'void') {
      applyState(state)
      return { ok: false, reason: `批次已失效：${batch.voidReason ?? '排版依据已改动'}` }
    }
    if (batch.status === 'done') return { ok: false, reason: '批次已完成打印并登记回执' }
    const holder = state.claims.find((claim) => claim.batchId === batchId)
    if (holder) {
      applyState(state)
      return {
        ok: false,
        reason: `批次正被 ${holder.librarian} 占用打印，领取时限至 ${formatClock(holder.expiresAt)}，到期后自动释放`,
      }
    }
    if (
      batch.layoutSignature !== currentLayoutSignature.value ||
      batch.listSignature !== currentListSignature.value
    ) {
      batch.status = 'void'
      batch.voidReason = '排版依据已改动，领取时校验未通过'
      writeState(state)
      applyState(state)
      return { ok: false, reason: '排版依据刚刚改动，该批次已失效，请按新版面重新生成批次' }
    }

    const snapshotSpecimens = labelStore.specimens
      .filter((item) => batch.specimenIds.includes(item.id))
      .map((item) => ({ ...item }))
    const claim: BatchClaim = {
      id: crypto.randomUUID(),
      batchId,
      librarian,
      claimedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CLAIM_TTL_MS).toISOString(),
      templateSnapshot: { ...labelStore.activeTemplate },
      specimenSnapshot: snapshotSpecimens,
    }
    batch.status = 'claimed'
    state.claims.push(claim)
    writeState(state)

    // 写入后复核：若另一标签页同时抢到，只保留最早的一笔领取
    const verify = loadState()
    const contenders = verify.claims
      .filter((item) => item.batchId === batchId)
      .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt))
    const winner = contenders[0]
    if (winner && winner.id !== claim.id) {
      verify.claims = verify.claims.filter((item) => item.batchId !== batchId || item.id === winner.id)
      writeState(verify)
      applyState(verify)
      return {
        ok: false,
        reason: `批次正被 ${winner.librarian} 占用打印，领取时限至 ${formatClock(winner.expiresAt)}，到期后自动释放`,
      }
    }
    applyState(verify)
    return { ok: true }
  }

  /** 放弃领取：批次回到待领取队列 */
  function releaseClaim(claimId: string) {
    const state = loadState()
    const claim = state.claims.find((item) => item.id === claimId)
    if (!claim) return
    state.claims = state.claims.filter((item) => item.id !== claimId)
    const batch = state.batches.find((item) => item.id === claim.batchId)
    if (batch && batch.status === 'claimed') batch.status = 'pending'
    writeState(state)
    applyState(state)
  }

  /** 完成打印：按领取时的快照登记成品回执，回执永久保留 */
  function completeClaim(claimId: string): PrintReceipt | null {
    const state = loadState()
    const claim = state.claims.find((item) => item.id === claimId)
    if (!claim) return null
    const batch = state.batches.find((item) => item.id === claim.batchId)
    if (batch) batch.status = 'done'
    state.claims = state.claims.filter((item) => item.id !== claimId)
    const snapshot = claim.specimenSnapshot
    const receipt: PrintReceipt = {
      id: crypto.randomUUID(),
      batchId: claim.batchId,
      batchName: batch?.name ?? '未知批次',
      librarian: claim.librarian,
      printedAt: new Date().toISOString(),
      templateName: claim.templateSnapshot.name,
      paperWidthMm: claim.templateSnapshot.paperWidthMm,
      paperHeightMm: claim.templateSnapshot.paperHeightMm,
      columns: claim.templateSnapshot.columns,
      pageCount: batch?.pageCount ?? Math.ceil(snapshot.length / Math.max(1, labelsPerPage(claim.templateSnapshot))),
      labelCount: snapshot.length,
      firstAccession: snapshot[0]?.accessionNo ?? '',
      lastAccession: snapshot[snapshot.length - 1]?.accessionNo ?? '',
    }
    state.receipts.push(receipt)
    writeState(state)
    applyState(state)
    return receipt
  }

  function formatClock(iso: string) {
    const date = new Date(iso)
    return [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map((value) => String(value).padStart(2, '0'))
      .join(':')
  }

  return {
    batches,
    claims,
    receipts,
    pagesPerBatch,
    sortedBatches,
    sortedReceipts,
    perPage,
    batchCapacity,
    plannedBatchCount,
    claimFor,
    releaseExpiredClaims,
    setPagesPerBatch,
    generateBatches,
    claimBatch,
    releaseClaim,
    completeClaim,
    invalidatePendingBatches,
  }
})
