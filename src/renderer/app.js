const state = {
  view: 'dashboard',
  documents: [],
  customers: [],
  summary: null,
  settings: null,
  customerId: null,
  search: ''
};

const pageMeta = {
  dashboard: ['档案总览', '识别、分组并排好每一份客户材料'],
  documents: ['材料索引', '默认按优先级与日期自动排序'],
  customers: ['客户分组', '根据名称、信用代码、电话、邮箱和别名归并'],
  reports: ['统计报表', '汇总数量、金额、时间、缺失项和高优先级事项'],
  settings: ['本地设置', '调整优先级规则与本地模型']
};

const view = document.querySelector('#view');
const working = document.querySelector('#working');
const workingTitle = document.querySelector('#working-title');
const workingDetail = document.querySelector('#working-detail');
const toast = document.querySelector('#toast');
const urlDialog = document.querySelector('#url-dialog');
const urlInput = document.querySelector('#url-input');

function h(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(Number(value || 0));
}

function showWorking(title = '正在整理材料…', detail = '正在读取文档内容') {
  workingTitle.textContent = title;
  workingDetail.textContent = detail;
  working.classList.remove('hidden');
}

function hideWorking() {
  working.classList.add('hidden');
}

let toastTimer;
function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.remove('hidden');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 4200);
}

function emptyState(title, description) {
  return `<div class="empty"><div><div class="empty-icon">▤</div><h2>${h(title)}</h2><p>${h(description)}</p><button class="button primary" data-action="empty-import">导入第一批材料</button></div></div>`;
}

async function refreshData() {
  [state.summary, state.customers] = await Promise.all([
    window.organizer.getDashboard(),
    window.organizer.listCustomers()
  ]);
}

function renderDashboard() {
  const summary = state.summary;
  if (!summary.document_count) {
    view.innerHTML = emptyState('从第一份客户材料开始', '支持 PDF、Word、Excel、扫描图片、邮件、网页，以及 Google Drive 或 SharePoint 的本地同步文件夹。');
    return;
  }
  const maxTimeline = Math.max(1, ...summary.timeline.map((item) => item.count));
  view.innerHTML = `
    <div class="metric-grid">
      <article class="metric-card"><span class="metric-label">文件总量</span><strong class="metric-value">${summary.document_count}</strong><span class="metric-hint">已建立本地索引</span></article>
      <article class="metric-card"><span class="metric-label">客户数量</span><strong class="metric-value">${summary.customer_count}</strong><span class="metric-hint">AI 自动归并分组</span></article>
      <article class="metric-card"><span class="metric-label">金额汇总</span><strong class="metric-value">${h(formatMoney(summary.total_amount))}</strong><span class="metric-hint">来自已识别金额</span></article>
      <article class="metric-card alert"><span class="metric-label">高优先级</span><strong class="metric-value">${summary.high_priority_count || 0}</strong><span class="metric-hint">分数达到 60</span></article>
      <article class="metric-card"><span class="metric-label">待处理材料</span><strong class="metric-value">${summary.pending_count || 0}</strong><span class="metric-hint">存在缺失字段</span></article>
    </div>
    <div class="content-grid">
      <section class="panel">
        <div class="panel-heading"><div><span class="section-kicker">TIME DISTRIBUTION</span><h2>时间分布</h2><p>最近 12 个有数据的月份</p></div></div>
        <div class="timeline">${summary.timeline.length ? summary.timeline.map((item) => `
          <div class="timeline-row"><span>${h(item.month)}</span><progress max="${maxTimeline}" value="${item.count}"></progress><b>${item.count} 份</b></div>
        `).join('') : '<span class="subtext">尚未识别到材料日期</span>'}</div>
      </section>
      <section class="panel">
        <div class="panel-heading"><div><span class="section-kicker">MATERIAL TYPES</span><h2>材料类型</h2><p>根据文档内容自动判断</p></div></div>
        <div class="type-list">${summary.types.map((item) => `<div class="type-row"><span>${h(item.type)}</span><b>${item.count}</b></div>`).join('')}</div>
      </section>
    </div>`;
}

function priorityClass(label) {
  if (label === '紧急') return 'urgent';
  if (label === '重要') return 'important';
  return 'normal';
}

async function renderDocuments() {
  state.documents = await window.organizer.listDocuments({
    search: state.search,
    customerId: state.customerId,
    limit: 1000
  });
  const customer = state.customerId ? state.customers.find((item) => item.id === state.customerId) : null;
  view.innerHTML = `
    <div class="toolbar">
      <input class="search" id="document-search" value="${h(state.search)}" placeholder="搜索文件名、客户、项目或合同编号">
      <div>${customer ? `<span class="badge normal">客户：${h(customer.name)}</span> <button class="link-button" data-action="clear-customer">清除筛选</button>` : `<span class="subtext">共 ${state.documents.length} 条 · 优先级优先，其次按日期</span>`}</div>
    </div>
    ${state.documents.length ? `<div class="table-wrap"><table>
      <thead><tr><th>优先级</th><th>材料</th><th>客户 / 联系人</th><th>日期</th><th>金额</th><th>材料类型</th><th>缺失字段</th><th>操作</th></tr></thead>
      <tbody>${state.documents.map((document) => `<tr>
        <td><span class="badge ${priorityClass(document.priority_label)}">${h(document.priority_label)} · ${document.priority_score}</span><span class="subtext">${h(document.priority_reasons.join('、'))}</span></td>
        <td><span class="file-name" title="${h(document.original_name)}">${h(document.original_name)}</span><span class="subtext">${h(document.project_name || document.contract_number || '')}</span></td>
        <td>${h(document.customer_name || '待识别')}<span class="subtext">${h(document.contact_name || document.phone || '')}</span></td>
        <td>${h(document.document_date || '—')}<span class="subtext">${document.expiry_date ? `到期 ${h(document.expiry_date)}` : ''}</span></td>
        <td>${document.amount == null ? '—' : h(formatMoney(document.amount))}</td>
        <td>${h(document.material_type)}</td>
        <td class="${document.missing_fields.length ? 'missing' : ''}">${h(document.missing_fields.join('、') || '完整')}</td>
        <td><button class="link-button" data-action="open-source" data-id="${document.id}">打开原文</button><br><button class="link-button" data-action="manual-priority" data-id="${document.id}">${document.manually_priority ? '已人工标记' : '标为紧急'}</button></td>
      </tr>`).join('')}</tbody>
    </table></div>` : emptyState('没有找到匹配材料', state.search ? '换一个关键词搜索，或清除客户筛选。' : '请先导入文件或文件夹。')}`;
  const searchInput = document.querySelector('#document-search');
  let timer;
  searchInput?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = searchInput.value.trim();
      renderDocuments();
    }, 240);
  });
}

function renderCustomers() {
  if (!state.customers.length) {
    view.innerHTML = emptyState('还没有识别到客户', '导入带有客户名称、信用代码、电话或邮箱的材料后，系统会自动建立客户分组。');
    return;
  }
  view.innerHTML = `<div class="customer-grid">${state.customers.map((customer) => `
    <article class="customer-card">
      <div class="customer-card-top"><div class="customer-avatar">${h(customer.name.slice(0, 1))}</div><div class="customer-title"><h3 title="${h(customer.name)}">${h(customer.name)}</h3><p>${h(customer.credit_code || customer.email || customer.phone || '尚无辅助身份信息')}</p></div><span class="badge ${customer.max_priority >= 60 ? 'urgent' : 'normal'}">${customer.max_priority >= 60 ? '需关注' : '正常'}</span></div>
      <div class="customer-stats"><div><span>材料数量</span><strong>${customer.document_count}</strong></div><div><span>金额汇总</span><strong>${h(formatMoney(customer.total_amount))}</strong></div></div>
      <div class="customer-actions"><button class="link-button" data-action="customer-documents" data-id="${customer.id}">查看材料 →</button><button class="link-button" data-action="add-alias" data-id="${customer.id}">维护别名</button></div>
    </article>`).join('')}</div>`;
}

function renderReports() {
  view.innerHTML = `
    <section class="report-hero"><div><span class="section-kicker">EXCEL REPORT</span><h2>一键生成本地统计报表</h2><p>报表包含客户材料数量、金额汇总、时间分布、缺失字段、待处理材料和高优先级事项，不会改变任何原文件。</p></div><button class="button" data-action="export-report">导出 Excel 报表</button></section>
    <section class="panel report-list">
      <div class="panel-heading"><div><h2>报表工作表</h2><p>每次导出都使用当前本地索引的最新结果</p></div></div>
      <div class="report-feature"><span>Σ</span><div><strong>总览与客户汇总</strong><small>文件总量、客户数量、总金额、材料数量和最高优先级。</small></div></div>
      <div class="report-feature"><span>▤</span><div><strong>材料明细</strong><small>提取字段、材料类型、原始位置、缺失字段与优先原因。</small></div></div>
      <div class="report-feature"><span>◷</span><div><strong>时间分布</strong><small>按月统计客户材料数量与金额。</small></div></div>
      <div class="report-feature"><span>!</span><div><strong>待处理与高优先级</strong><small>集中列出缺少字段、即将到期、金额较大或人工标记的事项。</small></div></div>
    </section>`;
}

function renderSettings() {
  const settings = state.settings;
  view.innerHTML = `<form id="settings-form">
    <div class="settings-grid">
      <section class="panel"><div class="panel-heading"><div><span class="section-kicker">PRIORITY RULES</span><h2>优先级规则</h2></div></div>
        <div class="field"><label for="amount-threshold">大额金额阈值（元）</label><input id="amount-threshold" name="amountThreshold" type="number" min="0" value="${h(settings.amountThreshold)}"><small>达到此金额的材料自动增加 25 分。</small></div>
        <div class="field"><label for="expiry-days">临近到期天数</label><input id="expiry-days" name="expiryWarningDays" type="number" min="1" max="3650" value="${h(settings.expiryWarningDays)}"><small>材料在设定天数内到期时自动提高优先级。</small></div>
      </section>
      <section class="panel"><div class="panel-heading"><div><span class="section-kicker">LOCAL AI</span><h2>本地 AI 模型</h2></div></div>
        <div class="switch-row"><div><strong>启用本地模型增强</strong><span class="subtext">未启用时使用本地规则与 OCR</span></div><label class="switch"><input id="model-enabled" type="checkbox" ${settings.localModelEnabled ? 'checked' : ''}><span></span></label></div>
        <div class="field"><label for="model-name">Ollama 模型名称</label><input id="model-name" type="text" value="${h(settings.localModelName)}"><small>当前电脑建议使用 qwen2.5:1.5b。程序只允许连接本机 127.0.0.1。</small></div>
        <div class="notice">开启前需在电脑上安装 Ollama 并下载模型。不开启也能完成基础字段识别、分类和报表。</div>
      </section>
      <section class="panel"><div class="panel-heading"><div><span class="section-kicker">PRIVACY</span><h2>数据边界</h2><p>数据库和 OCR 模型保存在 Windows 当前用户的应用数据目录。</p></div></div>
        <div class="type-list"><div class="type-row"><span>原文件</span><b>只读</b></div><div class="type-row"><span>外部 AI 上传</span><b>禁止</b></div><div class="type-row"><span>Google Drive / SharePoint</span><b>同步夹</b></div><div class="type-row"><span>网页</span><b>本机抓取</b></div></div>
      </section>
    </div><div class="settings-actions"><button class="button primary" type="submit">保存设置</button></div>
  </form>`;
  document.querySelector('#settings-form').addEventListener('submit', saveSettings);
}

async function saveSettings(event) {
  event.preventDefault();
  state.settings = await window.organizer.saveSettings({
    amountThreshold: Number(document.querySelector('#amount-threshold').value),
    expiryWarningDays: Number(document.querySelector('#expiry-days').value),
    localModelEnabled: document.querySelector('#model-enabled').checked,
    localModelName: document.querySelector('#model-name').value.trim()
  });
  showToast('本地设置已保存，将用于后续导入的材料');
}

async function render() {
  const [title, subtitle] = pageMeta[state.view];
  document.querySelector('#page-title').textContent = title;
  document.querySelector('#page-subtitle').textContent = subtitle;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'documents') await renderDocuments();
  if (state.view === 'customers') renderCustomers();
  if (state.view === 'reports') renderReports();
  if (state.view === 'settings') renderSettings();
}

async function afterImport(results) {
  const imported = results.filter((item) => item.status === 'imported').length;
  const duplicates = results.filter((item) => item.status === 'duplicate').length;
  const errors = results.filter((item) => item.status === 'error');
  await refreshData();
  await render();
  const message = `已导入 ${imported} 份，跳过 ${duplicates} 份重复材料${errors.length ? `，${errors.length} 份失败` : ''}`;
  showToast(message, errors.length > 0 && imported === 0);
}

async function runImport(method) {
  showWorking();
  try {
    const results = await method();
    if (results.length) await afterImport(results);
  } catch (error) {
    showToast(error.message || '导入失败', true);
  } finally {
    hideWorking();
  }
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    state.customerId = null;
    render();
  });
});
document.querySelector('#import-files').addEventListener('click', () => runImport(() => window.organizer.importFiles()));
document.querySelector('#import-folder').addEventListener('click', () => runImport(() => window.organizer.importFolder()));
document.querySelector('#import-url').addEventListener('click', () => {
  urlInput.value = '';
  urlDialog.showModal();
  setTimeout(() => urlInput.focus(), 50);
});
document.querySelector('#url-submit').addEventListener('click', async (event) => {
  event.preventDefault();
  if (!urlInput.reportValidity()) return;
  const url = urlInput.value;
  urlDialog.close();
  showWorking('正在抓取网页…', '网页正文只在本机保存和识别');
  try {
    await afterImport([await window.organizer.importUrl(url)]);
  } catch (error) {
    showToast(error.message || '网页抓取失败', true);
  } finally {
    hideWorking();
  }
});

view.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = Number(target.dataset.id);
  if (action === 'empty-import') return runImport(() => window.organizer.importFiles());
  if (action === 'clear-customer') {
    state.customerId = null;
    return renderDocuments();
  }
  if (action === 'open-source') {
    const document = state.documents.find((item) => item.id === id);
    if (document) {
      const error = await window.organizer.openSource(document.source_uri);
      if (error) showToast(error, true);
    }
  }
  if (action === 'manual-priority') {
    const document = state.documents.find((item) => item.id === id);
    await window.organizer.setManualPriority(id, !document.manually_priority);
    await refreshData();
    await renderDocuments();
  }
  if (action === 'customer-documents') {
    state.customerId = id;
    state.view = 'documents';
    await render();
  }
  if (action === 'add-alias') {
    const customer = state.customers.find((item) => item.id === id);
    const alias = window.prompt(`为“${customer.name}”添加一个别名：`);
    if (alias?.trim()) {
      try {
        await window.organizer.addCustomerAlias(id, alias.trim());
        showToast('客户别名已保存');
      } catch (error) {
        showToast(error.message, true);
      }
    }
  }
  if (action === 'export-report') {
    showWorking('正在生成报表…', '正在整理客户、金额、时间和待处理事项');
    try {
      const output = await window.organizer.exportReport();
      if (output) showToast(`报表已保存：${output}`);
    } catch (error) {
      showToast(error.message || '报表导出失败', true);
    } finally {
      hideWorking();
    }
  }
});

window.organizer.onImportProgress((progress) => {
  workingTitle.textContent = `正在整理 ${progress.current} / ${progress.total}`;
  workingDetail.textContent = progress.name;
});

(async function initialize() {
  try {
    state.settings = await window.organizer.getSettings();
    await refreshData();
    await render();
  } catch (error) {
    view.innerHTML = emptyState('应用初始化失败', error.message || '无法打开本地数据库');
  }
})();
