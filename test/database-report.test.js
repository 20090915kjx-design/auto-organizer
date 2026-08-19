const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { OrganizerDatabase } = require('../src/core/database');
const { DocumentIndexer } = require('../src/core/indexer');
const { matchOrCreateCustomer } = require('../src/core/customer-matcher');
const { exportReport } = require('../src/core/reporter');

async function withTempDatabase(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-organizer-'));
  const database = new OrganizerDatabase(path.join(tempDir, 'test.db'));
  try {
    await callback(database, tempDir);
  } finally {
    database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function exampleDocument(customerId) {
  return {
    contentHash: 'abc123', sourceType: 'file', sourceUri: 'C:\\materials\\contract.txt',
    originalName: 'contract.txt', extension: '.txt', fileSize: 100,
    fileModifiedAt: '2026-08-19T00:00:00.000Z', customerId,
    customerName: '上海晨光科技有限公司', contactName: '张三', documentDate: '2026-08-19',
    expiryDate: '2026-09-01', amount: 268000.5, currency: 'CNY',
    contractNumber: 'HT-2026-0819', projectName: '档案项目', materialType: '合同',
    creditCode: '91310000MA1K12345X', phone: '13800138000', email: 'zhangsan@example.com',
    priorityScore: 70, priorityLabel: '紧急', priorityReasons: ['金额较大', '合同材料'],
    missingFields: [], sensitiveData: { idCards: [], phones: ['13800138000'], licensePlates: [] },
    textExcerpt: 'example', status: 'ready', error: ''
  };
}

test('customer matching uses name, identity data and aliases', async () => {
  await withTempDatabase(async (database) => {
    const customer = matchOrCreateCustomer(database, {
      customerName: '上海晨光科技有限公司', creditCode: '91310000MA1K12345X',
      phone: '13800138000', email: 'zhangsan@example.com'
    });
    database.addAlias(customer.id, '晨光科技', '晨光科技');
    const matched = matchOrCreateCustomer(database, { customerName: '晨光科技' });
    assert.equal(matched.id, customer.id);
    assert.equal(database.listCustomers().length, 1);
  });
});

test('database summary and Excel report include requested views', async () => {
  await withTempDatabase(async (database, tempDir) => {
    const customer = matchOrCreateCustomer(database, {
      customerName: '上海晨光科技有限公司', creditCode: '91310000MA1K12345X'
    });
    database.insertDocument(exampleDocument(customer.id));
    const summary = database.summary();
    assert.equal(summary.document_count, 1);
    assert.equal(summary.customer_count, 1);
    assert.equal(summary.total_amount, 268000.5);

    const reportPath = path.join(tempDir, 'report.xlsx');
    await exportReport(database, reportPath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(reportPath);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
      '总览', '客户汇总', '材料明细', '时间分布', '待处理与高优先级'
    ]);
  });
});

test('manual priority can be added and removed without leaving a stale score', async () => {
  await withTempDatabase(async (database) => {
    const customer = matchOrCreateCustomer(database, { customerName: '示例有限公司' });
    const data = exampleDocument(customer.id);
    data.contentHash = 'manual-test';
    data.customerName = '示例有限公司';
    data.amount = 10;
    data.materialType = '其他';
    data.priorityScore = 0;
    data.priorityLabel = '普通';
    data.priorityReasons = [];
    const id = database.insertDocument(data);
    assert.equal(database.setManualPriority(id, true).priority_label, '紧急');
    const removed = database.setManualPriority(id, false);
    assert.equal(removed.manually_priority, 0);
    assert.ok(!removed.priority_reasons.includes('人工标记'));
    assert.ok(removed.priority_score < 100);
  });
});

test('text file import runs through extraction, analysis, matching and indexing', async () => {
  await withTempDatabase(async (database, tempDir) => {
    const source = path.join(tempDir, 'sample.txt');
    await fs.writeFile(source, `
      合同编号：HT-1001
      客户名称：示例客户有限公司
      联系人：王五
      项目名称：年度档案整理
      日期：2026-08-19
      金额：1000
    `, 'utf8');
    const indexer = new DocumentIndexer(database, { ocrCacheDir: path.join(tempDir, 'ocr') });
    const [result] = await indexer.importPaths([source]);
    assert.equal(result.status, 'imported');
    const [document] = database.listDocuments();
    assert.equal(document.customer_name, '示例客户有限公司');
    assert.equal(document.contract_number, 'HT-1001');
    assert.equal(document.project_name, '年度档案整理');
    assert.equal(database.listCustomers()[0].document_count, 1);
  });
});
