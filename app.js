const STORAGE_KEY = "cuentas-personales-movimientos";
const DRIVE_CONFIG_KEY = "cuentas-personales-drive-config";
const DRIVE_FILE_NAME = "cuentas-personales.json";
const DRIVE_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const currencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const form = document.querySelector("#transactionForm");
const monthFilter = document.querySelector("#monthFilter");
const dateInput = document.querySelector("#date");
const descriptionInput = document.querySelector("#description");
const categoryInput = document.querySelector("#category");
const amountInput = document.querySelector("#amount");
const tableBody = document.querySelector("#transactionTable");
const emptyMessage = document.querySelector("#emptyMessage");
const categoryList = document.querySelector("#categoryList");
const categoryCount = document.querySelector("#categoryCount");
const exportButton = document.querySelector("#exportButton");
const clearDataButton = document.querySelector("#clearDataButton");
const driveStatus = document.querySelector("#driveStatus");
const driveDetail = document.querySelector("#driveDetail");
const configureDriveButton = document.querySelector("#configureDriveButton");
const connectDriveButton = document.querySelector("#connectDriveButton");
const driveDialog = document.querySelector("#driveDialog");
const googleEmailInput = document.querySelector("#googleEmail");
const googleClientIdInput = document.querySelector("#googleClientId");
const googleApiKeyInput = document.querySelector("#googleApiKey");
const saveDriveConfigButton = document.querySelector("#saveDriveConfigButton");

const incomeTotal = document.querySelector("#incomeTotal");
const expenseTotal = document.querySelector("#expenseTotal");
const balanceTotal = document.querySelector("#balanceTotal");
const savingRate = document.querySelector("#savingRate");

let transactions = loadTransactions();
let driveConfig = loadDriveConfig();
let tokenClient = null;
let driveFileId = localStorage.getItem(`${DRIVE_CONFIG_KEY}-file-id`) || "";
let isDriveReady = false;
let isSyncing = false;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthISO(dateValue = todayISO()) {
  return dateValue.slice(0, 7);
}

function loadTransactions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function loadDriveConfig() {
  try {
    return JSON.parse(localStorage.getItem(DRIVE_CONFIG_KEY)) || {
      email: "rgalleg22@gmail.com",
      clientId: "",
      apiKey: "",
    };
  } catch {
    return { email: "rgalleg22@gmail.com", clientId: "", apiKey: "" };
  }
}

function saveTransactions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  syncToDrive();
}

function saveTransactionsLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

function saveDriveConfig() {
  driveConfig = {
    email: googleEmailInput.value.trim(),
    clientId: googleClientIdInput.value.trim(),
    apiKey: googleApiKeyInput.value.trim(),
  };
  localStorage.setItem(DRIVE_CONFIG_KEY, JSON.stringify(driveConfig));
  updateDriveStatus();
}

function money(value) {
  return currencyFormatter.format(value);
}

function currentMonthTransactions() {
  return transactions
    .filter((transaction) => monthISO(transaction.date) === monthFilter.value)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function calculateTotals(monthTransactions) {
  return monthTransactions.reduce(
    (totals, transaction) => {
      totals[transaction.type] += transaction.amount;
      return totals;
    },
    { income: 0, expense: 0 }
  );
}

function renderSummary(monthTransactions) {
  const totals = calculateTotals(monthTransactions);
  const balance = totals.income - totals.expense;
  const rate = totals.income > 0 ? Math.round((balance / totals.income) * 100) : 0;

  incomeTotal.textContent = money(totals.income);
  expenseTotal.textContent = money(totals.expense);
  balanceTotal.textContent = money(balance);
  savingRate.textContent = `${rate}%`;
}

function renderCategories(monthTransactions) {
  const expenses = monthTransactions.filter((transaction) => transaction.type === "expense");
  const totalExpense = expenses.reduce((sum, transaction) => sum + transaction.amount, 0);
  const categories = expenses.reduce((items, transaction) => {
    items[transaction.category] = (items[transaction.category] || 0) + transaction.amount;
    return items;
  }, {});

  const sortedCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  categoryCount.textContent = `${sortedCategories.length} categorías`;

  if (!sortedCategories.length) {
    categoryList.className = "category-list empty-state";
    categoryList.textContent = "Sin gastos en este mes.";
    return;
  }

  categoryList.className = "category-list";
  categoryList.innerHTML = sortedCategories
    .map(([category, amount]) => {
      const percentage = totalExpense ? Math.round((amount / totalExpense) * 100) : 0;
      return `
        <div class="category-item">
          <div class="category-row">
            <span>${category}</span>
            <span>${money(amount)} · ${percentage}%</span>
          </div>
          <div class="bar" aria-hidden="true">
            <div class="bar-fill" style="width: ${percentage}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderTable(monthTransactions) {
  emptyMessage.hidden = monthTransactions.length > 0;
  tableBody.innerHTML = monthTransactions
    .map(
      (transaction) => `
        <tr>
          <td>${transaction.date}</td>
          <td>${transaction.description}</td>
          <td>${transaction.category}</td>
          <td><span class="badge ${transaction.type}">${transaction.type === "expense" ? "Gasto" : "Ingreso"}</span></td>
          <td class="amount-cell">${money(transaction.amount)}</td>
          <td class="amount-cell">
            <button class="delete-button" type="button" data-id="${transaction.id}" title="Eliminar" aria-label="Eliminar movimiento">×</button>
          </td>
        </tr>
      `
    )
    .join("");
}

function render() {
  const monthTransactions = currentMonthTransactions();
  renderSummary(monthTransactions);
  renderCategories(monthTransactions);
  renderTable(monthTransactions);
  updateDriveStatus();
}

function resetForm() {
  form.reset();
  dateInput.value = todayISO();
  categoryInput.value = "Alimentación";
  descriptionInput.focus();
}

function downloadCSV() {
  const monthTransactions = currentMonthTransactions();
  if (!monthTransactions.length) return;

  const header = ["Fecha", "Descripcion", "Categoria", "Tipo", "Monto"];
  const rows = monthTransactions.map((transaction) => [
    transaction.date,
    transaction.description,
    transaction.category,
    transaction.type === "expense" ? "Gasto" : "Ingreso",
    transaction.amount,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gastos-${monthFilter.value}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function updateDriveStatus(message) {
  const hasConfig = Boolean(driveConfig.clientId && driveConfig.apiKey);
  connectDriveButton.disabled = !hasConfig || isSyncing;

  if (message) {
    driveDetail.textContent = message;
  } else if (!hasConfig) {
    driveDetail.textContent = "Agrega Client ID y API key para sincronizar con Google Drive.";
  } else if (isDriveReady) {
    driveDetail.textContent = `Sincronizando ${DRIVE_FILE_NAME} en ${driveConfig.email || "Google Drive"}.`;
  } else {
    driveDetail.textContent = "Listo para conectar con Google Drive.";
  }

  driveStatus.textContent = isDriveReady ? "Drive conectado" : "Guardado local";
  connectDriveButton.textContent = isDriveReady ? "Sincronizar" : "Conectar";
}

function waitForGoogleLibraries() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (window.google?.accounts?.oauth2 && window.gapi) {
        clearInterval(timer);
        resolve();
      }
      if (attempts > 80) {
        clearInterval(timer);
        reject(new Error("No se pudieron cargar las librerias de Google."));
      }
    }, 100);
  });
}

async function initializeDrive() {
  if (isDriveReady) return;
  if (!driveConfig.clientId || !driveConfig.apiKey) {
    driveDialog.showModal();
    return;
  }

  updateDriveStatus("Abriendo conexion con Google...");
  await waitForGoogleLibraries();
  await new Promise((resolve) => gapi.load("client", resolve));
  await gapi.client.init({
    apiKey: driveConfig.apiKey,
    discoveryDocs: [DRIVE_DISCOVERY_DOC],
  });

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: driveConfig.clientId,
    scope: DRIVE_SCOPES,
    hint: driveConfig.email,
    callback: "",
  });

  await requestAccessToken();
  await verifyGoogleAccount();
  isDriveReady = true;
}

function requestAccessToken() {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    };
    tokenClient.requestAccessToken({ prompt: gapi.client.getToken() ? "" : "consent" });
  });
}

async function verifyGoogleAccount() {
  if (!driveConfig.email) return;

  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` },
  });
  const profile = await response.json();
  if (profile.email && profile.email.toLowerCase() !== driveConfig.email.toLowerCase()) {
    throw new Error(`Conectaste ${profile.email}. Usa ${driveConfig.email}.`);
  }
}

async function findDriveFile() {
  if (driveFileId) return driveFileId;

  const response = await gapi.client.drive.files.list({
    q: `name='${DRIVE_FILE_NAME}' and trashed=false`,
    spaces: "drive",
    fields: "files(id, name, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 1,
  });
  driveFileId = response.result.files?.[0]?.id || "";
  if (driveFileId) {
    localStorage.setItem(`${DRIVE_CONFIG_KEY}-file-id`, driveFileId);
  }
  return driveFileId;
}

async function readDriveFile(fileId) {
  const response = await gapi.client.drive.files.get({
    fileId,
    alt: "media",
  });
  const data = typeof response.body === "string" ? JSON.parse(response.body) : response.result;
  return Array.isArray(data.transactions) ? data.transactions : [];
}

async function writeDriveFile() {
  const metadata = { name: DRIVE_FILE_NAME, mimeType: "application/json" };
  const file = new Blob(
    [
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          transactions,
        },
        null,
        2
      ),
    ],
    { type: "application/json" }
  );
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const token = gapi.client.getToken().access_token;
  const fileId = await findDriveFile();
  const method = fileId ? "PATCH" : "POST";
  const uploadUrl = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

  const response = await fetch(uploadUrl, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "No se pudo guardar en Drive.");

  driveFileId = result.id || fileId;
  localStorage.setItem(`${DRIVE_CONFIG_KEY}-file-id`, driveFileId);
}

async function connectDrive() {
  try {
    await initializeDrive();
    isSyncing = true;
    updateDriveStatus("Revisando archivo en Drive...");

    const fileId = await findDriveFile();
    if (fileId) {
      transactions = await readDriveFile(fileId);
      saveTransactionsLocal();
      render();
      updateDriveStatus("Datos descargados desde Google Drive.");
    } else {
      await writeDriveFile();
      updateDriveStatus("Archivo creado en Google Drive.");
    }
  } catch (error) {
    isDriveReady = false;
    updateDriveStatus(error.message || "No se pudo conectar con Google Drive.");
  } finally {
    isSyncing = false;
    updateDriveStatus();
  }
}

async function syncToDrive() {
  if (!isDriveReady || isSyncing) return;

  try {
    isSyncing = true;
    updateDriveStatus("Guardando cambios en Google Drive...");
    await writeDriveFile();
    updateDriveStatus("Cambios guardados en Google Drive.");
  } catch (error) {
    updateDriveStatus(error.message || "No se pudo sincronizar con Google Drive.");
  } finally {
    isSyncing = false;
    updateDriveStatus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const amount = Number(amountInput.value);

  if (!amount || amount <= 0) return;

  transactions.push({
    id: crypto.randomUUID(),
    type: formData.get("type"),
    description: descriptionInput.value.trim(),
    category: categoryInput.value,
    amount,
    date: dateInput.value,
  });

  monthFilter.value = monthISO(dateInput.value);
  saveTransactions();
  resetForm();
  render();
});

tableBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;

  transactions = transactions.filter((transaction) => transaction.id !== button.dataset.id);
  saveTransactions();
  render();
});

monthFilter.addEventListener("change", render);
exportButton.addEventListener("click", downloadCSV);

clearDataButton.addEventListener("click", () => {
  const hasMonthData = currentMonthTransactions().length > 0;
  if (!hasMonthData) return;

  const confirmed = confirm(`¿Borrar todos los movimientos de ${monthFilter.value}?`);
  if (!confirmed) return;

  transactions = transactions.filter((transaction) => monthISO(transaction.date) !== monthFilter.value);
  saveTransactions();
  render();
});

configureDriveButton.addEventListener("click", () => {
  googleEmailInput.value = driveConfig.email || "rgalleg22@gmail.com";
  googleClientIdInput.value = driveConfig.clientId || "";
  googleApiKeyInput.value = driveConfig.apiKey || "";
  driveDialog.showModal();
});

saveDriveConfigButton.addEventListener("click", () => {
  saveDriveConfig();
  driveDialog.close();
});

connectDriveButton.addEventListener("click", connectDrive);

dateInput.value = todayISO();
monthFilter.value = monthISO();
render();
