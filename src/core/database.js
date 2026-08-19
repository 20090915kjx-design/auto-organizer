const { DatabaseSync } = require('node:sqlite');
const { safeJsonParse } = require('./utils');

class OrganizerDatabase {
  constructor(filePath) {
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  transaction(callback) {
    this.db.exec('BEGIN');
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        credit_code TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS customer_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_hash TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL,
        source_uri TEXT NOT NULL,
        original_name TEXT NOT NULL,
        extension TEXT DEFAULT '',
        file_size INTEGER DEFAULT 0,
        file_modified_at TEXT DEFAULT '',
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        customer_name TEXT DEFAULT '',
        contact_name TEXT DEFAULT '',
        document_date TEXT DEFAULT '',
        expiry_date TEXT DEFAULT '',
        amount REAL,
        currency TEXT DEFAULT 'CNY',
        contract_number TEXT DEFAULT '',
        project_name TEXT DEFAULT '',
        material_type TEXT DEFAULT '其他',
        credit_code TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        priority_score INTEGER NOT NULL DEFAULT 0,
        priority_label TEXT NOT NULL DEFAULT '普通',
        priority_reasons TEXT NOT NULL DEFAULT '[]',
        missing_fields TEXT NOT NULL DEFAULT '[]',
        sensitive_data TEXT NOT NULL DEFAULT '{}',
        manually_priority INTEGER NOT NULL DEFAULT 0,
        text_excerpt TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ready',
        error TEXT DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_documents_customer ON documents(customer_id);
      CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(document_date DESC);
      CREATE INDEX IF NOT EXISTS idx_documents_priority ON documents(priority_score DESC);
      CREATE INDEX IF NOT EXISTS idx_customers_normalized_name ON customers(normalized_name);
      CREATE INDEX IF NOT EXISTS idx_customers_credit_code ON customers(credit_code);
    `);

    const defaults = {
      amountThreshold: 100000,
      expiryWarningDays: 30,
      localModelEnabled: false,
      localModelEndpoint: 'http://127.0.0.1:11434/api/generate',
      localModelName: 'qwen2.5:1.5b',
      requiredFields: [
        'customerName', 'contactName', 'documentDate', 'amount',
        'contractNumber', 'projectName', 'materialType'
      ]
    };
    const insert = this.db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
    this.transaction(() => {
      for (const [key, value] of Object.entries(defaults)) {
        insert.run(key, JSON.stringify(value));
      }
    });
  }

  getSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((row) => [row.key, safeJsonParse(row.value, row.value)]));
  }

  saveSettings(patch) {
    const statement = this.db.prepare(`
      INSERT INTO settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    this.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        statement.run(key, JSON.stringify(value));
      }
    });
    return this.getSettings();
  }

  findCustomer({ normalizedName, creditCode, phone, email }) {
    if (creditCode) {
      const found = this.db.prepare('SELECT * FROM customers WHERE credit_code = ?').get(creditCode);
      if (found) return found;
    }
    if (email) {
      const found = this.db.prepare('SELECT * FROM customers WHERE lower(email) = lower(?)').get(email);
      if (found) return found;
    }
    if (phone) {
      const found = this.db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
      if (found) return found;
    }
    if (normalizedName) {
      const found = this.db.prepare('SELECT * FROM customers WHERE normalized_name = ?').get(normalizedName);
      if (found) return found;
      return this.db.prepare(`
        SELECT c.* FROM customer_aliases a
        JOIN customers c ON c.id = a.customer_id
        WHERE a.normalized_alias = ?
      `).get(normalizedName);
    }
    return null;
  }

  createCustomer(customer) {
    const result = this.db.prepare(`
      INSERT INTO customers(name, normalized_name, credit_code, phone, email)
      VALUES (@name, @normalizedName, @creditCode, @phone, @email)
    `).run(customer);
    return this.db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
  }

  updateCustomerIdentity(id, customer) {
    this.db.prepare(`
      UPDATE customers SET
        credit_code = CASE WHEN credit_code = '' THEN @creditCode ELSE credit_code END,
        phone = CASE WHEN phone = '' THEN @phone ELSE phone END,
        email = CASE WHEN email = '' THEN @email ELSE email END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id, ...customer });
  }

  addAlias(customerId, alias, normalizedAlias) {
    this.db.prepare(`
      INSERT OR IGNORE INTO customer_aliases(customer_id, alias, normalized_alias)
      VALUES (?, ?, ?)
    `).run(customerId, alias, normalizedAlias);
    const unmatched = this.db.prepare(`
      SELECT id, customer_name FROM documents
      WHERE customer_id IS NULL AND customer_name <> ''
    `).all();
    const { normalizeIdentity } = require('./utils');
    const update = this.db.prepare('UPDATE documents SET customer_id = ? WHERE id = ?');
    this.transaction(() => {
      for (const document of unmatched) {
        if (normalizeIdentity(document.customer_name) === normalizedAlias) {
          update.run(customerId, document.id);
        }
      }
    });
  }

  documentByHash(hash) {
    return this.db.prepare('SELECT * FROM documents WHERE content_hash = ?').get(hash);
  }

  insertDocument(document) {
    const parameters = {
      contentHash: document.contentHash,
      sourceType: document.sourceType,
      sourceUri: document.sourceUri,
      originalName: document.originalName,
      extension: document.extension,
      fileSize: document.fileSize,
      fileModifiedAt: document.fileModifiedAt,
      customerId: document.customerId,
      customerName: document.customerName,
      contactName: document.contactName,
      documentDate: document.documentDate,
      expiryDate: document.expiryDate,
      amount: document.amount,
      currency: document.currency,
      contractNumber: document.contractNumber,
      projectName: document.projectName,
      materialType: document.materialType,
      creditCode: document.creditCode,
      phone: document.phone,
      email: document.email,
      priorityScore: document.priorityScore,
      priorityLabel: document.priorityLabel,
      priorityReasons: JSON.stringify(document.priorityReasons || []),
      missingFields: JSON.stringify(document.missingFields || []),
      sensitiveData: JSON.stringify(document.sensitiveData || {}),
      textExcerpt: document.textExcerpt,
      status: document.status,
      error: document.error
    };
    const result = this.db.prepare(`
      INSERT INTO documents(
        content_hash, source_type, source_uri, original_name, extension, file_size,
        file_modified_at, customer_id, customer_name, contact_name, document_date,
        expiry_date, amount, currency, contract_number, project_name, material_type,
        credit_code, phone, email, priority_score, priority_label, priority_reasons,
        missing_fields, sensitive_data, text_excerpt, status, error
      ) VALUES (
        @contentHash, @sourceType, @sourceUri, @originalName, @extension, @fileSize,
        @fileModifiedAt, @customerId, @customerName, @contactName, @documentDate,
        @expiryDate, @amount, @currency, @contractNumber, @projectName, @materialType,
        @creditCode, @phone, @email, @priorityScore, @priorityLabel, @priorityReasons,
        @missingFields, @sensitiveData, @textExcerpt, @status, @error
      )
    `).run(parameters);
    return Number(result.lastInsertRowid);
  }

  setManualPriority(documentId, enabled) {
    const document = this.document(documentId);
    if (!document) return null;
    const { scorePriority } = require('./analyzer');
    const priority = scorePriority({
      customerName: document.customer_name,
      contactName: document.contact_name,
      documentDate: document.document_date,
      expiryDate: document.expiry_date,
      amount: document.amount,
      contractNumber: document.contract_number,
      projectName: document.project_name,
      materialType: document.material_type,
      sensitiveData: document.sensitive_data
    }, this.getSettings(), enabled);
    this.db.prepare(`
      UPDATE documents SET manually_priority = @enabled, priority_score = @priorityScore,
        priority_label = @priorityLabel, priority_reasons = @priorityReasons,
        missing_fields = @missingFields WHERE id = @documentId
    `).run({
      enabled: enabled ? 1 : 0,
      documentId,
      ...priority,
      priorityReasons: JSON.stringify(priority.priorityReasons),
      missingFields: JSON.stringify(priority.missingFields)
    });
    return this.document(documentId);
  }

  document(id) {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    return row ? this.hydrateDocument(row) : null;
  }

  hydrateDocument(row) {
    return {
      ...row,
      priority_reasons: safeJsonParse(row.priority_reasons, []),
      missing_fields: safeJsonParse(row.missing_fields, []),
      sensitive_data: safeJsonParse(row.sensitive_data, {})
    };
  }

  listDocuments({ search = '', customerId = null, limit = 500 } = {}) {
    const clauses = [];
    const parameters = { limit };
    if (search) {
      clauses.push(`(
        original_name LIKE @search OR customer_name LIKE @search OR project_name LIKE @search
        OR contract_number LIKE @search OR contact_name LIKE @search
      )`);
      parameters.search = `%${search}%`;
    }
    if (customerId) {
      clauses.push('customer_id = @customerId');
      parameters.customerId = customerId;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db.prepare(`
      SELECT * FROM documents ${where}
      ORDER BY priority_score DESC, COALESCE(NULLIF(document_date, ''), imported_at) DESC
      LIMIT @limit
    `).all(parameters).map((row) => this.hydrateDocument(row));
  }

  listCustomers() {
    return this.db.prepare(`
      SELECT c.*, COUNT(d.id) AS document_count, COALESCE(SUM(d.amount), 0) AS total_amount,
        MAX(d.priority_score) AS max_priority
      FROM customers c LEFT JOIN documents d ON d.customer_id = c.id
      GROUP BY c.id
      ORDER BY max_priority DESC, c.name COLLATE NOCASE
    `).all();
  }

  summary() {
    const totals = this.db.prepare(`
      SELECT COUNT(*) AS document_count, COUNT(DISTINCT customer_id) AS customer_count,
        COALESCE(SUM(amount), 0) AS total_amount,
        SUM(CASE WHEN priority_score >= 60 THEN 1 ELSE 0 END) AS high_priority_count,
        SUM(CASE WHEN json_array_length(missing_fields) > 0 THEN 1 ELSE 0 END) AS pending_count
      FROM documents
    `).get();
    const timeline = this.db.prepare(`
      SELECT substr(document_date, 1, 7) AS month, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
      FROM documents WHERE document_date <> '' GROUP BY month ORDER BY month DESC LIMIT 12
    `).all().reverse();
    const types = this.db.prepare(`
      SELECT material_type AS type, COUNT(*) AS count FROM documents
      GROUP BY material_type ORDER BY count DESC
    `).all();
    return { ...totals, timeline, types };
  }

  allForReport() {
    return this.db.prepare(`
      SELECT d.*, c.name AS matched_customer_name
      FROM documents d LEFT JOIN customers c ON c.id = d.customer_id
      ORDER BY d.priority_score DESC, d.document_date DESC
    `).all().map((row) => this.hydrateDocument(row));
  }

  close() {
    this.db.close();
  }
}

module.exports = { OrganizerDatabase };
