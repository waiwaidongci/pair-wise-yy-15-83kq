<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import {
  CheckCircleIcon,
  DownloadIcon,
  LogoutIcon,
  PrintIcon,
  SendIcon,
  TimeIcon,
} from 'tdesign-icons-vue-next'
import { useLabelStore } from '../stores/labelStore'
import { CLAIM_TTL_MS, useDispatchStore } from '../stores/dispatchStore'
import LabelSheet from '../components/LabelSheet.vue'
import { exportPrintableHtml, exportReceiptsCsv } from '../utils/exporters'
import { labelsPerPage } from '../utils/layout'
import type { BatchClaim, PrintBatch } from '../types/label'

const LIBRARIANS = ['沈砚', '孟川', '赵禾', '郭清', '贺屿', '唐映', '程野']
const LIBRARIAN_KEY = 'pair-wise-yy-15-librarian'

const labelStore = useLabelStore()
const dispatchStore = useDispatchStore()

const librarian = ref(sessionStorage.getItem(LIBRARIAN_KEY) || LIBRARIANS[0])
const now = ref(Date.now())
const zoom = ref(0.62)
const confirmComplete = ref<BatchClaim | null>(null)
let pageStyle: HTMLStyleElement | null = null
let timer = 0

const activeClaims = computed(() =>
  dispatchStore.claims.filter((claim) => new Date(claim.expiresAt).getTime() > now.value),
)
const myClaims = computed(() =>
  activeClaims.value.filter((claim) => claim.librarian === librarian.value),
)
const voidCount = computed(
  () => dispatchStore.batches.filter((batch) => batch.status === 'void').length,
)
const hasLiveBatches = computed(() =>
  dispatchStore.batches.some((batch) => batch.status !== 'void'),
)
const currentStep = computed(() => {
  if (dispatchStore.receipts.length) return 3
  if (activeClaims.value.length || dispatchStore.batches.some((batch) => batch.status === 'done')) return 2
  if (hasLiveBatches.value) return 1
  return 0
})
const generateDisabledReason = computed(() => {
  if (!labelStore.specimens.length) return '标本清单为空，请先在「清单校验」导入'
  if (labelStore.errorCount) return `清单还有 ${labelStore.errorCount} 条错误，修正后才能发放`
  return ''
})

function claimPages(claim: BatchClaim) {
  return Math.max(1, Math.ceil(claim.specimenSnapshot.length / labelsPerPage(claim.templateSnapshot)))
}

function claimPageIndexes(claim: BatchClaim) {
  return Array.from({ length: claimPages(claim) }, (_, index) => index)
}

function holderOf(batch: PrintBatch) {
  return activeClaims.value.find((claim) => claim.batchId === batch.id)
}

function countdown(iso: string) {
  const remain = Math.max(0, new Date(iso).getTime() - now.value)
  const minutes = Math.floor(remain / 60000)
  const seconds = Math.floor((remain % 60000) / 1000)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function clock(iso: string) {
  const date = new Date(iso)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

function shortTime(iso: string) {
  const date = new Date(iso)
  return `${date.getMonth() + 1}-${date.getDate()} ${clock(iso)}`
}

function pickLibrarian(value: string | number) {
  librarian.value = String(value)
  sessionStorage.setItem(LIBRARIAN_KEY, librarian.value)
}

function generate() {
  const count = dispatchStore.generateBatches()
  if (count) MessagePlugin.success(`已生成 ${count} 个打印批次，超出单批容量的标签已排入后续批次`)
}

function claim(batch: PrintBatch) {
  const result = dispatchStore.claimBatch(batch.id, librarian.value)
  if (result.ok) {
    MessagePlugin.success(`已领取 ${batch.name}，纸张栏数与清单已固定，${CLAIM_TTL_MS / 60000} 分钟内有效`)
  } else {
    MessagePlugin.error(result.reason)
  }
}

function giveUp(claim: BatchClaim) {
  dispatchStore.releaseClaim(claim.id)
  MessagePlugin.info('已放弃领取，批次回到待领取队列')
}

function finishClaim() {
  if (!confirmComplete.value) return
  const receipt = dispatchStore.completeClaim(confirmComplete.value.id)
  confirmComplete.value = null
  if (receipt) MessagePlugin.success(`回执已登记留存：${receipt.batchName} · ${receipt.labelCount} 张标签`)
}

async function exportClaim(claim: BatchClaim) {
  await exportPrintableHtml(claim.specimenSnapshot, claim.templateSnapshot)
  MessagePlugin.success('已按领取快照导出可打印文件')
}

function printClaims() {
  window.print()
}

watchEffect(() => {
  const template = myClaims.value[0]?.templateSnapshot
  if (!template) {
    pageStyle?.remove()
    pageStyle = null
    return
  }
  if (!pageStyle) {
    pageStyle = document.createElement('style')
    pageStyle.dataset.dispatchPrintPage = 'true'
    document.head.appendChild(pageStyle)
  }
  pageStyle.textContent = `@media print { @page { size: ${template.paperWidthMm}mm ${template.paperHeightMm}mm; margin: 0; } }`
})

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = Date.now()
    dispatchStore.releaseExpiredClaims()
  }, 1000)
})

onUnmounted(() => {
  window.clearInterval(timer)
  pageStyle?.remove()
  pageStyle = null
})
</script>

<template>
  <div class="page-stack dispatch-page">
    <section class="page-heading dispatch-screen">
      <div>
        <h2>批次发放</h2>
        <p>模板、清单、打印批次与成品回执接成一次发放；领取即固定当时的纸张栏数与清单。</p>
      </div>
      <div class="librarian-picker">
        <span>当前馆员</span>
        <t-select
          :model-value="librarian"
          :options="LIBRARIANS.map((name) => ({ label: name, value: name }))"
          @change="pickLibrarian"
        />
        <small>不同标签页可设不同馆员，同时领取同一批次时先到先得</small>
      </div>
    </section>

    <t-steps class="dispatch-steps dispatch-screen" :current="currentStep">
      <t-step-item title="生成批次" content="按当前模板与清单切片，超容量标签排入下一批" />
      <t-step-item title="馆员领取" content="先到者获得 10 分钟时限领取，后到者见占用原因" />
      <t-step-item title="快照打印" content="按领取时固定的纸张栏数与清单打印" />
      <t-step-item title="回执留存" content="打完登记成品回执，永久保留" />
    </t-steps>

    <section class="content-card dispatch-screen">
      <div class="section-heading">
        <div><strong>发放设置</strong><span>依据当前模板与清单实时重算页数</span></div>
        <t-button theme="primary" :disabled="!!generateDisabledReason" @click="generate">
          <SendIcon />生成打印批次
        </t-button>
      </div>
      <div class="dispatch-config">
        <div class="dispatch-config__facts">
          <article>
            <span>当前模板</span>
            <strong>{{ labelStore.activeTemplate.name }}</strong>
            <small>{{ labelStore.activeTemplate.paperWidthMm }} × {{ labelStore.activeTemplate.paperHeightMm }} mm · {{ labelStore.activeTemplate.columns }} 栏</small>
          </article>
          <article>
            <span>每页容量</span>
            <strong>{{ dispatchStore.perPage }} 张</strong>
            <small>由纸张、边距、栏数与行高算出</small>
          </article>
          <article>
            <span>每批页数</span>
            <t-input-number
              :model-value="dispatchStore.pagesPerBatch"
              :min="1"
              :max="10"
              :step="1"
              theme="column"
              @change="(value: any) => dispatchStore.setPagesPerBatch(Number(value))"
            />
          </article>
          <article>
            <span>每批容量</span>
            <strong>{{ dispatchStore.batchCapacity }} 张</strong>
            <small>超出容量的标签自动排队等下一批</small>
          </article>
          <article>
            <span>清单记录</span>
            <strong>{{ labelStore.specimens.length }} 条</strong>
            <small>将生成 {{ dispatchStore.plannedBatchCount }} 个批次</small>
          </article>
        </div>
        <t-alert
          v-if="generateDisabledReason"
          theme="warning"
          :message="generateDisabledReason"
        />
        <t-alert
          v-else-if="voidCount"
          theme="info"
          :message="`排版依据或清单改动后，${voidCount} 个未领取批次已失效；已领取的批次与回执不受影响，可重新生成批次。`"
        />
      </div>
    </section>

    <section class="content-card dispatch-screen">
      <div class="section-heading">
        <div><strong>打印批次</strong><span>{{ dispatchStore.sortedBatches.length }} 个</span></div>
        <span class="section-note">领取时限 {{ CLAIM_TTL_MS / 60000 }} 分钟，到期未打印自动释放回队列</span>
      </div>
      <t-table
        row-key="id"
        hover
        size="small"
        :data="dispatchStore.sortedBatches"
        :columns="[
          { colKey: 'name', title: '批次', width: 150 },
          { colKey: 'layout', title: '领取时固定的版面', width: 220 },
          { colKey: 'volume', title: '标签 / 页数', width: 130 },
          { colKey: 'status', title: '状态', width: 240 },
          { colKey: 'operation', title: '操作', width: 110 },
        ]"
        :pagination="{ pageSize: 8 }"
      >
        <template #name="{ row }">
          <strong>{{ row.name }}</strong>
          <small class="cell-sub">生成于 {{ shortTime(row.createdAt) }}</small>
        </template>
        <template #layout="{ row }">
          <span>{{ row.paperWidthMm }} × {{ row.paperHeightMm }} mm · {{ row.columns }} 栏</span>
          <small class="cell-sub">每页 {{ row.labelsPerPage }} 张 × {{ row.pagesPerBatch }} 页</small>
        </template>
        <template #volume="{ row }">
          <span>{{ row.specimenIds.length }} 张 / {{ row.pageCount }} 页</span>
        </template>
        <template #status="{ row }">
          <template v-if="row.status === 'pending'">
            <t-tag theme="primary" variant="light">待领取</t-tag>
          </template>
          <template v-else-if="row.status === 'claimed'">
            <t-tag theme="warning" variant="light">领取中</t-tag>
            <small v-if="holderOf(row)" class="cell-sub">
              {{ holderOf(row)!.librarian }} 占用至 {{ clock(holderOf(row)!.expiresAt) }}（{{ countdown(holderOf(row)!.expiresAt) }}）
            </small>
          </template>
          <template v-else-if="row.status === 'done'">
            <t-tag theme="success" variant="light">已完成</t-tag>
            <small class="cell-sub">回执已留存</small>
          </template>
          <template v-else>
            <t-tag variant="light">已失效</t-tag>
            <small class="cell-sub">{{ row.voidReason }}</small>
          </template>
        </template>
        <template #operation="{ row }">
          <t-button
            v-if="row.status === 'pending'"
            size="small"
            theme="primary"
            variant="outline"
            @click="claim(row)"
          >
            领取
          </t-button>
          <t-button
            v-else-if="row.status === 'claimed' && holderOf(row)?.librarian === librarian"
            size="small"
            variant="outline"
            @click="giveUp(holderOf(row)!)"
          >
            放弃
          </t-button>
          <span v-else-if="row.status === 'claimed' && holderOf(row)" class="occupied-note">
            被 {{ holderOf(row)!.librarian }} 占用
          </span>
          <span v-else class="occupied-note">—</span>
        </template>
      </t-table>
    </section>

    <section v-for="claim in myClaims" :key="claim.id" class="content-card claim-card">
      <div class="section-heading dispatch-screen">
        <div>
          <strong>我的领取 · {{ dispatchStore.batches.find((b) => b.id === claim.batchId)?.name }}</strong>
          <span><TimeIcon /> 剩余 {{ countdown(claim.expiresAt) }}，{{ clock(claim.expiresAt) }} 到期</span>
        </div>
        <t-space>
          <t-button size="small" variant="outline" @click="exportClaim(claim)"><DownloadIcon />导出快照文件</t-button>
          <t-button size="small" variant="outline" @click="giveUp(claim)"><LogoutIcon />放弃领取</t-button>
          <t-button size="small" theme="primary" variant="outline" @click="printClaims"><PrintIcon />打印该批次</t-button>
          <t-button size="small" theme="success" @click="confirmComplete = claim"><CheckCircleIcon />完成打印并登记回执</t-button>
        </t-space>
      </div>
      <div class="claim-snapshot dispatch-screen">
        <span>领取时固定：{{ claim.templateSnapshot.paperWidthMm }} × {{ claim.templateSnapshot.paperHeightMm }} mm</span>
        <span>{{ claim.templateSnapshot.columns }} 栏 · 每页 {{ labelsPerPage(claim.templateSnapshot) }} 张</span>
        <span>{{ claim.specimenSnapshot.length }} 张标签 / {{ claimPages(claim) }} 页</span>
        <span>领取于 {{ shortTime(claim.claimedAt) }}，此后版面与清单改动不影响本批</span>
      </div>
      <div class="print-stage dispatch-print-stage">
        <div class="print-pages">
          <div
            v-for="pageIndex in claimPageIndexes(claim)"
            :key="pageIndex"
            class="print-page-wrap"
          >
            <span class="print-page-label dispatch-screen">第 {{ pageIndex + 1 }} / {{ claimPages(claim) }} 页</span>
            <div :style="{ transform: `scale(${zoom})`, transformOrigin: 'top left' }">
              <LabelSheet
                :specimens="claim.specimenSnapshot"
                :template="claim.templateSnapshot"
                :page-index="pageIndex"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="content-card dispatch-screen">
      <div class="section-heading">
        <div><strong>成品回执</strong><span>{{ dispatchStore.sortedReceipts.length }} 份 · 打完即留存，不随版面改动失效</span></div>
        <t-button
          size="small"
          variant="outline"
          :disabled="!dispatchStore.sortedReceipts.length"
          @click="exportReceiptsCsv(dispatchStore.sortedReceipts)"
        >
          <DownloadIcon />导出回执 CSV
        </t-button>
      </div>
      <t-table
        row-key="id"
        hover
        size="small"
        :data="dispatchStore.sortedReceipts"
        :columns="[
          { colKey: 'batchName', title: '批次', width: 110 },
          { colKey: 'librarian', title: '馆员', width: 90 },
          { colKey: 'printedAt', title: '打印时间', width: 150 },
          { colKey: 'layout', title: '成品版面', width: 210 },
          { colKey: 'volume', title: '标签 / 页数', width: 120 },
          { colKey: 'range', title: '编号区间' },
        ]"
        :pagination="{ pageSize: 8 }"
      >
        <template #printedAt="{ row }">{{ shortTime(row.printedAt) }}</template>
        <template #layout="{ row }">
          {{ row.templateName }} · {{ row.paperWidthMm }}×{{ row.paperHeightMm }}mm · {{ row.columns }} 栏
        </template>
        <template #volume="{ row }">{{ row.labelCount }} 张 / {{ row.pageCount }} 页</template>
        <template #range="{ row }">{{ row.firstAccession }} ~ {{ row.lastAccession }}</template>
      </t-table>
    </section>

    <t-dialog
      :visible="!!confirmComplete"
      header="登记成品回执"
      width="460px"
      :confirm-btn="{ content: '确认完成并留存回执', theme: 'success' }"
      @confirm="finishClaim"
      @close="confirmComplete = null"
    >
      <p v-if="confirmComplete" class="confirm-text">
        确认 {{ dispatchStore.batches.find((b) => b.id === confirmComplete!.batchId)?.name }}
        的 {{ confirmComplete.specimenSnapshot.length }} 张标签已打印完成？
        回执将按领取时固定的 {{ confirmComplete.templateSnapshot.columns }} 栏版面登记，永久保留。
      </p>
    </t-dialog>
  </div>
</template>

<style>
@media print {
  body { background: #fff !important; }
  .app-sider, .app-header, .dispatch-screen { display: none !important; }
  .app-shell, .app-workspace, .app-content, .dispatch-page, .claim-card, .dispatch-print-stage, .dispatch-print-stage .print-pages {
    display: block !important;
    width: auto !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    padding: 0 !important;
    border: 0 !important;
    background: #fff !important;
    box-shadow: none !important;
  }
  .dispatch-print-stage .print-page-wrap { margin: 0 !important; break-after: page; }
  .dispatch-print-stage .print-page-wrap > div { transform: none !important; }
  .dispatch-print-stage .label-sheet { box-shadow: none !important; }
}
</style>
