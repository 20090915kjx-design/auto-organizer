const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeRules,
  mergeAnalysis,
  sanitizeLocalModelResult,
  scorePriority
} = require('../src/core/analyzer');

const sampleContract = `
合同编号：HT-2026-0819
甲方：上海晨光科技有限公司
统一社会信用代码：91310000MA1K12345X
联系人：张三
联系电话：13800138000
电子邮箱：zhangsan@example.com
项目名称：客户档案数字化项目
签订日期：2026年08月19日
有效期至：2026年09月01日
合同金额：￥268,000.50
身份证：110101199001011234
车辆：京A12345
`;

test('rule analyzer extracts requested customer archive fields', () => {
  const result = analyzeRules(sampleContract);
  assert.equal(result.customerName, '上海晨光科技有限公司');
  assert.equal(result.contactName, '张三');
  assert.equal(result.documentDate, '2026-08-19');
  assert.equal(result.expiryDate, '2026-09-01');
  assert.equal(result.amount, 268000.5);
  assert.equal(result.contractNumber, 'HT-2026-0819');
  assert.equal(result.projectName, '客户档案数字化项目');
  assert.equal(result.materialType, '合同');
  assert.equal(result.creditCode, '91310000MA1K12345X');
  assert.equal(result.phone, '13800138000');
  assert.equal(result.email, 'zhangsan@example.com');
  assert.deepEqual(result.sensitiveData.phones, ['13800138000']);
  assert.deepEqual(result.sensitiveData.licensePlates, ['京A12345']);
});

test('priority scoring considers manual, amount, contract, missing and sensitive data', () => {
  const fields = analyzeRules(sampleContract);
  const scored = scorePriority(fields, {
    amountThreshold: 100000,
    expiryWarningDays: 30,
    requiredFields: ['customerName', 'contactName', 'documentDate', 'amount', 'contractNumber', 'projectName', 'materialType']
  }, true);
  assert.equal(scored.priorityLabel, '紧急');
  assert.ok(scored.priorityReasons.includes('人工标记'));
  assert.ok(scored.priorityReasons.includes('金额较大'));
  assert.ok(scored.priorityReasons.includes('合同材料'));
  assert.ok(scored.priorityReasons.includes('包含敏感信息'));
  assert.deepEqual(scored.missingFields, []);
});

test('local model data is constrained to known fields and known material types', () => {
  const sanitized = sanitizeLocalModelResult({
    customerName: '示例客户',
    materialType: '执行系统命令',
    unknownCommand: 'delete files',
    amount: '1200.5',
    documentDate: '2026/8/19'
  });
  assert.equal(sanitized.customerName, '示例客户');
  assert.equal(sanitized.amount, 1200.5);
  assert.equal(sanitized.documentDate, '2026-08-19');
  assert.equal(sanitized.materialType, undefined);
  assert.equal(sanitized.unknownCommand, undefined);
});

test('local model only fills fields missing from deterministic extraction', () => {
  const merged = mergeAnalysis(
    { customerName: '规则客户', contactName: '', amount: null },
    { customerName: '模型客户', contactName: '李四', amount: 88 }
  );
  assert.equal(merged.customerName, '规则客户');
  assert.equal(merged.contactName, '李四');
  assert.equal(merged.amount, 88);
});
