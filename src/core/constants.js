const path = require('node:path');

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.xlsx', '.xlsm', '.csv', '.txt', '.md', '.html', '.htm',
  '.eml', '.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tif', '.tiff'
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tif', '.tiff'
]);

const MATERIAL_TYPES = [
  '合同', '发票', '报价单', '客户证照', '身份材料', '项目资料', '往来邮件',
  '付款凭证', '验收材料', '网页资料', '扫描件', '表格', '其他'
];

const REQUIRED_FIELDS = [
  'customerName', 'contactName', 'documentDate', 'amount',
  'contractNumber', 'projectName', 'materialType'
];

const FIELD_LABELS = {
  customerName: '客户名称',
  contactName: '联系人',
  documentDate: '日期',
  expiryDate: '到期日期',
  amount: '金额',
  contractNumber: '合同编号',
  projectName: '项目名称',
  materialType: '材料类型',
  creditCode: '统一社会信用代码',
  phone: '电话',
  email: '邮箱'
};

function isSupported(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

module.exports = {
  FIELD_LABELS,
  IMAGE_EXTENSIONS,
  MATERIAL_TYPES,
  REQUIRED_FIELDS,
  SUPPORTED_EXTENSIONS,
  isSupported
};
