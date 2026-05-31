import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FiBox,
  FiDollarSign,
  FiHome,
  FiPackage,
  FiRefreshCw,
  FiUsers
} from "react-icons/fi";
import {
  addBrandOption,
  addCategoryOption,
  createCatalogOrder,
  createCustomer,
  createInventoryMovement,
  createPayment,
  createProduct,
  createSale,
  exportBackupData,
  getAppConfig,
  getCatalogOrders,
  getCustomers,
  getInventoryMovements,
  getPayments,
  getProducts,
  getSales,
  importBackupData,
  removeBrandOption,
  removeCategoryOption,
  updateCatalogOrderStatus
} from "../api";
import {
  loadCachedSnapshot,
  loadDrafts,
  loadLastSyncedAt,
  loadPendingActions,
  loadStoredPin,
  loadUnlockedSession,
  saveCachedSnapshot,
  saveDrafts,
  saveLastSyncedAt,
  savePendingActions,
  saveStoredPin,
  saveUnlockedSession
} from "../mobileStore";
import { formatCurrency, formatDate } from "../utils";

const tabs = [
  { id: "inicio", label: "Inicio", icon: FiHome },
  { id: "pedidos", label: "Pedidos", icon: FiPackage },
  { id: "cobros", label: "Cobros", icon: FiDollarSign },
  { id: "stock", label: "Stock", icon: FiBox },
  { id: "clientes", label: "Clientes", icon: FiUsers },
  { id: "sync", label: "Respaldo", icon: FiRefreshCw }
];

const orderStatusOptions = [
  { value: "por_cobrar", label: "Por cobrar" },
  { value: "cobrado_parcial", label: "Cobrado parcial" },
  { value: "cobrado_completo", label: "Cobrado completo" },
  { value: "entregado", label: "Entregado" },
  { value: "anulado", label: "Anulado" }
];
const paymentMethods = [
  { value: "efectivo", label: "Efectivo" },
  { value: "yape", label: "Yape" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" }
];

const initialCustomerForm = {
  name: "",
  phone: "",
  notes: ""
};

const initialOrderItem = {
  productCode: "",
  description: "",
  size: "",
  color: "",
  quantity: 1,
  unitPrice: ""
};

const initialOrderForm = {
  customerId: "",
  quickCustomerName: "",
  quickCustomerPhone: "",
  brand: "Pacifika",
  campaign: "",
  status: "por_cobrar",
  initialPaidAmount: "",
  paymentMethod: "efectivo",
  paymentNote: "",
  items: [{ ...initialOrderItem }]
};

const initialPaymentForm = {
  catalogOrderId: "",
  amount: "",
  method: "efectivo",
  note: ""
};

const initialProductForm = {
  name: "",
  category: "bebidas artesanales",
  cost: "",
  price: "",
  stock: "",
  minStock: ""
};

const initialConfig = {
  brands: ["Pacifika", "Carmel"],
  categories: ["bebidas artesanales"]
};

const initialIngressForm = {
  productId: "",
  quantity: "",
  note: ""
};

const initialSaleForm = {
  productId: "",
  customerId: "",
  quantity: 1
};

const initialSnapshot = {
  customers: [],
  orders: [],
  payments: [],
  products: [],
  movements: [],
  sales: []
};

const tabTransition = {
  initial: { opacity: 0, y: 18, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.99 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
};

const initialDrafts = {
  customerForm: initialCustomerForm,
  orderForm: initialOrderForm,
  paymentForm: initialPaymentForm,
  productForm: initialProductForm,
  ingressForm: initialIngressForm,
  saleForm: initialSaleForm
};

function nowIso() {
  return new Date().toISOString();
}

function createPendingId(prefix) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function isOnlineNow() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function isNetworkError(error) {
  const message = String(error?.message || "");
  return /fetch|network|failed|offline/i.test(message);
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getStatusLabel(status) {
  return (
    orderStatusOptions.find((option) => option.value === normalizeOrderStatus(status))
      ?.label || normalizeOrderStatus(status)
  );
}

function getStatusTone(status) {
  const normalizedStatus = normalizeOrderStatus(status);
  if (status === "anulado") {
    return "danger";
  }
  if (normalizedStatus === "entregado" || normalizedStatus === "cobrado_completo") {
    return "success";
  }
  return "warning";
}

function normalizeOrderStatus(status) {
  if (status === "borrador" || status === "pedido_hecho_empresa") {
    return "por_cobrar";
  }
  return status;
}

function formatSyncStatus(isOnline, pendingCount) {
  if (pendingCount > 0) {
    return "Hay cambios pendientes por revisar en esta sesi\u00f3n.";
  }
  return "Todo guardado localmente en este tel\u00e9fono.";
}

function buildPendingCustomerRecord(action) {
  return {
    id: action.tempId,
    name: action.payload.name,
    phone: action.payload.phone || "",
    notes: action.payload.notes || "",
    createdAt: action.createdAt,
    updatedAt: action.createdAt,
    isPending: true
  };
}

function buildMergedState(snapshot, pendingActions) {
  const customersBase = Array.isArray(snapshot.customers) ? snapshot.customers : [];
  const ordersBase = Array.isArray(snapshot.orders) ? snapshot.orders : [];
  const paymentsBase = Array.isArray(snapshot.payments) ? snapshot.payments : [];
  const productsBase = Array.isArray(snapshot.products) ? snapshot.products : [];
  const movementsBase = Array.isArray(snapshot.movements) ? snapshot.movements : [];
  const salesBase = Array.isArray(snapshot.sales) ? snapshot.sales : [];

  const customerMap = new Map(
    customersBase.map((customer) => [
      customer.id,
      {
        ...customer,
        isPending: false
      }
    ])
  );

  const productMap = new Map(
    productsBase.map((product) => [
      product.id,
      {
        ...product,
        stock: Number(product.stock || 0),
        minStock: Number(product.minStock || 0)
      }
    ])
  );

  const pendingOrders = [];
  const pendingPayments = [];
  const pendingMovements = [];
  const pendingSales = [];

  for (const action of pendingActions) {
    if (action.type === "create_customer") {
      customerMap.set(action.tempId, buildPendingCustomerRecord(action));
      continue;
    }

    if (action.type === "create_catalog_order") {
      let customerId = action.payload.customerId || null;
      let customerName = "";
      let customerPhone = "";

      if (customerId && customerMap.has(customerId)) {
        const customer = customerMap.get(customerId);
        customerName = customer.name;
        customerPhone = customer.phone || "";
      } else if (action.payload.quickCustomerName) {
        customerId = action.tempCustomerId;
        customerName = action.payload.quickCustomerName;
        customerPhone = action.payload.quickCustomerPhone || "";
        if (!customerMap.has(customerId)) {
          customerMap.set(customerId, {
            id: customerId,
            name: customerName,
            phone: customerPhone,
            notes: "Cliente pendiente creado desde pedido offline.",
            createdAt: action.createdAt,
            updatedAt: action.createdAt,
            isPending: true
          });
        }
      }

      const totalAmount = Number(
        action.payload.items.reduce(
          (sum, item) => sum + toNumber(item.quantity) * toNumber(item.unitPrice),
          0
        ).toFixed(2)
      );
      const initialPaid = Number(
        toNumber(action.payload.initialPaidAmount).toFixed(2)
      );
      const derivedStatus =
        initialPaid >= totalAmount && totalAmount > 0
          ? "cobrado_completo"
          : initialPaid > 0
            ? "cobrado_parcial"
            : normalizeOrderStatus(action.payload.status);

      pendingOrders.push({
        id: action.tempId,
        customerId,
        customerName: customerName || "Cliente pendiente",
        customerPhone,
        brand: action.payload.brand,
        campaign: action.payload.campaign,
        status: derivedStatus,
        totalAmount,
        paidAmount: initialPaid,
        balanceAmount: Number(Math.max(totalAmount - initialPaid, 0).toFixed(2)),
        createdAt: action.createdAt,
        updatedAt: action.createdAt,
        items: action.payload.items.map((item, index) => ({
          id: `${action.tempId}-item-${index}`,
          orderId: action.tempId,
          productCode: item.productCode || "",
          description: item.description,
          size: item.size,
          color: item.color,
          quantity: toNumber(item.quantity),
          unitPrice: toNumber(item.unitPrice),
          lineTotal: Number(
            (toNumber(item.quantity) * toNumber(item.unitPrice)).toFixed(2)
          )
        })),
        isPending: true
      });
      continue;
    }

    if (action.type === "create_payment") {
      pendingPayments.push({
        id: action.tempId,
        customerId: action.payload.customerId || null,
        catalogOrderId: action.payload.catalogOrderId || null,
        amount: toNumber(action.payload.amount),
        method: action.payload.method,
        note: action.payload.note || "",
        createdAt: action.createdAt,
        customerName: action.payload.customerName || "Cliente pendiente",
        orderBrand: action.payload.orderBrand || "",
        orderCampaign: action.payload.orderCampaign || "",
        isPending: true
      });
      continue;
    }

    if (action.type === "create_inventory_movement") {
      const product = productMap.get(action.payload.productId);
      if (product) {
        product.stock += toNumber(action.payload.quantity);
      }
      pendingMovements.push({
        id: action.tempId,
        productId: action.payload.productId,
        type: "ingreso",
        quantity: toNumber(action.payload.quantity),
        note: action.payload.note || "",
        createdAt: action.createdAt,
        productName: action.payload.productName || "Producto",
        productCategory: action.payload.productCategory || "",
        isPending: true
      });
      continue;
    }

    if (action.type === "create_sale") {
      const product = productMap.get(action.payload.productId);
      if (product) {
        product.stock -= toNumber(action.payload.quantity);
      }
      pendingSales.push({
        id: action.tempId,
        customerId: action.payload.customerId || null,
        productId: action.payload.productId,
        quantity: toNumber(action.payload.quantity),
        unitPrice: toNumber(action.payload.unitPrice),
        totalAmount: Number(
          (toNumber(action.payload.quantity) * toNumber(action.payload.unitPrice)).toFixed(2)
        ),
        createdAt: action.createdAt,
        productName: action.payload.productName || "Producto",
        productCategory: action.payload.productCategory || "",
        customerName: action.payload.customerName || "",
        isPending: true
      });
      pendingMovements.push({
        id: `${action.tempId}-movement`,
        productId: action.payload.productId,
        type: "venta",
        quantity: toNumber(action.payload.quantity),
        note: "Venta pendiente de guardar.",
        createdAt: action.createdAt,
        productName: action.payload.productName || "Producto",
        productCategory: action.payload.productCategory || "",
        isPending: true
      });
    }
  }

  const ordersMap = new Map();
  for (const order of [...ordersBase, ...pendingOrders]) {
    ordersMap.set(order.id, {
      ...order,
      totalAmount: Number(order.totalAmount || 0),
      paidAmount: Number(order.paidAmount || 0),
      balanceAmount: Number(order.balanceAmount || 0)
    });
  }

  for (const payment of pendingPayments) {
    if (payment.catalogOrderId && ordersMap.has(payment.catalogOrderId)) {
      const order = ordersMap.get(payment.catalogOrderId);
      const paidAmount = Number((order.paidAmount + payment.amount).toFixed(2));
      const balanceAmount = Number(
        Math.max(order.totalAmount - paidAmount, 0).toFixed(2)
      );
      order.paidAmount = paidAmount;
      order.balanceAmount = balanceAmount;
      if (balanceAmount === 0 && order.totalAmount > 0) {
        order.status = "cobrado_completo";
      } else if (paidAmount > 0) {
        order.status = "cobrado_parcial";
      }
    }
  }

  const mergedOrders = Array.from(ordersMap.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  const mergedPayments = [...pendingPayments, ...paymentsBase].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  const mergedProducts = Array.from(productMap.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  const mergedMovements = [...pendingMovements, ...movementsBase].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  const mergedSales = [...pendingSales, ...salesBase].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  const recalculatedCustomers = Array.from(customerMap.values()).map((customer) => {
    const customerOrders = mergedOrders.filter((order) => order.customerId === customer.id);
    const customerPayments = mergedPayments.filter(
      (payment) => payment.customerId === customer.id
    );
    const customerSales = mergedSales.filter((sale) => sale.customerId === customer.id);

    return {
      ...customer,
      totalCatalogAmount: Number(
        customerOrders.reduce((sum, order) => sum + order.totalAmount, 0).toFixed(2)
      ),
      totalPaidAmount: Number(
        customerPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)
      ),
      saldoTotal: Number(
        customerOrders.reduce((sum, order) => sum + order.balanceAmount, 0).toFixed(2)
      ),
      ordersCount: customerOrders.length,
      salesCount: customerSales.length,
      paymentsCount: customerPayments.length,
      lastActivityAt: [customer.updatedAt]
        .concat(customerOrders.map((order) => order.createdAt))
        .concat(customerPayments.map((payment) => payment.createdAt))
        .concat(customerSales.map((sale) => sale.createdAt))
        .filter(Boolean)
        .sort()
        .at(-1) || customer.updatedAt
    };
  });

  recalculatedCustomers.sort((a, b) =>
    (b.lastActivityAt || "").localeCompare(a.lastActivityAt || "")
  );

  return {
    customers: recalculatedCustomers,
    orders: mergedOrders,
    payments: mergedPayments,
    products: mergedProducts,
    movements: mergedMovements,
    sales: mergedSales
  };
}

function buildDashboard(state) {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todaySales = state.sales.filter((sale) => sale.createdAt.startsWith(todayPrefix));
  const todayPayments = state.payments.filter((payment) =>
    payment.createdAt.startsWith(todayPrefix)
  );
  const lowStockItems = state.products.filter(
    (product) => product.stock <= product.minStock
  );

  return {
    today: {
      salesAmount: Number(
        todaySales.reduce((sum, sale) => sum + sale.totalAmount, 0).toFixed(2)
      ),
      salesCount: todaySales.length,
      paymentsAmount: Number(
        todayPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)
      ),
      paymentsCount: todayPayments.length
    },
    pendingOrders: state.orders.filter(
      (order) => order.status !== "entregado" && order.status !== "anulado" && order.balanceAmount > 0
    ).length,
    customersWithBalance: state.customers.filter((customer) => customer.saldoTotal > 0)
      .length,
    lowStockProducts: lowStockItems.length,
    recentOrders: state.orders.slice(0, 5),
    recentPayments: state.payments.slice(0, 5),
    lowStockItems: lowStockItems.slice(0, 5)
  };
}

function summarizeCustomerHistory(customer, orders, payments, sales) {
  const history = [
    ...orders
      .filter((order) => order.customerId === customer.id)
      .map((order) => ({
        id: `order-${order.id}`,
        createdAt: order.createdAt,
        text: `${order.brand}${order.campaign ? ` - ${order.campaign}` : ""}: ${formatCurrency(order.totalAmount)}`
      })),
    ...payments
      .filter((payment) => payment.customerId === customer.id)
      .map((payment) => ({
        id: `payment-${payment.id}`,
        createdAt: payment.createdAt,
        text: `Abono ${payment.method}: ${formatCurrency(payment.amount)}`
      })),
    ...sales
      .filter((sale) => sale.customerId === customer.id)
      .map((sale) => ({
        id: `sale-${sale.id}`,
        createdAt: sale.createdAt,
        text: `Bebida ${sale.productName}: ${formatCurrency(sale.totalAmount)}`
      }))
  ];

  return history
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
}

export function VentasAppPage() {
  const storedPin = loadStoredPin();
  const [pin, setPin] = useState(storedPin);
  const [isUnlocked, setIsUnlocked] = useState(storedPin ? loadUnlockedSession() : false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [activeTab, setActiveTab] = useState("inicio");
  const [online] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState({ type: "", message: "" });
  const [lastSyncedAt, setLastSyncedAt] = useState(loadLastSyncedAt());
  const [appConfig, setAppConfig] = useState(initialConfig);
  const [serverSnapshot, setServerSnapshot] = useState(
    loadCachedSnapshot(initialSnapshot)
  );
  const [pendingActions, setPendingActions] = useState([]);
  const backupInputRef = useRef(null);
  const storedDrafts = loadDrafts(initialDrafts);

  const [customerForm, setCustomerForm] = useState(storedDrafts.customerForm);
  const [orderForm, setOrderForm] = useState(storedDrafts.orderForm);
  const [paymentForm, setPaymentForm] = useState(storedDrafts.paymentForm);
  const [productForm, setProductForm] = useState(storedDrafts.productForm);
  const [ingressForm, setIngressForm] = useState(storedDrafts.ingressForm);
  const [saleForm, setSaleForm] = useState(storedDrafts.saleForm);
  const [brandDraft, setBrandDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");

  const mergedState = useMemo(
    () => buildMergedState(serverSnapshot, pendingActions),
    [serverSnapshot, pendingActions]
  );
  const dashboard = useMemo(() => buildDashboard(mergedState), [mergedState]);
  const brandOptions = appConfig.brands.length > 0 ? appConfig.brands : initialConfig.brands;
  const categoryOptions =
    appConfig.categories.length > 0 ? appConfig.categories : initialConfig.categories;

  const serverCustomerOptions = serverSnapshot.customers.map((customer) => ({
    value: customer.id,
    label: `${customer.name}${customer.phone ? ` - ${customer.phone}` : ""}`
  }));
  const serverProductOptions = serverSnapshot.products.filter((product) => product.isActive);
  const openOrders = mergedState.orders.filter(
    (order) => order.status !== "anulado" && order.balanceAmount > 0
  );
  const orderDraftTotal = orderForm.items.reduce((sum, item) => {
    return sum + toNumber(item.quantity) * toNumber(item.unitPrice);
  }, 0);

  function persistPending(nextActions) {
    setPendingActions(nextActions);
    savePendingActions(nextActions);
  }

  function showSuccess(message) {
    setFlash({ type: "ok", message });
    setError("");
  }

  function clearFlash() {
    setFlash({ type: "", message: "" });
  }

  async function loadAppData(withLoader = false) {
    if (withLoader) {
      setLoading(true);
    }

    try {
      const [configResponse, customersResponse, ordersResponse, paymentsResponse, productsResponse, movementsResponse, salesResponse] =
        await Promise.all([
          getAppConfig(),
          getCustomers(),
          getCatalogOrders(),
          getPayments(),
          getProducts(),
          getInventoryMovements(),
          getSales()
        ]);

      setAppConfig(configResponse.config);
      const snapshot = {
        customers: customersResponse.customers,
        orders: ordersResponse.orders,
        payments: paymentsResponse.payments,
        products: productsResponse.products,
        movements: movementsResponse.movements,
        sales: salesResponse.sales
      };

      setServerSnapshot(snapshot);
      saveCachedSnapshot(snapshot);
      const syncedAt = nowIso();
      setLastSyncedAt(syncedAt);
      saveLastSyncedAt(syncedAt);
      setError("");
    } catch (loadError) {
      const cached = loadCachedSnapshot(initialSnapshot);
      setServerSnapshot(cached);
      setError(loadError.message || "No se pudo abrir la base local.");
    } finally {
      setLoading(false);
    }
  }

  async function flushPendingActions() {
    if (!isOnlineNow() || pendingActions.length === 0 || syncing) {
      return;
    }

    setSyncing(true);
    setError("");

    let queue = [...pendingActions];

    try {
      while (queue.length > 0) {
        const current = queue[0];

        if (current.type === "create_customer") {
          await createCustomer(current.payload);
        }

        if (current.type === "create_catalog_order") {
          let customerId = current.payload.customerId || null;

          if (!customerId && current.payload.quickCustomerName) {
            const customerResponse = await createCustomer({
              name: current.payload.quickCustomerName,
              phone: current.payload.quickCustomerPhone,
              notes: "Creado durante el guardado local."
            });
            customerId = customerResponse.customer.id;
          }

          await createCatalogOrder({
            customerId,
            brand: current.payload.brand,
            campaign: current.payload.campaign,
            status: current.payload.status,
            initialPaidAmount: current.payload.initialPaidAmount,
            paymentMethod: current.payload.paymentMethod,
            paymentNote: current.payload.paymentNote,
            items: current.payload.items
          });
        }

        if (current.type === "create_payment") {
          await createPayment({
            catalogOrderId: current.payload.catalogOrderId,
            customerId: current.payload.customerId,
            amount: current.payload.amount,
            method: current.payload.method,
            note: current.payload.note
          });
        }

        if (current.type === "create_inventory_movement") {
          await createInventoryMovement({
            productId: current.payload.productId,
            type: "ingreso",
            quantity: current.payload.quantity,
            note: current.payload.note
          });
        }

        if (current.type === "create_sale") {
          await createSale({
            productId: current.payload.productId,
            customerId: current.payload.customerId,
            quantity: current.payload.quantity
          });
        }

        queue = queue.slice(1);
        persistPending(queue);
      }

      await loadAppData();
      showSuccess("Respaldo local actualizado correctamente.");
    } catch (syncError) {
      setError(syncError.message || "No se pudo guardar todo correctamente.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    persistPending([]);
    void loadAppData(true);
  }, []);

  useEffect(() => {
    if (!brandOptions.includes(orderForm.brand)) {
      setOrderForm((prev) => ({
        ...prev,
        brand: brandOptions[0] || ""
      }));
    }
  }, [brandOptions, orderForm.brand]);

  useEffect(() => {
    if (!categoryOptions.includes(productForm.category)) {
      setProductForm((prev) => ({
        ...prev,
        category: categoryOptions[0] || ""
      }));
    }
  }, [categoryOptions, productForm.category]);

  useEffect(() => {
    const drafts = {
      customerForm,
      orderForm,
      paymentForm,
      productForm,
      ingressForm,
      saleForm
    };
    saveDrafts(drafts);
  }, [customerForm, orderForm, paymentForm, productForm, ingressForm, saleForm]);

  useEffect(() => {
    if (online && pendingActions.length > 0 && !syncing && isUnlocked) {
      void flushPendingActions();
    }
  }, [online, pendingActions.length, syncing, isUnlocked]);

  function queueAction(type, payload, extra = {}) {
    const action = {
      id: createPendingId(type),
      tempId: createPendingId("temp"),
      createdAt: nowIso(),
      type,
      payload,
      ...extra
    };
    persistPending([action, ...pendingActions]);
    return action;
  }

  async function handleCreateCustomer(event) {
    event.preventDefault();
    clearFlash();

    try {
      if (online) {
        await createCustomer(customerForm);
        await loadAppData();
        showSuccess("Cliente guardado correctamente.");
      } else {
        queueAction("create_customer", { ...customerForm });
        showSuccess("Cliente guardado como pendiente.");
      }

      setCustomerForm(initialCustomerForm);
      setActiveTab("clientes");
    } catch (actionError) {
      if (isNetworkError(actionError)) {
        queueAction("create_customer", { ...customerForm });
        setCustomerForm(initialCustomerForm);
        showSuccess("Cliente guardado localmente.");
      } else {
        setError(actionError.message || "No se pudo guardar el cliente.");
      }
    }
  }

  function updateOrderItem(index, field, value) {
    setOrderForm((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    }));
  }

  function addOrderItem() {
    setOrderForm((prev) => ({
      ...prev,
      items: [...prev.items, { ...initialOrderItem }]
    }));
  }

  function removeOrderItem(index) {
    setOrderForm((prev) => ({
      ...prev,
      items:
        prev.items.length === 1
          ? prev.items
          : prev.items.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  async function handleCreateOrder(event) {
    event.preventDefault();
    clearFlash();

    const payload = {
      customerId: orderForm.customerId ? Number(orderForm.customerId) : null,
      quickCustomerName: orderForm.quickCustomerName.trim(),
      quickCustomerPhone: orderForm.quickCustomerPhone.trim(),
      brand: orderForm.brand,
      campaign: orderForm.campaign,
      status: orderForm.status,
      initialPaidAmount: toNumber(orderForm.initialPaidAmount),
      paymentMethod: orderForm.paymentMethod,
      paymentNote: orderForm.paymentNote,
      items: orderForm.items.map((item) => ({
        productCode: item.productCode || "",
        description: item.description,
        size: item.size,
        color: item.color,
        quantity: toNumber(item.quantity),
        unitPrice: toNumber(item.unitPrice)
      }))
    };

    try {
      if (online) {
        let customerId = payload.customerId;
        if (!customerId && payload.quickCustomerName) {
          const customerResponse = await createCustomer({
            name: payload.quickCustomerName,
            phone: payload.quickCustomerPhone,
            notes: "Creado desde pedido."
          });
          customerId = customerResponse.customer.id;
        }

        await createCatalogOrder({
          customerId,
          brand: payload.brand,
          campaign: payload.campaign,
          status: payload.status,
          initialPaidAmount: payload.initialPaidAmount,
          paymentMethod: payload.paymentMethod,
          paymentNote: payload.paymentNote,
          items: payload.items
        });
        await loadAppData();
        showSuccess("Pedido guardado correctamente.");
      } else {
        queueAction("create_catalog_order", payload, {
          tempCustomerId: createPendingId("customer")
        });
        showSuccess("Pedido guardado como pendiente.");
      }

      setOrderForm(initialOrderForm);
      setActiveTab("pedidos");
    } catch (actionError) {
      if (isNetworkError(actionError)) {
        queueAction("create_catalog_order", payload, {
          tempCustomerId: createPendingId("customer")
        });
        setOrderForm(initialOrderForm);
        showSuccess("Pedido guardado localmente.");
      } else {
        setError(actionError.message || "No se pudo registrar el pedido.");
      }
    }
  }

  async function handleUpdateOrderStatus(orderId, status) {
    clearFlash();
    try {
      await updateCatalogOrderStatus(orderId, status);
      await loadAppData();
      showSuccess("Estado del pedido actualizado.");
    } catch (actionError) {
      setError(actionError.message || "No se pudo actualizar el pedido.");
    }
  }

  async function handleCreatePayment(event) {
    event.preventDefault();
    clearFlash();

    const linkedOrder = mergedState.orders.find(
      (order) => String(order.id) === String(paymentForm.catalogOrderId)
    );

    const payload = {
      catalogOrderId:
        linkedOrder && !String(linkedOrder.id).startsWith("temp-")
          ? Number(linkedOrder.id)
          : null,
      customerId: linkedOrder?.customerId || null,
      customerName: linkedOrder?.customerName || "Cliente",
      orderBrand: linkedOrder?.brand || "",
      amount: toNumber(paymentForm.amount),
      method: paymentForm.method,
      note: paymentForm.note
    };

    try {
      if (!linkedOrder) {
        throw new Error("Selecciona el pedido al que corresponde el cobro.");
      }

      if (online && payload.catalogOrderId) {
        await createPayment({
          catalogOrderId: payload.catalogOrderId,
          amount: payload.amount,
          method: payload.method,
          note: payload.note
        });
        await loadAppData();
        showSuccess("Cobro registrado correctamente.");
      } else {
        queueAction("create_payment", payload);
        showSuccess("Cobro guardado como pendiente.");
      }

      setPaymentForm(initialPaymentForm);
      setActiveTab("cobros");
    } catch (actionError) {
      if (isNetworkError(actionError)) {
        queueAction("create_payment", payload);
        setPaymentForm(initialPaymentForm);
        showSuccess("Cobro guardado localmente.");
      } else {
        setError(actionError.message || "No se pudo registrar el cobro.");
      }
    }
  }

  async function handleCreateProduct(event) {
    event.preventDefault();
    clearFlash();

    try {
      await createProduct({
        ...productForm,
        cost: productForm.cost === "" ? "" : Number(productForm.cost),
        price: Number(productForm.price || 0),
        stock: Number(productForm.stock || 0),
        minStock: Number(productForm.minStock || 0)
      });
      setProductForm(initialProductForm);
      await loadAppData();
      showSuccess("Producto guardado en stock.");
      setActiveTab("stock");
    } catch (actionError) {
      setError(actionError.message || "No se pudo guardar el producto.");
    }
  }

  async function handleRegisterIngress(event) {
    event.preventDefault();
    clearFlash();

    const product = mergedState.products.find(
      (item) => String(item.id) === String(ingressForm.productId)
    );
    const payload = {
      productId: Number(ingressForm.productId || 0),
      quantity: Number(ingressForm.quantity || 0),
      note: ingressForm.note,
      productName: product?.name || "Producto",
      productCategory: product?.category || ""
    };

    try {
      if (online) {
        await createInventoryMovement({
          productId: payload.productId,
          type: "ingreso",
          quantity: payload.quantity,
          note: payload.note
        });
        await loadAppData();
        showSuccess("Ingreso registrado correctamente.");
      } else {
        queueAction("create_inventory_movement", payload);
        showSuccess("Ingreso guardado como pendiente.");
      }

      setIngressForm(initialIngressForm);
    } catch (actionError) {
      if (isNetworkError(actionError)) {
        queueAction("create_inventory_movement", payload);
        setIngressForm(initialIngressForm);
        showSuccess("Ingreso guardado localmente.");
      } else {
        setError(actionError.message || "No se pudo registrar el ingreso.");
      }
    }
  }

  async function handleRegisterSale(event) {
    event.preventDefault();
    clearFlash();

    const product = mergedState.products.find(
      (item) => String(item.id) === String(saleForm.productId)
    );
    const customer = mergedState.customers.find(
      (item) => String(item.id) === String(saleForm.customerId)
    );
    const payload = {
      productId: Number(saleForm.productId || 0),
      customerId: saleForm.customerId ? Number(saleForm.customerId) : null,
      customerName: customer?.name || "",
      quantity: Number(saleForm.quantity || 0),
      unitPrice: Number(product?.price || 0),
      productName: product?.name || "Producto",
      productCategory: product?.category || ""
    };

    try {
      if (online) {
        await createSale({
          productId: payload.productId,
          customerId: payload.customerId,
          quantity: payload.quantity
        });
        await loadAppData();
        showSuccess("Venta registrada correctamente.");
      } else {
        queueAction("create_sale", payload);
        showSuccess("Venta guardada como pendiente.");
      }

      setSaleForm(initialSaleForm);
      setActiveTab("stock");
    } catch (actionError) {
      if (isNetworkError(actionError)) {
        queueAction("create_sale", payload);
        setSaleForm(initialSaleForm);
        showSuccess("Venta guardada localmente.");
      } else {
        setError(actionError.message || "No se pudo registrar la venta.");
      }
    }
  }

  function handlePinSetup(event) {
    event.preventDefault();
    if (pinDraft.length < 4) {
      setPinError("Usa un PIN de al menos 4 digitos.");
      return;
    }
    if (pinDraft !== pinConfirm) {
      setPinError("El PIN y la confirmacion no coinciden.");
      return;
    }
    saveStoredPin(pinDraft);
    saveUnlockedSession(true);
    setPin(pinDraft);
    setIsUnlocked(true);
    setPinDraft("");
    setPinConfirm("");
    setPinError("");
  }

  function handleUnlock(event) {
    event.preventDefault();
    if (pinDraft !== pin) {
      setPinError("PIN incorrecto.");
      return;
    }
    saveUnlockedSession(true);
    setIsUnlocked(true);
    setPinDraft("");
    setPinError("");
  }

  function handleLock() {
    saveUnlockedSession(false);
    setIsUnlocked(false);
    setActiveTab("inicio");
  }

  async function handleExportBackup() {
    clearFlash();

    try {
      const backup = exportBackupData();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json"
      });
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `jazmin-respaldo-${timestamp}.json`;
      anchor.click();
      window.URL.revokeObjectURL(url);
      showSuccess("Respaldo exportado correctamente.");
    } catch (backupError) {
      setError(backupError.message || "No se pudo exportar el respaldo.");
    }
  }

  async function handleImportBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    clearFlash();

    const confirmed = window.confirm(
      "Importar reemplazar\u00e1 los datos actuales de la app en este tel\u00e9fono. \u00bfDeseas continuar?"
    );

    if (!confirmed) {
      return;
    }

    try {
      const rawText = await file.text();
      const result = importBackupData(rawText);
      await loadAppData();
      showSuccess(
        `Respaldo importado: ${result.counts.customers} cliente(s), ${result.counts.orders} pedido(s) y ${result.counts.products} producto(s).`
      );
    } catch (importError) {
      setError(importError.message || "No se pudo importar el respaldo.");
    }
  }

  async function handleCreateBrand() {
    clearFlash();

    try {
      const response = await addBrandOption(brandDraft);
      setAppConfig((prev) => ({ ...prev, brands: response.brands }));
      setOrderForm((prev) => ({
        ...prev,
        brand: prev.brand || response.brands[0] || ""
      }));
      setBrandDraft("");
      showSuccess("Marca guardada correctamente.");
    } catch (configError) {
      setError(configError.message || "No se pudo guardar la marca.");
    }
  }

  async function handleRemoveBrand(brand) {
    clearFlash();

    try {
      const response = await removeBrandOption(brand);
      setAppConfig((prev) => ({ ...prev, brands: response.brands }));
      setOrderForm((prev) => ({
        ...prev,
        brand: response.brands.includes(prev.brand) ? prev.brand : response.brands[0] || ""
      }));
      showSuccess("Marca eliminada de la lista.");
    } catch (configError) {
      setError(configError.message || "No se pudo eliminar la marca.");
    }
  }

  async function handleCreateCategory() {
    clearFlash();

    try {
      const response = await addCategoryOption(categoryDraft);
      setAppConfig((prev) => ({ ...prev, categories: response.categories }));
      setProductForm((prev) => ({
        ...prev,
        category: prev.category || response.categories[0] || ""
      }));
      setCategoryDraft("");
      showSuccess("Categor\u00eda guardada correctamente.");
    } catch (configError) {
      setError(configError.message || "No se pudo guardar la categor\u00eda.");
    }
  }

  async function handleRemoveCategory(category) {
    clearFlash();

    try {
      const response = await removeCategoryOption(category);
      setAppConfig((prev) => ({ ...prev, categories: response.categories }));
      setProductForm((prev) => ({
        ...prev,
        category: response.categories.includes(prev.category)
          ? prev.category
          : response.categories[0] || ""
      }));
      showSuccess("Categor\u00eda eliminada de la lista.");
    } catch (configError) {
      setError(configError.message || "No se pudo eliminar la categor\u00eda.");
    }
  }

  function renderEmptyCard(title, text) {
    return (
      <article className="ventas-card ventas-empty-card">
        <h3>{title}</h3>
        <p>{text}</p>
      </article>
    );
  }

  function renderInicio() {
    return (
      <section className="ventas-tab-grid">
        <article className="ventas-card ventas-hero-card">
          <p className="eyebrow">HOY</p>
          <h1>Ventas, cobros y stock en una sola app.</h1>
          <p>
            {"Lista para operar desde el tel\u00e9fono y seguir funcionando aunque falle la conexi\u00f3n por momentos."}

          </p>
          <div className="ventas-quick-actions">
            <button
              type="button"
              className="button button-ghost ventas-quick-button"
              onClick={() => setActiveTab("pedidos")}
            >
              Nuevo pedido
            </button>
            <button
              type="button"
              className="button button-ghost ventas-quick-button"
              onClick={() => setActiveTab("cobros")}
            >
              Registrar cobro
            </button>
            <button
              type="button"
              className="button button-ghost ventas-quick-button"
              onClick={() => setActiveTab("stock")}
            >
              Venta bebida
            </button>
            <button
              type="button"
              className="button button-ghost ventas-quick-button"
              onClick={() => setActiveTab("sync")}
            >
              Respaldo
            </button>
          </div>
        </article>

        <section className="ventas-metric-grid">
          <article className="ventas-metric-card">
            <span>{"Ventas del d\u00eda"}</span>
            <strong>{formatCurrency(dashboard.today.salesAmount)}</strong>
            <small>{dashboard.today.salesCount} venta(s)</small>
          </article>
          <article className="ventas-metric-card">
            <span>{"Cobros del d\u00eda"}</span>
            <strong>{formatCurrency(dashboard.today.paymentsAmount)}</strong>
            <small>{dashboard.today.paymentsCount} cobro(s)</small>
          </article>
          <article className="ventas-metric-card">
            <span>Pedidos pendientes</span>
            <strong>{dashboard.pendingOrders}</strong>
            <small>Con saldo o seguimiento</small>
          </article>
          <article className="ventas-metric-card">
            <span>Clientes con saldo</span>
            <strong>{dashboard.customersWithBalance}</strong>
            <small>{"Para cobranza r\u00e1pida"}</small>
          </article>
        </section>













        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>Alertas de stock</h2>
            <span className="pill warning">{dashboard.lowStockProducts}</span>
          </div>
          {dashboard.lowStockItems.length === 0 ? (
            <p>No hay productos en stock bajo por ahora.</p>
          ) : (
            <div className="ventas-list-stack">
              {dashboard.lowStockItems.map((product) => (
                <article key={product.id} className="ventas-list-card">
                  <strong>{product.name}</strong>
                  <span>
                    {`${product.stock} unidades, m\u00ednimo ${product.minStock}`}
                  </span>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>
    );
  }

  function renderPedidos() {
    return (
      <section className="ventas-tab-grid">
        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>{"Nuevo pedido de cat\u00e1logo"}</h2>
            <span className="card-note">Marcas editables</span>
          </div>
          <form className="form compact" onSubmit={handleCreateOrder}>
            <label>
              Cliente existente
              <select
                value={orderForm.customerId}
                onChange={(event) =>
                  setOrderForm((prev) => ({
                    ...prev,
                    customerId: event.target.value
                  }))
                }
              >
                <option value="">Seleccionar cliente</option>
                {serverCustomerOptions.map((customer) => (
                  <option key={customer.value} value={customer.value}>
                    {customer.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="ventas-subgrid">
              <label>
                {"Cliente r\u00e1pido"}
                <input
                  value={orderForm.quickCustomerName}
                  placeholder={"Nombre si a\u00fan no existe"}
                  onChange={(event) =>
                    setOrderForm((prev) => ({
                      ...prev,
                      quickCustomerName: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                {"Tel\u00e9fono r\u00e1pido"}
                <input
                  value={orderForm.quickCustomerPhone}
                  placeholder={"Solo si no est\u00e1 en la lista"}
                  onChange={(event) =>
                    setOrderForm((prev) => ({
                      ...prev,
                      quickCustomerPhone: event.target.value
                    }))
                  }
                />
              </label>
            </div>

            <div className="ventas-subgrid">
              <label>
                Marca
                <select
                  value={orderForm.brand}
                  onChange={(event) =>
                    setOrderForm((prev) => ({
                      ...prev,
                      brand: event.target.value
                    }))
                  }
                >
                  {brandOptions.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
                <div className="ventas-option-manager">
                  <div className="ventas-option-row">
                    <input
                      value={brandDraft}
                      placeholder="Nueva marca"
                      onChange={(event) => setBrandDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className="button button-inline"
                      onClick={handleCreateBrand}
                    >
                      Agregar
                    </button>
                  </div>
                  <div className="ventas-option-tags">
                    {brandOptions.map((brand) => (
                      <button
                        key={brand}
                        type="button"
                        className="ventas-option-chip"
                        onClick={() => handleRemoveBrand(brand)}
                        title={`Eliminar ${brand}`}
                      >
                        <span>{brand}</span>
                        <strong>{"\u00d7"}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              </label>
              <label>
                {"Campa\u00f1a / referencia"}
                <input
                  value={orderForm.campaign}
                  placeholder={"Ej. Campa\u00f1a 12"}
                  onChange={(event) =>
                    setOrderForm((prev) => ({
                      ...prev,
                      campaign: event.target.value
                    }))
                  }
                />
              </label>
            </div>

            <div className="ventas-subgrid">
              <label>
                Estado inicial
                <select
                  value={orderForm.status}
                  onChange={(event) =>
                    setOrderForm((prev) => ({
                      ...prev,
                      status: event.target.value
                    }))
                  }
                >
                  {orderStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Abono inicial
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={orderForm.initialPaidAmount}
                  placeholder="0.00"
                  onChange={(event) =>
                    setOrderForm((prev) => ({
                      ...prev,
                      initialPaidAmount: event.target.value
                    }))
                  }
                />
              </label>
            </div>

            <div className="ventas-subgrid">
              <label>
                {"M\u00e9todo del abono"}
                <select
                  value={orderForm.paymentMethod}
                  onChange={(event) =>
                    setOrderForm((prev) => ({
                      ...prev,
                      paymentMethod: event.target.value
                    }))
                  }
                >
                  {paymentMethods.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nota del abono
                <input
                  value={orderForm.paymentNote}
                  placeholder="Opcional"
                  onChange={(event) =>
                    setOrderForm((prev) => ({
                      ...prev,
                      paymentNote: event.target.value
                    }))
                  }
                />
              </label>
            </div>

            <div className="ventas-line-items">
              <div className="ventas-section-title">
                <h3>{"\u00cdtems del pedido"}</h3>
                <button
                  type="button"
                  className="button button-inline"
                  onClick={addOrderItem}
                >
                  {"Agregar \u00edtem"}
                </button>
              </div>
              {orderForm.items.map((item, index) => (
                <article key={`item-${index}`} className="ventas-line-item-card">
                  <label>
                    {"C\u00f3digo del producto"}
                    <input
                      value={item.productCode || ""}
                      placeholder="Ej. PK-2048"
                      onChange={(event) =>
                        updateOrderItem(index, "productCode", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    {"Descripci\u00f3n"}
                    <input
                      value={item.description}
                      placeholder={"Producto del cat\u00e1logo"}
                      onChange={(event) =>
                        updateOrderItem(index, "description", event.target.value)
                      }
                    />
                  </label>
                  <div className="ventas-subgrid">
                    <label>
                      Talla
                      <input
                        value={item.size}
                        onChange={(event) =>
                          updateOrderItem(index, "size", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Color
                      <input
                        value={item.color}
                        onChange={(event) =>
                          updateOrderItem(index, "color", event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <div className="ventas-subgrid">
                    <label>
                      Cantidad
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(event) =>
                          updateOrderItem(index, "quantity", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Precio unitario
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(event) =>
                          updateOrderItem(index, "unitPrice", event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <div className="ventas-inline-top">
                    <small>
                      Subtotal:{" "}
                      {formatCurrency(
                        toNumber(item.quantity) * toNumber(item.unitPrice)
                      )}
                    </small>
                    <button
                      type="button"
                      className="button button-inline"
                      onClick={() => removeOrderItem(index)}
                      disabled={orderForm.items.length === 1}
                    >
                      Quitar
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="summary-block">
              <p>
                <strong>Total calculado:</strong> {formatCurrency(orderDraftTotal)}
              </p>
            </div>

            <button type="submit" className="button button-primary">
              Guardar pedido
            </button>
          </form>
        </article>

        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>Pedidos activos</h2>
            <span className="card-note">{mergedState.orders.length} total</span>
          </div>
          {mergedState.orders.length === 0 ? (
            <p>Registra el primer pedido para empezar el seguimiento.</p>
          ) : (
            <div className="ventas-list-stack">
              {mergedState.orders.map((order) => (
                <article key={order.id} className="ventas-order-card">
                  <div className="ventas-inline-top">
                    <div>
                      <strong>{order.customerName}</strong>
                      <p>
                        {order.brand}
                        {order.campaign ? ` - ${order.campaign}` : ""}
                      </p>
                    </div>
                    <span className={`pill ${getStatusTone(order.status)}`}>
                      {getStatusLabel(order.status)}
                    </span>
                  </div>
                  <p>
                    Total {formatCurrency(order.totalAmount)} {"\u00b7"} abonado{" "}
                    {formatCurrency(order.paidAmount)} {"\u00b7"} saldo{" "}
                    {formatCurrency(order.balanceAmount)}
                  </p>
                  {order.isPending ? (
                    <small>Pendiente de guardar.</small>
                  ) : (
                    <label>
                      Cambiar estado
                      <select
                        value={normalizeOrderStatus(order.status)}
                        onChange={(event) =>
                          handleUpdateOrderStatus(order.id, event.target.value)
                        }
                      >
                        {orderStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </article>
              ))}
            </div>
          )}
        </article>
      </section>
    );
  }

  function renderCobros() {
    return (
      <section className="ventas-tab-grid">
        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>Registrar cobro</h2>
            <span className="card-note">Abonos y saldos</span>
          </div>
          <form className="form compact" onSubmit={handleCreatePayment}>
            <label>
              Pedido pendiente
              <select
                value={paymentForm.catalogOrderId}
                onChange={(event) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    catalogOrderId: event.target.value
                  }))
                }
              >
                <option value="">Seleccionar pedido</option>
                {openOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.customerName} - {order.brand} - saldo{" "}
                    {formatCurrency(order.balanceAmount)}
                  </option>
                ))}
              </select>
            </label>
            <div className="ventas-subgrid">
              <label>
                Monto cobrado
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(event) =>
                    setPaymentForm((prev) => ({
                      ...prev,
                      amount: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                {"M\u00e9todo"}
                <select
                  value={paymentForm.method}
                  onChange={(event) =>
                    setPaymentForm((prev) => ({
                      ...prev,
                      method: event.target.value
                    }))
                  }
                >
                  {paymentMethods.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Nota
              <input
                value={paymentForm.note}
                placeholder="Opcional"
                onChange={(event) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    note: event.target.value
                  }))
                }
              />
            </label>
            <button type="submit" className="button button-primary">
              Guardar cobro
            </button>
          </form>
        </article>

        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>Clientes con saldo</h2>
          </div>
          {mergedState.customers.filter((customer) => customer.saldoTotal > 0)
            .length === 0 ? (
            <p>No hay saldos pendientes por ahora.</p>
          ) : (
            <div className="ventas-list-stack">
              {mergedState.customers
                .filter((customer) => customer.saldoTotal > 0)
                .map((customer) => (
                  <article key={customer.id} className="ventas-list-card">
                    <strong>{customer.name}</strong>
                    <span>Saldo: {formatCurrency(customer.saldoTotal)}</span>
                    <small>
                      {customer.ordersCount} pedido(s) {"\u00b7"}{" "}
                      {customer.phone || "Sin tel\u00e9fono"}
                    </small>
                  </article>
                ))}
            </div>
          )}
        </article>

        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>{"\u00daltimos cobros"}</h2>
          </div>
          {mergedState.payments.length === 0 ? (
            <p>{"A\u00fan no hay cobros registrados."}</p>
          ) : (
            <div className="ventas-list-stack">
              {mergedState.payments.slice(0, 10).map((payment) => (
                <article key={payment.id} className="ventas-list-card">
                  <div className="ventas-inline-top">
                    <strong>{payment.customerName}</strong>
                    <strong>{formatCurrency(payment.amount)}</strong>
                  </div>
                  <span>
                    {payment.method}
                    {payment.orderBrand ? ` \u00b7 ${payment.orderBrand}` : ""}
                  </span>
                  <small>
                    {formatDate(payment.createdAt)}
                    {payment.isPending ? " \u00b7 pendiente" : ""}
                  </small>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>
    );
  }

  function renderStock() {
    return (
      <section className="ventas-tab-grid">
        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>Nuevo producto</h2>
            <span className="card-note">{"Categor\u00edas editables"}</span>
          </div>
          <form className="form compact" onSubmit={handleCreateProduct}>
            <label>
              Nombre
              <input
                value={productForm.name}
                onChange={(event) =>
                  setProductForm((prev) => ({
                    ...prev,
                    name: event.target.value
                  }))
                }
              />
            </label>
            <label>
              {"Categor\u00eda"}
              <select
                value={productForm.category}
                onChange={(event) =>
                  setProductForm((prev) => ({
                    ...prev,
                    category: event.target.value
                  }))
                }
              >
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <div className="ventas-option-manager">
                <div className="ventas-option-row">
                  <input
                    value={categoryDraft}
                    placeholder={"Nueva categor\u00eda"}
                    onChange={(event) => setCategoryDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button button-inline"
                    onClick={handleCreateCategory}
                  >
                    Agregar
                  </button>
                </div>
                <div className="ventas-option-tags">
                  {categoryOptions.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className="ventas-option-chip"
                      onClick={() => handleRemoveCategory(category)}
                      title={`Eliminar ${category}`}
                    >
                      <span>{category}</span>
                      <strong>{"\u00d7"}</strong>
                    </button>
                  ))}
                </div>
              </div>
            </label>
            <div className="ventas-subgrid">
              <label>
                Costo opcional
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productForm.cost}
                  onChange={(event) =>
                    setProductForm((prev) => ({
                      ...prev,
                      cost: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Precio venta
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productForm.price}
                  onChange={(event) =>
                    setProductForm((prev) => ({
                      ...prev,
                      price: event.target.value
                    }))
                  }
                />
              </label>
            </div>
            <div className="ventas-subgrid">
              <label>
                Stock actual
                <input
                  type="number"
                  min="0"
                  value={productForm.stock}
                  onChange={(event) =>
                    setProductForm((prev) => ({
                      ...prev,
                      stock: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                {"Stock m\u00ednimo"}
                <input
                  type="number"
                  min="0"
                  value={productForm.minStock}
                  onChange={(event) =>
                    setProductForm((prev) => ({
                      ...prev,
                      minStock: event.target.value
                    }))
                  }
                />
              </label>
            </div>
            <button type="submit" className="button button-primary">
              Guardar producto
            </button>
          </form>
        </article>

        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>{"Ingreso de mercader\u00eda"}</h2>
          </div>
          <form className="form compact" onSubmit={handleRegisterIngress}>
            <label>
              Producto
              <select
                value={ingressForm.productId}
                onChange={(event) =>
                  setIngressForm((prev) => ({
                    ...prev,
                    productId: event.target.value
                  }))
                }
              >
                <option value="">Seleccionar producto</option>
                {serverProductOptions.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ventas-subgrid">
              <label>
                Unidades
                <input
                  type="number"
                  min="1"
                  value={ingressForm.quantity}
                  onChange={(event) =>
                    setIngressForm((prev) => ({
                      ...prev,
                      quantity: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Nota
                <input
                  value={ingressForm.note}
                  onChange={(event) =>
                    setIngressForm((prev) => ({
                      ...prev,
                      note: event.target.value
                    }))
                  }
                />
              </label>
            </div>
            <button type="submit" className="button button-primary">
              Registrar ingreso
            </button>
          </form>
        </article>

        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>{"Venta r\u00e1pida de bebida"}</h2>
          </div>
          <form className="form compact" onSubmit={handleRegisterSale}>
            <label>
              Producto
              <select
                value={saleForm.productId}
                onChange={(event) =>
                  setSaleForm((prev) => ({
                    ...prev,
                    productId: event.target.value
                  }))
                }
              >
                <option value="">Seleccionar producto</option>
                {serverProductOptions.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} - {formatCurrency(product.price)}
                  </option>
                ))}
              </select>
            </label>
            <div className="ventas-subgrid">
              <label>
                Cliente opcional
                <select
                  value={saleForm.customerId}
                  onChange={(event) =>
                    setSaleForm((prev) => ({
                      ...prev,
                      customerId: event.target.value
                    }))
                  }
                >
                  <option value="">Sin cliente</option>
                  {serverCustomerOptions.map((customer) => (
                    <option key={customer.value} value={customer.value}>
                      {customer.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cantidad
                <input
                  type="number"
                  min="1"
                  value={saleForm.quantity}
                  onChange={(event) =>
                    setSaleForm((prev) => ({
                      ...prev,
                      quantity: event.target.value
                    }))
                  }
                />
              </label>
            </div>
            <button type="submit" className="button button-primary">
              Registrar venta
            </button>
          </form>
        </article>

        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>Stock activo</h2>
            <span className="card-note">{mergedState.products.length} producto(s)</span>
          </div>
          {mergedState.products.length === 0 ? (
            <p>{"A\u00fan no hay productos cargados."}</p>
          ) : (
            <div className="ventas-list-stack">
              {mergedState.products.map((product) => (
                <article key={product.id} className="ventas-stock-card">
                  <div className="ventas-inline-top">
                    <strong>{product.name}</strong>
                    <span
                      className={`pill ${
                        product.stock <= product.minStock ? "warning" : "success"
                      }`}
                    >
                      {product.stock}
                    </span>
                  </div>
                  <span>
                    {product.category} {"\u00b7"} {formatCurrency(product.price)}
                  </span>
                  <small>{"M\u00ednimo:"} {product.minStock}</small>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>
    );
  }

  function renderClientes() {
    return (
      <section className="ventas-tab-grid">
        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>Nuevo cliente</h2>
            <span className="card-note">Libreta unificada</span>
          </div>
          <form className="form compact" onSubmit={handleCreateCustomer}>
            <label>
              Nombre
              <input
                value={customerForm.name}
                onChange={(event) =>
                  setCustomerForm((prev) => ({
                    ...prev,
                    name: event.target.value
                  }))
                }
              />
            </label>
            <label>
              {"Tel\u00e9fono"}
              <input
                value={customerForm.phone}
                onChange={(event) =>
                  setCustomerForm((prev) => ({
                    ...prev,
                    phone: event.target.value
                  }))
                }
              />
            </label>
            <label>
              Notas
              <textarea
                rows={3}
                value={customerForm.notes}
                onChange={(event) =>
                  setCustomerForm((prev) => ({
                    ...prev,
                    notes: event.target.value
                  }))
                }
              />
            </label>
            <button type="submit" className="button button-primary">
              Guardar cliente
            </button>
          </form>
        </article>

        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>Clientes registrados</h2>
            <span className="card-note">{mergedState.customers.length} cliente(s)</span>
          </div>
          {mergedState.customers.length === 0 ? (
            <p>{"No hay clientes registrados todav\u00eda."}</p>
          ) : (
            <div className="ventas-list-stack">
              {mergedState.customers.map((customer) => {
                const history = summarizeCustomerHistory(
                  customer,
                  mergedState.orders,
                  mergedState.payments,
                  mergedState.sales
                );
                return (
                  <article key={customer.id} className="ventas-customer-card">
                    <div className="ventas-inline-top">
                      <div>
                        <strong>{customer.name}</strong>
                        <p>{customer.phone || "Sin tel\u00e9fono"}</p>
                      </div>
                      <strong>{formatCurrency(customer.saldoTotal)}</strong>
                    </div>
                    <div className="ventas-customer-meta">
                      <span>{customer.ordersCount} pedido(s)</span>
                      <span>{customer.salesCount} venta(s)</span>
                      <span>{customer.paymentsCount} cobro(s)</span>
                    </div>
                    {customer.notes ? <p>{customer.notes}</p> : null}
                    {customer.isPending ? <small>Pendiente de guardar.</small> : null}
                    <div className="ventas-mini-history">
                      {history.length === 0 ? (
                        <small>{"Sin historial todav\u00eda."}</small>
                      ) : (
                        history.map((entry) => (
                          <small key={entry.id}>
                            {formatDate(entry.createdAt)} {"\u00b7"} {entry.text}
                          </small>
                        ))
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>
      </section>
    );
  }

  function renderSync() {
    return (
      <section className="ventas-tab-grid">
        <article className="ventas-card">
          <div className="ventas-section-title">
            <h2>Respaldo local</h2>
          </div>
          <div className="ventas-sync-status">
            <div className="ventas-sync-row">
              <span className="ventas-sync-icon">
                <FiRefreshCw />
              </span>
              <div>
                <strong>{"Exporta un respaldo para mover la app a otro m\u00f3vil."}</strong>
                <p>
                  El respaldo incluye clientes, pedidos, cobros, productos,
                  ingresos y ventas.
                </p>
              </div>
            </div>
          </div>
          <div className="ventas-sync-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={handleExportBackup}
            >
              Exportar respaldo
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => backupInputRef.current?.click()}
            >
              Importar respaldo
            </button>
            <button
              type="button"
              className="button button-inline"
              onClick={handleLock}
            >
              Bloquear app
            </button>
            <input
              ref={backupInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={handleImportBackup}
            />
          </div>
        </article>
      </section>
    );
  }

  function renderActiveTab() {
    if (activeTab === "inicio") return renderInicio();
    if (activeTab === "pedidos") return renderPedidos();
    if (activeTab === "cobros") return renderCobros();
    if (activeTab === "stock") return renderStock();
    if (activeTab === "clientes") return renderClientes();
    return renderSync();
  }

  if (!pin) {
    return (
      <main className="ventas-app-page">
        <section className="ventas-app-shell ventas-pin-shell">
          <article className="ventas-card ventas-pin-card">
            <p className="eyebrow">{"CONFIGURACI\u00d3N INICIAL"}</p>
            <h1>Protege Jazmin con un PIN local</h1>
            <p>
              {"Este PIN se guarda en el tel\u00e9fono y sirve para abrir la app sin"}
              {"depender de usuarios ni contrase\u00f1as online."}
            </p>
            <form className="form compact" onSubmit={handlePinSetup}>
              <label>
                PIN
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinDraft}
                  onChange={(event) => setPinDraft(event.target.value)}
                />
              </label>
              <label>
                Confirmar PIN
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinConfirm}
                  onChange={(event) => setPinConfirm(event.target.value)}
                />
              </label>
              {pinError ? <p className="error-text">{pinError}</p> : null}
              <button type="submit" className="button button-primary">
                Guardar PIN
              </button>
            </form>
          </article>
        </section>
      </main>
    );
  }

  if (!isUnlocked) {
    return (
      <main className="ventas-app-page">
        <section className="ventas-app-shell ventas-pin-shell">
          <article className="ventas-card ventas-pin-card">
            <p className="eyebrow">JAZMIN</p>
            <h1>Ingresar con PIN</h1>
            <p>Abre la app y sigue registrando pedidos, cobros y stock.</p>
            <form className="form compact" onSubmit={handleUnlock}>
              <label>
                PIN
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinDraft}
                  onChange={(event) => setPinDraft(event.target.value)}
                />
              </label>
              {pinError ? <p className="error-text">{pinError}</p> : null}
              <button type="submit" className="button button-primary">
                Entrar
              </button>
            </form>
          </article>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="ventas-app-page">
        <section className="ventas-app-shell">
          {renderEmptyCard(
            "Cargando app de ventas",
            "Preparando clientes, pedidos, stock y cobros."
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="ventas-app-page">
      <section className="ventas-app-shell">
        {activeTab === "inicio" ? (
          <header className="ventas-app-header">
            <div>
              <p className="eyebrow">JAZMIN APP</p>
              <h1>{"Cat\u00e1logo, cobros y stock desde Android"}</h1>
              <p className="ventas-app-lead">
                {"Dise\u00f1ada para operar desde el tel\u00e9fono, guardar todo en local y"}
                mover respaldos entre celulares cuando haga falta.
              </p>
            </div>
          </header>
        ) : null}
        <AnimatePresence mode="wait" initial={false}>
          {flash.type === "ok" ? (
            <motion.p
              key={`flash-${flash.message}`}
              className="success-text"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {flash.message}
            </motion.p>
          ) : null}
        </AnimatePresence>

        <AnimatePresence mode="wait" initial={false}>
          {error ? (
            <motion.p
              key={`error-${error}`}
              className="error-text"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} className="ventas-tab-viewport" {...tabTransition}>
            {renderActiveTab()}
          </motion.div>
        </AnimatePresence>

        <nav className="ventas-bottom-nav">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <motion.button
                key={tab.id}
                type="button"
                className={isActive ? "ventas-tab-button active" : "ventas-tab-button"}
                onClick={() => setActiveTab(tab.id)}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.16 }}
              >
                {isActive ? (
                  <motion.span
                    layoutId="ventas-tab-pill"
                    className="ventas-tab-button-bg"
                    transition={{ type: "spring", stiffness: 320, damping: 26 }}
                  />
                ) : null}
                <motion.span
                  className="ventas-tab-icon"
                  animate={{ y: isActive ? -1 : 0, scale: isActive ? 1.06 : 1 }}
                  transition={{ duration: 0.18 }}
                >
                  <Icon />
                </motion.span>
                <span>{tab.label}</span>
              </motion.button>
            );
          })}
        </nav>
      </section>
    </main>
  );
}






