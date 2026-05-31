const STORAGE_KEY = "jazmin_app:business_db";
const BACKUP_VERSION = 1;

const defaultDatabase = {
  version: BACKUP_VERSION,
  settings: {
    brands: ["Pacifika", "Carmel"],
    categories: ["bebidas artesanales"]
  },
  counters: {
    customers: 1,
    orders: 1,
    orderItems: 1,
    payments: 1,
    products: 1,
    movements: 1,
    sales: 1
  },
  customers: [],
  orders: [],
  payments: [],
  products: [],
  movements: [],
  sales: []
};

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function toInteger(value) {
  return Number.parseInt(String(value), 10);
}

function readStorage() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch (error) {
    throw new Error("No se pudo guardar la base local del teléfono.");
  }
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOptionList(list, fallback) {
  const values = ensureArray(list)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique : [...fallback];
}

function createEmptyDatabase() {
  return clone(defaultDatabase);
}

function buildCounters(database) {
  const counters = clone(defaultDatabase.counters);
  counters.customers =
    Math.max(0, ...ensureArray(database.customers).map((item) => Number(item.id) || 0)) +
    1;
  counters.orders =
    Math.max(0, ...ensureArray(database.orders).map((item) => Number(item.id) || 0)) + 1;
  counters.orderItems =
    Math.max(
      0,
      ...ensureArray(database.orders).flatMap((order) =>
        ensureArray(order.items).map((item) => Number(item.id) || 0)
      )
    ) + 1;
  counters.payments =
    Math.max(0, ...ensureArray(database.payments).map((item) => Number(item.id) || 0)) +
    1;
  counters.products =
    Math.max(0, ...ensureArray(database.products).map((item) => Number(item.id) || 0)) +
    1;
  counters.movements =
    Math.max(0, ...ensureArray(database.movements).map((item) => Number(item.id) || 0)) +
    1;
  counters.sales =
    Math.max(0, ...ensureArray(database.sales).map((item) => Number(item.id) || 0)) + 1;
  return counters;
}

function normalizeDatabase(payload) {
  const source =
    payload && typeof payload === "object" && payload.data ? payload.data : payload || {};
  const database = {
    version: BACKUP_VERSION,
    settings: {
      brands: normalizeOptionList(
        source.settings?.brands,
        defaultDatabase.settings.brands
      ),
      categories: normalizeOptionList(
        source.settings?.categories,
        defaultDatabase.settings.categories
      )
    },
    counters: clone(defaultDatabase.counters),
    customers: ensureArray(source.customers),
    orders: ensureArray(source.orders).map((order) => ({
      ...order,
      items: ensureArray(order.items)
    })),
    payments: ensureArray(source.payments),
    products: ensureArray(source.products),
    movements: ensureArray(source.movements),
    sales: ensureArray(source.sales)
  };

  database.counters =
    source.counters && typeof source.counters === "object"
      ? { ...buildCounters(database), ...source.counters }
      : buildCounters(database);

  return database;
}

function readDatabase() {
  const raw = readStorage();
  if (!raw) {
    const initial = createEmptyDatabase();
    writeDatabase(initial);
    return initial;
  }

  try {
    return normalizeDatabase(JSON.parse(raw));
  } catch {
    const initial = createEmptyDatabase();
    writeDatabase(initial);
    return initial;
  }
}

function writeDatabase(database) {
  const normalized = normalizeDatabase(database);
  writeStorage(JSON.stringify(normalized));
  return normalized;
}

function nextId(database, key) {
  const current = Number(database.counters[key] || 1);
  database.counters[key] = current + 1;
  return current;
}

function findCustomer(database, customerId) {
  return database.customers.find((item) => Number(item.id) === Number(customerId)) || null;
}

function findProduct(database, productId) {
  return database.products.find((item) => Number(item.id) === Number(productId)) || null;
}

function findOrder(database, orderId) {
  return database.orders.find((item) => Number(item.id) === Number(orderId)) || null;
}

function getPaymentsByOrder(database, orderId) {
  return database.payments.filter(
    (payment) => Number(payment.catalogOrderId) === Number(orderId)
  );
}

function deriveOrderStatus(order, paidAmount) {
  if (order.status === "entregado" || order.status === "anulado") {
    return order.status;
  }
  if (paidAmount >= order.totalAmount && order.totalAmount > 0) {
    return "cobrado_completo";
  }
  if (paidAmount > 0) {
    return "cobrado_parcial";
  }
  return "por_cobrar";
}

function hydrateOrder(database, order) {
  const customer = findCustomer(database, order.customerId);
  const paidAmount = toMoney(
    getPaymentsByOrder(database, order.id).reduce((sum, payment) => sum + payment.amount, 0)
  );
  const totalAmount = toMoney(order.totalAmount);
  const status = deriveOrderStatus(order, paidAmount);
  return {
    ...order,
    status,
    totalAmount,
    paidAmount,
    balanceAmount: toMoney(Math.max(totalAmount - paidAmount, 0)),
    customerName: customer?.name || "Cliente",
    customerPhone: customer?.phone || "",
    items: ensureArray(order.items).map((item) => ({
      ...item,
      unitPrice: toMoney(item.unitPrice),
      lineTotal: toMoney(item.lineTotal)
    }))
  };
}

function hydratePayment(database, payment) {
  const customer = findCustomer(database, payment.customerId);
  const order = payment.catalogOrderId
    ? findOrder(database, payment.catalogOrderId)
    : null;
  return {
    ...payment,
    amount: toMoney(payment.amount),
    customerName: customer?.name || "Cliente",
    orderBrand: order?.brand || "",
    orderCampaign: order?.campaign || ""
  };
}

function hydrateProduct(product) {
  return {
    ...product,
    cost: product.cost === null || product.cost === undefined ? null : toMoney(product.cost),
    price: toMoney(product.price),
    stock: Number(product.stock || 0),
    minStock: Number(product.minStock || 0),
    isActive: Number(product.isActive ?? 1)
  };
}

function hydrateMovement(database, movement) {
  const product = findProduct(database, movement.productId);
  return {
    ...movement,
    productName: product?.name || "Producto",
    productCategory: product?.category || ""
  };
}

function hydrateSale(database, sale) {
  const customer = sale.customerId ? findCustomer(database, sale.customerId) : null;
  const product = findProduct(database, sale.productId);
  return {
    ...sale,
    unitPrice: toMoney(sale.unitPrice),
    totalAmount: toMoney(sale.totalAmount),
    customerName: customer?.name || "",
    productName: product?.name || "Producto",
    productCategory: product?.category || ""
  };
}

function getCustomerStats(database, customer) {
  const orders = getCatalogOrdersSync(database).filter(
    (order) => Number(order.customerId) === Number(customer.id)
  );
  const payments = getPaymentsSync(database).filter(
    (payment) => Number(payment.customerId) === Number(customer.id)
  );
  const sales = getSalesSync(database).filter(
    (sale) => Number(sale.customerId) === Number(customer.id)
  );

  return {
    saldoTotal: toMoney(orders.reduce((sum, order) => sum + order.balanceAmount, 0)),
    ordersCount: orders.length,
    salesCount: sales.length,
    paymentsCount: payments.length,
    lastActivityAt: [customer.updatedAt]
      .concat(orders.map((item) => item.createdAt))
      .concat(payments.map((item) => item.createdAt))
      .concat(sales.map((item) => item.createdAt))
      .filter(Boolean)
      .sort()
      .at(-1) || customer.updatedAt
  };
}

function getCustomersSync(database) {
  return database.customers
    .map((customer) => ({
      ...customer,
      ...getCustomerStats(database, customer)
    }))
    .sort((a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || ""));
}

function getCatalogOrdersSync(database) {
  return database.orders
    .map((order) => hydrateOrder(database, order))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function getPaymentsSync(database) {
  return database.payments
    .map((payment) => hydratePayment(database, payment))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function getProductsSync(database) {
  return database.products
    .map(hydrateProduct)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function getInventoryMovementsSync(database) {
  return database.movements
    .map((movement) => hydrateMovement(database, movement))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function getSalesSync(database) {
  return database.sales
    .map((sale) => hydrateSale(database, sale))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function buildDashboard(database) {
  const orders = getCatalogOrdersSync(database);
  const payments = getPaymentsSync(database);
  const products = getProductsSync(database);
  const customers = getCustomersSync(database);
  const sales = getSalesSync(database);
  const todayPrefix = nowIso().slice(0, 10);

  const todaySales = sales.filter((item) => item.createdAt.startsWith(todayPrefix));
  const todayPayments = payments.filter((item) => item.createdAt.startsWith(todayPrefix));

  return {
    today: {
      salesAmount: toMoney(todaySales.reduce((sum, item) => sum + item.totalAmount, 0)),
      salesCount: todaySales.length,
      paymentsAmount: toMoney(
        todayPayments.reduce((sum, item) => sum + item.amount, 0)
      ),
      paymentsCount: todayPayments.length
    },
    pendingOrders: orders.filter(
      (order) =>
        order.status !== "entregado" &&
        order.status !== "anulado" &&
        order.balanceAmount > 0
    ).length,
    customersWithBalance: customers.filter((customer) => customer.saldoTotal > 0)
      .length,
    lowStockProducts: products.filter((product) => product.stock <= product.minStock)
      .length
  };
}

export async function getCustomers() {
  return { ok: true, customers: getCustomersSync(readDatabase()) };
}

export async function getAppConfig() {
  const database = readDatabase();
  return {
    ok: true,
    config: clone(database.settings)
  };
}

export async function addBrandOption(name) {
  const database = readDatabase();
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error("La marca no puede quedar vacía.");
  }

  database.settings.brands = normalizeOptionList(
    [...database.settings.brands, normalized],
    defaultDatabase.settings.brands
  );
  writeDatabase(database);
  return { ok: true, brands: clone(database.settings.brands) };
}

export async function removeBrandOption(name) {
  const database = readDatabase();
  const normalized = String(name || "").trim();
  const nextBrands = database.settings.brands.filter((item) => item !== normalized);

  if (nextBrands.length === 0) {
    throw new Error("Debe quedar al menos una marca.");
  }

  database.settings.brands = nextBrands;
  writeDatabase(database);
  return { ok: true, brands: clone(database.settings.brands) };
}

export async function addCategoryOption(name) {
  const database = readDatabase();
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error("La categoría no puede quedar vacía.");
  }

  database.settings.categories = normalizeOptionList(
    [...database.settings.categories, normalized],
    defaultDatabase.settings.categories
  );
  writeDatabase(database);
  return { ok: true, categories: clone(database.settings.categories) };
}

export async function removeCategoryOption(name) {
  const database = readDatabase();
  const normalized = String(name || "").trim();
  const nextCategories = database.settings.categories.filter(
    (item) => item !== normalized
  );

  if (nextCategories.length === 0) {
    throw new Error("Debe quedar al menos una categoría.");
  }

  database.settings.categories = nextCategories;
  writeDatabase(database);
  return { ok: true, categories: clone(database.settings.categories) };
}

export async function createCustomer(customerInput) {
  const database = readDatabase();
  const timestamp = nowIso();
  const customer = {
    id: nextId(database, "customers"),
    name: customerInput.name.trim(),
    phone: customerInput.phone?.trim() || "",
    notes: customerInput.notes?.trim() || "",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  database.customers.push(customer);
  writeDatabase(database);

  return {
    ok: true,
    customer: {
      ...customer,
      saldoTotal: 0,
      ordersCount: 0,
      salesCount: 0,
      paymentsCount: 0,
      lastActivityAt: timestamp
    }
  };
}

export async function getCatalogOrders() {
  return { ok: true, orders: getCatalogOrdersSync(readDatabase()) };
}

export async function createCatalogOrder(orderInput) {
  const database = readDatabase();
  const customer = findCustomer(database, orderInput.customerId);
  if (!customer) {
    throw new Error("No se encontró el cliente del pedido.");
  }

  const timestamp = nowIso();
  const items = ensureArray(orderInput.items).map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = toMoney(item.unitPrice);
    return {
      id: nextId(database, "orderItems"),
      productCode: item.productCode?.trim() || "",
      description: item.description?.trim() || "",
      size: item.size?.trim() || "",
      color: item.color?.trim() || "",
      quantity,
      unitPrice,
      lineTotal: toMoney(quantity * unitPrice)
    };
  });

  const totalAmount = toMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const order = {
    id: nextId(database, "orders"),
    customerId: Number(orderInput.customerId),
    brand: orderInput.brand?.trim() || "Otro",
    campaign: orderInput.campaign?.trim() || "",
    status: orderInput.status || "por_cobrar",
    totalAmount,
    createdAt: timestamp,
    updatedAt: timestamp,
    items
  };

  database.orders.push(order);

  if (Number(orderInput.initialPaidAmount || 0) > 0) {
    database.payments.push({
      id: nextId(database, "payments"),
      customerId: order.customerId,
      catalogOrderId: order.id,
      amount: toMoney(orderInput.initialPaidAmount),
      method: orderInput.paymentMethod || "efectivo",
      note: orderInput.paymentNote?.trim() || "",
      createdAt: timestamp
    });
  }

  writeDatabase(database);
  return { ok: true, order: hydrateOrder(database, order) };
}

export async function updateCatalogOrderStatus(orderId, status) {
  const database = readDatabase();
  const order = findOrder(database, orderId);
  if (!order) {
    throw new Error("Pedido no encontrado.");
  }

  order.status = status;
  order.updatedAt = nowIso();
  writeDatabase(database);

  return { ok: true, order: hydrateOrder(database, order) };
}

export async function getPayments() {
  return { ok: true, payments: getPaymentsSync(readDatabase()) };
}

export async function createPayment(paymentInput) {
  const database = readDatabase();
  let customerId = Number(paymentInput.customerId || 0);
  let catalogOrderId = paymentInput.catalogOrderId
    ? Number(paymentInput.catalogOrderId)
    : null;

  if (catalogOrderId) {
    const order = findOrder(database, catalogOrderId);
    if (!order) {
      throw new Error("No se encontró el pedido relacionado al pago.");
    }
    customerId = Number(order.customerId);
    order.updatedAt = nowIso();
  }

  const customer = findCustomer(database, customerId);
  if (!customer) {
    throw new Error("No se encontró el cliente relacionado al pago.");
  }

  const payment = {
    id: nextId(database, "payments"),
    customerId,
    catalogOrderId,
    amount: toMoney(paymentInput.amount),
    method: paymentInput.method || "efectivo",
    note: paymentInput.note?.trim() || "",
    createdAt: nowIso()
  };

  database.payments.push(payment);
  writeDatabase(database);

  return { ok: true, payment: hydratePayment(database, payment) };
}

export async function getProducts() {
  return { ok: true, products: getProductsSync(readDatabase()) };
}

export async function createProduct(productInput) {
  const database = readDatabase();
  const timestamp = nowIso();
  const product = {
    id: nextId(database, "products"),
    name: productInput.name?.trim() || "",
    category: productInput.category?.trim() || "bebidas",
    cost:
      productInput.cost === "" || productInput.cost === null || productInput.cost === undefined
        ? null
        : toMoney(productInput.cost),
    price: toMoney(productInput.price),
    stock: toInteger(productInput.stock || 0),
    minStock: toInteger(productInput.minStock || 0),
    isActive: productInput.isActive === false ? 0 : 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  database.products.push(product);
  writeDatabase(database);

  return { ok: true, product: hydrateProduct(product) };
}

export async function getInventoryMovements() {
  return { ok: true, movements: getInventoryMovementsSync(readDatabase()) };
}

export async function createInventoryMovement(movementInput) {
  const database = readDatabase();
  const product = findProduct(database, movementInput.productId);
  if (!product) {
    throw new Error("No se encontró el producto para registrar el ingreso.");
  }

  product.stock = Number(product.stock || 0) + Number(movementInput.quantity || 0);
  product.updatedAt = nowIso();

  const movement = {
    id: nextId(database, "movements"),
    productId: Number(movementInput.productId),
    type: "ingreso",
    quantity: Number(movementInput.quantity || 0),
    note: movementInput.note?.trim() || "",
    createdAt: nowIso()
  };

  database.movements.push(movement);
  writeDatabase(database);

  return { ok: true, movement: hydrateMovement(database, movement) };
}

export async function getSales() {
  return { ok: true, sales: getSalesSync(readDatabase()) };
}

export async function createSale(saleInput) {
  const database = readDatabase();
  const product = findProduct(database, saleInput.productId);
  if (!product) {
    throw new Error("No se encontró el producto para registrar la venta.");
  }

  const quantity = Number(saleInput.quantity || 0);
  if (Number(product.stock || 0) < quantity) {
    throw new Error("No hay stock suficiente para registrar la venta.");
  }

  const customerId = saleInput.customerId ? Number(saleInput.customerId) : null;
  if (customerId && !findCustomer(database, customerId)) {
    throw new Error("No se encontró el cliente de la venta.");
  }

  product.stock = Number(product.stock || 0) - quantity;
  product.updatedAt = nowIso();

  const sale = {
    id: nextId(database, "sales"),
    customerId,
    productId: Number(saleInput.productId),
    quantity,
    unitPrice: toMoney(product.price),
    totalAmount: toMoney(quantity * Number(product.price || 0)),
    createdAt: nowIso()
  };

  database.sales.push(sale);
  writeDatabase(database);

  return { ok: true, sale: hydrateSale(database, sale) };
}

export async function getDashboardToday() {
  return { ok: true, dashboard: buildDashboard(readDatabase()) };
}

export function exportBackupData() {
  const database = readDatabase();
  return {
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    app: "jazmin",
    data: clone(database)
  };
}

export function importBackupData(input) {
  let payload = input;
  if (typeof input === "string") {
    payload = JSON.parse(input);
  }

  const database = normalizeDatabase(payload);
  writeDatabase(database);
  return {
    ok: true,
    importedAt: nowIso(),
    counts: {
      customers: database.customers.length,
      orders: database.orders.length,
      payments: database.payments.length,
      products: database.products.length,
      movements: database.movements.length,
      sales: database.sales.length
    }
  };
}

