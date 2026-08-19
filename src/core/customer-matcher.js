const { normalizeIdentity } = require('./utils');

function matchOrCreateCustomer(database, fields) {
  const name = String(fields.customerName || '').trim();
  const normalizedName = normalizeIdentity(name);
  const identity = {
    normalizedName,
    creditCode: String(fields.creditCode || '').toUpperCase(),
    phone: String(fields.phone || '').replace(/\D/g, ''),
    email: String(fields.email || '').toLowerCase()
  };
  let customer = database.findCustomer(identity);

  if (!customer && name) {
    customer = database.createCustomer({
      name,
      normalizedName,
      creditCode: identity.creditCode,
      phone: identity.phone,
      email: identity.email
    });
  }

  if (customer) {
    database.updateCustomerIdentity(customer.id, {
      creditCode: identity.creditCode,
      phone: identity.phone,
      email: identity.email
    });
  }
  return customer;
}

module.exports = { matchOrCreateCustomer };
