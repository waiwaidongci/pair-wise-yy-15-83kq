<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import {
  AssignmentCheckedIcon,
  CheckCircleIcon,
  FileBlockedIcon,
  LockOffIcon,
  LockTimeIcon,
  PrintIcon,
  QueueIcon,
  SendIcon,
  TaskCheckedIcon,
  UsergroupIcon,
} from 'tdesign-icons-vue-next'
import { usePrintBatchStore } from '../stores/printBatchStore'
import { useLabelStore } from '../stores/labelStore'
import { openPrintableHtml } from '../utils/exporters'
import type { PrintBatch, PrintReceipt, ClaimResult, Librarian } from '../types/batch'

const store = usePrintBatchStore()
const labelStore = useLabelStore()

const currentTemplate = computed(() => labelStore.activeTemplate)
const totalSpecimens = computed(() => labelStore.specimens.length)

const receiptOpen = ref(false)
const activeReceipt = ref<PrintReceipt | null>(null)

interface ConcurrentRow {
  librarian: Librarian
  result: ClaimResult
}
const concurrentRows = ref<ConcurrentRow[]>([])

function generate() {
  const count = store.generateBatches()
  if (count > 0) {
    MessagePlugin.success(`已按当前排版生成 ${count} 个待领取批次`)
  } else {
    MessagePlugin.info('没有可排入批次的标本（可能都在已领取或已打印批次中）')
  }
}

function onClaim(batch: PrintBatch) {
  const result = store.claimBatch(batch.id, store.currentLibrarian)
  if (result.outcome === 'granted') {
    MessagePlugin.success(`已领取第 ${batch.seq} 批，租约 5 分钟，超时自动释放`)
  } else if (result.outcome === 'occupied') {
    MessagePlugin.warning(result.reason || '该批次已被领取')
  } else {
    MessagePlugin.error(result.reason || '领取失败')
  }
}

function onRelease(batch: PrintBatch) {
  const result = store.releaseBatch(batch.id, store.currentLibrarian)
  if (result.outcome === 'granted') {
    MessagePlugin.success(`已放弃第 ${batch.seq} 批，批次回到待领取池`)
  } else {
    MessagePlugin.error(result.reason || '操作失败')
  }
}

function onPrint(batch: PrintBatch) {
  // 同步打开窗口，避免浏览器拦截弹出
  const win = window.open('', '_blank')
  const result = store.printBatch(batch.id, store.currentLibrarian)
  if (!result.ok || !result.batch) {
    win?.close()
    MessagePlugin.error(result.reason || '打印失败')
    return
  }
  MessagePlugin.success(`已生成回执 ${result.receipt?.receiptNo}，正在打开打印窗口…`)
  openPrintableHtml(win, result.batch.specimens, result.batch.templateSnapshot).then((opened) => {
    if (!opened) MessagePlugin.warning('浏览器拦截了弹出窗口，请允许弹出窗口后重试')
  })
}

/** 模拟两位馆员同时提交领取同一批次：网络竞速，先到先得，后到者看到占用原因 */
function simulateConcurrent(batch: PrintBatch) {
  const shen = store.LIBRARIANS[0]
  const meng = store.LIBRARIANS[1]
  concurrentRows.value = []
  const claimWithJitter = (librarian: Librarian) =>
    new Promise<ClaimResult>((resolve) => {
      const delay = Math.random() * 35
      window.setTimeout(() => resolve(store.claimBatch(batch.id, librarian)), delay)
    })
  Promise.all([claimWithJitter(shen), claimWithJitter(meng)]).then(([first, second]) => {
    concurrentRows.value = [
      { librarian: shen, result: first },
      { librarian: meng, result: second },
    ]
  })
}

function viewReceipt(receipt: PrintReceipt) {
  activeReceipt.value = receipt
  receiptOpen.value = true
}

function reprintReceipt(receipt: PrintReceipt) {
  const win = window.open('', '_blank')
  if (!win) {
    MessagePlugin.warning('浏览器拦截了弹出窗口，请允许弹出窗口后重试')
    return
  }
  openPrintableHtml(win, receipt.specimens, receipt.templateSnapshot).then((opened) => {
    if (!opened) MessagePlugin.warning('浏览器拦截了弹出窗口，请允许弹出窗口后重试')
  })
}

function statusMeta(batch: PrintBatch) {
  switch (batch.status) {
    case 'pending':
      return { label: '待领取', theme: 'default' as const, icon: QueueIcon }
    case 'claimed':
      return { label: '已领取', theme: 'primary' as const, icon: LockTimeIcon }
    case 'printed':
      return { label: '已打印', theme: 'success' as const, icon: TaskCheckedIcon }
    case 'stale':
      return { label: '已失效', theme: 'danger' as const, icon: FileBlockedIcon }
  }
}

function specimenRange(batch: PrintBatch) {
  const first = batch.specimens[0]?.accessionNo || '—'
  const last = batch.specimens[batch.specimens.length - 1]?.accessionNo || '—'
  return first === last ? first : `${first} ~ ${last}`
}
</script>

<template>
  <div class="page-stack distribution-page">
    <section class="page-heading">
      <div>
        <h2>批次发放</h2>
        <p>模板、清单、打印批次与成品回执一次接通：领取时固定纸张栏数与清单，先到先得，租约超时自动释放。</p>
      </div>
      <t-space>
        <t-select
          :model-value="store.currentLibrarianId"
          style="width: 170px"
          @change="(value: any) => store.setLibrarian(value as string)"
        >
          <t-option v-for="item in store.LIBRARIANS" :key="item.id" :value="item.id" :label="item.name" />
        </t-select>
        <t-button theme="primary" @click="generate"><SendIcon />按当前排版生成批次</t-button>
      </t-space>
    </section>

    <section class="content-card dist-summary">
      <div class="dist-summary__item">
        <span>当前模板</span>
        <strong>{{ currentTemplate.name }}</strong>
        <small>{{ store.paperSpecOf(currentTemplate) }}</small>
      </div>
      <div class="dist-summary__item">
        <span>清单总数</span>
        <strong>{{ totalSpecimens }}</strong>
        <small>张标本标签</small>
      </div>
      <div class="dist-summary__item">
        <span>每张容量</span>
        <strong>{{ store.capacity }}</strong>
        <small>栏数 × 每页行数</small>
      </div>
      <div class="dist-summary__item">
        <span>待领取 / 已领取</span>
        <strong>{{ store.pendingBatches.length }} / {{ store.claimedBatches.length }}</strong>
        <small>个打印批次</small>
      </div>
      <div class="dist-summary__item">
        <span>已打印 / 已失效</span>
        <strong>{{ store.printedBatches.length }} / {{ store.staleBatches.length }}</strong>
        <small>回执保留 · 未领取失效</small>
      </div>
    </section>

    <t-alert
      v-if="store.hasStale"
      theme="warning"
      class="dist-stale-alert"
      message="排版已变更：未领取批次已立即失效并按新容量重算页数，超出纸张容量的标签请重新生成批次排队。"
    >
      <template #operation>
        <t-space>
          <t-button size="small" variant="outline" @click="generate">重新生成批次</t-button>
          <t-button size="small" variant="text" @click="store.clearStale()">清除失效批次</t-button>
        </t-space>
      </template>
    </t-alert>

    <section v-if="concurrentRows.length" class="content-card dist-concurrent">
      <div class="section-heading">
        <div>
          <strong>并发领取竞速结果</strong>
          <span>同一批次同时提交，先到者拿到租约，后到者看到占用原因</span>
        </div>
        <t-button size="small" variant="text" @click="concurrentRows = []">收起</t-button>
      </div>
      <div class="dist-concurrent__rows">
        <div v-for="row in concurrentRows" :key="row.librarian.id" class="dist-concurrent__row" :class="{ 'is-win': row.result.outcome === 'granted' }">
          <UsergroupIcon />
          <strong>{{ row.librarian.name }}</strong>
          <template v-if="row.result.outcome === 'granted'">
            <t-tag theme="success" variant="light">已领取</t-tag>
            <span class="dist-concurrent__reason">租约至 {{ store.fmtTime(row.result.batch!.claim!.expiresAt) }}</span>
          </template>
          <template v-else>
            <t-tag theme="warning" variant="light">未领取</t-tag>
            <span class="dist-concurrent__reason">{{ row.result.reason }}</span>
          </template>
        </div>
      </div>
    </section>

    <section v-if="!store.batches.length" class="content-card dist-empty">
      <QueueIcon />
      <strong>暂无打印批次</strong>
      <span>点击右上角「按当前排版生成批次」，系统会按纸张容量把清单切成可领取的打印批次。</span>
    </section>

    <section v-else class="batch-grid">
      <article v-for="batch in store.batches" :key="batch.id" class="batch-card" :class="`batch-card--${batch.status}`">
        <header class="batch-card__head">
          <div class="batch-card__title">
            <t-tag theme="primary" variant="light" shape="round">第 {{ batch.seq }} 批</t-tag>
            <t-tag :theme="statusMeta(batch).theme" variant="light">
              <component :is="statusMeta(batch).icon" />{{ statusMeta(batch).label }}
            </t-tag>
          </div>
          <span class="batch-card__seq">#{{ batch.seq }}</span>
        </header>

        <div class="batch-card__body">
          <div class="batch-card__spec">
            <span>纸张</span><strong>{{ store.paperSpecOf(batch.templateSnapshot) }}</strong>
          </div>
          <div class="batch-card__spec">
            <span>容量</span><strong>{{ batch.capacity }} 张/页 · {{ batch.specimens.length }} 张</strong>
          </div>
          <div class="batch-card__spec">
            <span>标本</span><strong>{{ specimenRange(batch) }}</strong>
          </div>

          <div v-if="batch.status === 'claimed' && batch.claim" class="batch-card__lease">
            <LockTimeIcon />
            <div>
              <strong>{{ batch.claim.holderName }} 领取中</strong>
              <span>租约剩余 {{ store.leaseCountdown(batch) }} · 至 {{ store.fmtTime(batch.claim.expiresAt) }}</span>
            </div>
          </div>

          <div v-if="batch.status === 'stale'" class="batch-card__stale">
            <FileBlockedIcon />
            <span>{{ batch.staleReason || '排版已变更，批次已失效' }}</span>
          </div>

          <div v-if="batch.status === 'printed' && batch.receiptId" class="batch-card__receipt">
            <AssignmentCheckedIcon />
            <span>回执已生成 · {{ store.getReceipt(batch.receiptId)?.receiptNo }}</span>
          </div>
        </div>

        <footer class="batch-card__actions">
          <template v-if="batch.status === 'pending'">
            <t-button size="small" theme="primary" @click="onClaim(batch)"><CheckCircleIcon />领取</t-button>
            <t-button size="small" variant="outline" @click="simulateConcurrent(batch)"><UsergroupIcon />模拟并发领取</t-button>
          </template>
          <template v-else-if="batch.status === 'claimed'">
            <t-button
              size="small"
              theme="primary"
              :disabled="batch.claim?.holderId !== store.currentLibrarian.id"
              @click="onPrint(batch)"
            >
              <PrintIcon />打印
            </t-button>
            <t-button
              size="small"
              variant="outline"
              :disabled="batch.claim?.holderId !== store.currentLibrarian.id"
              @click="onRelease(batch)"
            >
              <LockOffIcon />放弃
            </t-button>
            <span v-if="batch.claim?.holderId !== store.currentLibrarian.id" class="batch-card__hint">
              仅 {{ batch.claim?.holderName }} 可操作
            </span>
          </template>
          <template v-else-if="batch.status === 'printed'">
            <t-button
              v-if="batch.receiptId && store.getReceipt(batch.receiptId)"
              size="small"
              variant="outline"
              @click="viewReceipt(store.getReceipt(batch.receiptId)!)"
            >
              <AssignmentCheckedIcon />查看回执
            </t-button>
          </template>
          <template v-else-if="batch.status === 'stale'">
            <span class="batch-card__hint">请重新生成批次</span>
          </template>
        </footer>
      </article>
    </section>

    <section v-if="store.receipts.length" class="content-card dist-receipts">
      <div class="section-heading">
        <div><strong>成品回执</strong><span>打印完成后保留，可随时查看或再次打印</span></div>
      </div>
      <t-table
        row-key="id"
        size="small"
        :data="store.receipts"
        :columns="[
          { colKey: 'receiptNo', title: '回执编号', width: 170 },
          { colKey: 'batchSeq', title: '批次', width: 90 },
          { colKey: 'templateName', title: '模板' },
          { colKey: 'paperSpec', title: '纸张规格', width: 170 },
          { colKey: 'specimenCount', title: '标签数', width: 90 },
          { colKey: 'pageCount', title: '页数', width: 70 },
          { colKey: 'printedBy', title: '打印人', width: 110 },
          { colKey: 'printedAt', title: '打印时间', width: 170 },
          { colKey: 'operation', title: '操作', width: 170 },
        ]"
        :pagination="{ pageSize: 8 }"
      >
        <template #batchSeq="{ row }">第 {{ row.batchSeq }} 批</template>
        <template #printedAt="{ row }">{{ store.fmtDateTime(row.printedAt) }}</template>
        <template #operation="{ row }">
          <t-space size="small">
            <t-link theme="primary" @click="viewReceipt(row)">查看</t-link>
            <t-link theme="primary" @click="reprintReceipt(row)">再打印</t-link>
            <t-link theme="danger" @click="store.removeReceipt(row.id)">删除</t-link>
          </t-space>
        </template>
      </t-table>
    </section>

    <t-dialog
      v-model:visible="receiptOpen"
      header="成品回执"
      width="640px"
      :footer="null"
    >
      <div v-if="activeReceipt" class="receipt-detail">
        <div class="receipt-detail__head">
          <div>
            <span>回执编号</span>
            <strong>{{ activeReceipt.receiptNo }}</strong>
          </div>
          <t-tag theme="success" variant="light">已打印</t-tag>
        </div>
        <div class="receipt-detail__grid">
          <div><span>所属批次</span><strong>第 {{ activeReceipt.batchSeq }} 批</strong></div>
          <div><span>打印人</span><strong>{{ activeReceipt.printedBy }}</strong></div>
          <div><span>打印时间</span><strong>{{ store.fmtDateTime(activeReceipt.printedAt) }}</strong></div>
          <div><span>模板名称</span><strong>{{ activeReceipt.templateName }}</strong></div>
          <div><span>纸张规格</span><strong>{{ activeReceipt.paperSpec }}</strong></div>
          <div><span>栏数 / 页数</span><strong>{{ activeReceipt.columns }} 栏 / {{ activeReceipt.pageCount }} 页</strong></div>
          <div><span>标签数量</span><strong>{{ activeReceipt.specimenCount }} 张</strong></div>
        </div>
        <div class="receipt-detail__specimens">
          <span>本批标本（{{ activeReceipt.specimens.length }}）</span>
          <ul>
            <li v-for="specimen in activeReceipt.specimens" :key="specimen.id">
              <strong>{{ specimen.accessionNo }}</strong>
              <span>{{ specimen.scientificName || '学名待补' }}</span>
            </li>
          </ul>
        </div>
        <div class="receipt-detail__actions">
          <t-button theme="primary" @click="reprintReceipt(activeReceipt)"><PrintIcon />再次打印</t-button>
        </div>
      </div>
    </t-dialog>
  </div>
</template>
