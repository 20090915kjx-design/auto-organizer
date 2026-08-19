const ExcelJS = require('exceljs');

const currencyFormat = '¥#,##0.00;[Red]-¥#,##0.00';

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF315C49' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.height = 24;
}

function setColumns(worksheet, columns) {
  worksheet.columns = columns;
  styleHeader(worksheet.getRow(1));
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + Math.min(columns.length, 26))}1` };
}

async function exportReport(database, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '自动整理';
  workbook.created = new Date();

  const summary = database.summary();
  const overview = workbook.addWorksheet('总览');
  overview.addRows([
    ['指标', '数值'],
    ['文件总量', summary.document_count],
    ['客户数量', summary.customer_count],
    ['金额汇总', summary.total_amount],
    ['高优先级事项', summary.high_priority_count],
    ['待处理材料', summary.pending_count]
  ]);
  overview.getColumn(1).width = 24;
  overview.getColumn(2).width = 22;
  overview.getCell('B4').numFmt = currencyFormat;
  styleHeader(overview.getRow(1));

  const customers = workbook.addWorksheet('客户汇总');
  setColumns(customers, [
    { header: '客户名称', key: 'name', width: 36 },
    { header: '统一社会信用代码', key: 'credit_code', width: 22 },
    { header: '电话', key: 'phone', width: 16 },
    { header: '邮箱', key: 'email', width: 30 },
    { header: '材料数量', key: 'document_count', width: 14 },
    { header: '金额汇总', key: 'total_amount', width: 18 },
    { header: '最高优先级分数', key: 'max_priority', width: 18 }
  ]);
  customers.addRows(database.listCustomers());
  customers.getColumn('total_amount').numFmt = currencyFormat;

  const documents = workbook.addWorksheet('材料明细');
  setColumns(documents, [
    { header: '优先级', key: 'priority_label', width: 12 },
    { header: '分数', key: 'priority_score', width: 10 },
    { header: '客户名称', key: 'display_customer', width: 32 },
    { header: '联系人', key: 'contact_name', width: 14 },
    { header: '日期', key: 'document_date', width: 14 },
    { header: '到期日期', key: 'expiry_date', width: 14 },
    { header: '金额', key: 'amount', width: 18 },
    { header: '合同编号', key: 'contract_number', width: 22 },
    { header: '项目名称', key: 'project_name', width: 30 },
    { header: '材料类型', key: 'material_type', width: 16 },
    { header: '缺失字段', key: 'missing', width: 34 },
    { header: '优先原因', key: 'reasons', width: 34 },
    { header: '原始文件/网页', key: 'source_uri', width: 60 }
  ]);
  const reportRows = database.allForReport().map((document) => ({
    ...document,
    display_customer: document.matched_customer_name || document.customer_name || '待识别',
    missing: document.missing_fields.join('、'),
    reasons: document.priority_reasons.join('、')
  }));
  documents.addRows(reportRows);
  documents.getColumn('amount').numFmt = currencyFormat;
  documents.eachRow((row, number) => {
    if (number === 1) return;
    const label = row.getCell('priority_label').value;
    if (label === '紧急') row.getCell('priority_label').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD8D4' } };
    if (label === '重要') row.getCell('priority_label').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE8B2' } };
  });

  const timeline = workbook.addWorksheet('时间分布');
  setColumns(timeline, [
    { header: '月份', key: 'month', width: 16 },
    { header: '材料数量', key: 'count', width: 16 },
    { header: '金额', key: 'amount', width: 20 }
  ]);
  timeline.addRows(summary.timeline);
  timeline.getColumn('amount').numFmt = currencyFormat;

  const pending = workbook.addWorksheet('待处理与高优先级');
  setColumns(pending, documents.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width
  })));
  pending.addRows(reportRows.filter((row) => row.priority_score >= 30 || row.missing_fields.length));
  pending.getColumn('amount').numFmt = currencyFormat;

  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

module.exports = { exportReport };
