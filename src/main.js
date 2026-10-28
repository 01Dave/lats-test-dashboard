import "./style.css";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

function apiUrl(path) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

const $ = (selector) => document.querySelector(selector);

let token = sessionStorage.getItem("lats_test_token") || "";
let currentUser = null;

let loadedApplications = [];


function safeData(data, path) {
  if (path === "/api/v1/auth/login" && data && typeof data === "object") {
    return { ...data, token: data.token ? "[REDACTED]" : undefined };
  }
  return data;
}

function showResponse(data, status, path) {
  $("#response-status").textContent = status ? `HTTP ${status}` : "Request error";
  $("#response-body").textContent = JSON.stringify(
    { path, status, data: safeData(data, path) },
    null,
    2
  );
}

function showMessage(message, isError = false) {
  const element = $("#message");
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle("error", isError);
}

async function request(path, options = {}) {
  const headers = {
  "ngrok-skip-browser-warning": "true",
  ...(options.body ? { "Content-Type": "application/json" } : {}),
  ...options.headers
};

  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(apiUrl(path), { ...options, headers });
    const raw = await response.text();
    let data;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }

    if (path !== "/api/v1/auth/login") {
      showResponse(data, response.status, path);
    }

    if (!response.ok) {
      const message =
        typeof data === "object" && data
          ? data.message || data.error || JSON.stringify(data)
          : String(data || response.statusText);

      throw new Error(`HTTP ${response.status}: ${message}`);
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError) {
  throw new Error(
    `Cannot reach the backend at ${API_BASE_URL || "the current origin"}. Check the backend tunnel and browser CORS settings.`
  );
}
    throw error;
  }
}

function setAuthenticated(isAuthenticated) {
  $("#login-panel").hidden = isAuthenticated;
  $("#workspace").hidden = !isAuthenticated;
  $("#logout").hidden = !isAuthenticated;
  $("#account-label").textContent = isAuthenticated
    ? currentUser?.email || "Signed in"
    : "Not signed in";
}

function renderUser(user) {
  currentUser = user || {};
  $("#user-value").textContent =
    currentUser.name || currentUser.email || currentUser.id || "Authenticated";
  $("#role-value").textContent = currentUser.role || "Role unavailable";
  $("#account-label").textContent = currentUser.email || "Signed in";

  const details = $("#user-details");
  details.replaceChildren();

  for (const [key, value] of Object.entries(currentUser)) {
    // Never render token-like fields into the identity panel.
    if (/token|password|secret/i.test(key)) continue;

    const line = document.createElement("p");
    line.textContent = `${key}: ${
      Array.isArray(value) ? value.join(", ") :
      value && typeof value === "object" ? JSON.stringify(value) :
      String(value ?? "—")
    }`;
    details.appendChild(line);
  }

  const permissions = Array.isArray(currentUser.permissions)
    ? currentUser.permissions
    : [];

  $("#permissions").replaceChildren();

  if (!permissions.length) {
    $("#permissions").textContent = "No permissions returned.";
  } else {
    for (const permission of permissions) {
      const item = document.createElement("span");
      item.className = "permission";
      item.textContent = permission;
      $("#permissions").appendChild(item);
    }
  }
}


function getApplicationRows(payload) {
  // Actual LATS API response:
  // { data: { data: [...], pagination: {...} } }
  if (Array.isArray(payload?.data?.data)) {
    return payload.data.data;
  }

  // Fallbacks for other response formats
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.applications)) return payload.applications;
  if (Array.isArray(payload?.data?.applications)) {
    return payload.data.applications;
  }
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) {
    return payload.data.items;
  }
  if (Array.isArray(payload)) return payload;

  return [];
}



let activeSummaryStatuses = null;

function renderStatusSummary() {
  const container = $("#status-summary");
  if (!container) return;

  const groups = [
    { label: "Drafts", statuses: ["DRAFT"] },
    {
      label: "Awaiting HOD",
      statuses: ["SUBMITTED", "HOD_IN_REVIEW", "HOD_QUERY"]
    },
    {
      label: "Awaiting Credit Review",
      statuses: ["HOD_APPROVED", "CREDIT_IN_REVIEW", "CREDIT_QUERY"]
    },
    {
      label: "Awaiting Internal Control",
      statuses: ["CREDIT_APPROVED", "IC_IN_REVIEW", "IC_QUERY"]
    },
    {
      label: "Awaiting MD",
      statuses: ["IC_APPROVED", "PENDING_MD"]
    },
    {
      label: "Pending disbursement",
      statuses: ["MD_APPROVED", "PENDING_DISBURSEMENT"]
    },
    { label: "Disbursed", statuses: ["DISBURSED"] },
    {
      label: "Rejected / declined",
      statuses: ["HOD_REJECTED", "CREDIT_DECLINED", "IC_REJECTED", "MD_REJECTED"]
    },
    { label: "Withdrawn", statuses: ["WITHDRAWN"] }
  ];

  container.replaceChildren();

  for (const group of groups) {
    const count = loadedApplications.filter((app) =>
      group.statuses.includes(app.status)
    ).length;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "stat-card status-card-button";
    button.setAttribute(
      "aria-pressed",
      String(
        activeSummaryStatuses !== null &&
        activeSummaryStatuses.length === group.statuses.length &&
        activeSummaryStatuses.every((status) =>
          group.statuses.includes(status)
        )
      )
    );

    const label = document.createElement("p");
    label.textContent = group.label;

    const value = document.createElement("h3");
    value.textContent = String(count);

    const hint = document.createElement("span");
    hint.className = "status-card-hint";
    hint.textContent = "View applications";

    button.append(label, value, hint);

    button.addEventListener("click", async () => {
      activeSummaryStatuses = group.statuses;

      // Fetch the full visible list, then filter this group locally.
      const statusSelect = $("#filter-form").elements.status;
      statusSelect.value = "";

      document.querySelector('.nav[data-view="applications"]')?.click();

      await loadApplications();
      renderStatusSummary();
    });

    container.appendChild(button);
  }

  const note = document.createElement("p");
  note.className = "summary-note";
  note.textContent =
    `Counts are based on ${loadedApplications.length} loaded application(s).`;
  container.appendChild(note);
}




function renderApplications(payload) {
  const container = $("#application-results");
  const rows = getApplicationRows(payload);

  loadedApplications = rows;
  renderStatusSummary();

  $("#app-count").textContent = String(
    payload?.data?.pagination?.total ?? rows.length
  );

  const displayRows = activeSummaryStatuses
    ? rows.filter((app) => activeSummaryStatuses.includes(app.status))
    : rows;

  $("#results-label").textContent =
    `${displayRows.length} application(s) shown` +
    (activeSummaryStatuses ? " for the selected workflow group." : ".");

  container.replaceChildren();

  const details = document.createElement("section");
  details.className = "panel";
  details.id = "selected-app-details";
  details.textContent =
    "Select View details beside an application to inspect its details and approval history.";
  container.appendChild(details);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "Clear workflow filter";
  clearButton.hidden = !activeSummaryStatuses;

  clearButton.addEventListener("click", async () => {
    activeSummaryStatuses = null;
    $("#filter-form").elements.status.value = "";
    await loadApplications();
  });

  container.appendChild(clearButton);

  if (!displayRows.length) {
    const empty = document.createElement("p");
    empty.textContent = activeSummaryStatuses
      ? "No applications in this workflow group are visible to your account."
      : "No applications found for the selected filters.";
    container.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (const label of [
    "Application",
    "Customer",
    "Product",
    "Status",
    "Branch",
    "Requested amount",
    "Details"
  ]) {
    const th = document.createElement("th");
    th.textContent = label;
    headerRow.appendChild(th);
  }

  head.appendChild(headerRow);
  table.appendChild(head);

  const body = document.createElement("tbody");

  for (const app of displayRows) {
    const row = document.createElement("tr");

    const values = [
      app.appNumber || app.applicationNumber || app.id || "—",
      app.customerName || "—",
      app.productName || "—",
      app.status || "—",
      app.branch || "—",
      app.requestedAmount == null
        ? "—"
        : Number(app.requestedAmount).toLocaleString()
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.appendChild(cell);
    }

    const actionCell = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "View details";

    button.addEventListener("click", () => {
      loadApplicationDetails(app.id, app.appNumber || app.id);
    });

    actionCell.appendChild(button);
    row.appendChild(actionCell);
    body.appendChild(row);
  }

  table.appendChild(body);
  container.appendChild(table);
}



async function loadApplicationDetails(id, appNumber) {
  const panel = $("#selected-app-details");
  panel.textContent = `Loading ${appNumber}…`;

  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };

  const formatDate = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString();
  };

  const formatAmount = (value) => {
    if (value === null || value === undefined || value === "") return "—";
    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString()
      : String(value);
  };

  try {
    const [applicationResponse, approvalsResponse] = await Promise.all([
      request(`/api/v1/applications/${encodeURIComponent(id)}`),
      request(`/api/v1/applications/${encodeURIComponent(id)}/approvals`)
    ]);

    const app =
      applicationResponse?.data?.data ??
      applicationResponse?.data ??
      applicationResponse;

    const approvalData =
      approvalsResponse?.data?.data ??
      approvalsResponse?.data ??
      approvalsResponse;

    if (!app || typeof app !== "object" || Array.isArray(app)) {
      throw new Error("The application endpoint returned an unexpected format.");
    }

    panel.replaceChildren();

    // Header
    const header = make("div", "detail-header");
    const heading = make("h3", "", `Application ${app.appNumber || appNumber}`);
    const status = make("span", "status-badge", app.status || "Unknown status");
    header.append(heading, status);
    panel.appendChild(header);

    // Application summary
    panel.appendChild(make("h4", "", "Application details"));

    const fields = [
      ["Application number", app.appNumber],
      ["Customer name", app.customerName],
      ["Customer phone", app.customerPhone],
      ["Product", app.productName],
      ["Branch", app.branch],
      ["Requested amount", formatAmount(app.requestedAmount)],
      ["Tenor", app.tenorMonths == null ? "—" : `${app.tenorMonths} months`],
      ["Purpose", app.purpose],
      ["KYC confirmed", app.kycConfirmed ? "Yes" : "No"],
      ["KYC confirmed at", formatDate(app.kycConfirmedAt)],
      ["Disbursed amount", formatAmount(app.disbursedAmount)],
      ["Disbursement date", formatDate(app.disbursementDate)],
      ["Disbursement method", app.disbursementMethod],
      ["Disbursement reference", app.disbursementReference],
      ["Created at", formatDate(app.createdAt)],
      ["Last updated", formatDate(app.updatedAt)]
    ];

    const grid = make("div", "detail-grid");

    for (const [label, value] of fields) {
      const item = make("div", "detail-item");
      item.append(
        make("div", "detail-label", label),
        make("div", "detail-value", value ?? "—")
      );
      grid.appendChild(item);
    }

    panel.appendChild(grid);

    // Approval history
    panel.appendChild(make("h4", "", "Approval history"));

    if (Array.isArray(approvalData) && approvalData.length === 0) {
      panel.appendChild(
        make("p", "empty-state",
          "No approval-history entries were returned for this application.")
      );
    } else if (Array.isArray(approvalData)) {
      const list = make("div", "approval-list");

      for (const approval of approvalData) {
        const item = make("article", "approval-item");

        for (const [key, value] of Object.entries(approval)) {
          const line = make(
            "p",
            "approval-field",
            `${key}: ${
              value && typeof value === "object"
                ? JSON.stringify(value)
                : value ?? "—"
            }`
          );
          item.appendChild(line);
        }

        list.appendChild(item);
      }

      panel.appendChild(list);
    } else {
      const output = make("pre", "approval-json");
      output.textContent = JSON.stringify(approvalData, null, 2);
      panel.appendChild(output);
    }
  } catch (error) {
    panel.replaceChildren(
      make("h3", "", `Application ${appNumber}`),
      make("p", "error", `Could not load details: ${error.message}`)
    );
  }
}



async function checkHealth() {
  try {
    const result = await request("/health");
    $("#health-value").textContent = "Online";
    return result;
  } catch (error) {
    $("#health-value").textContent = "Offline";
    showMessage(error.message, true);
  }
}

async function loadApplications() {
  if (!token) {
    showMessage("Sign in before loading applications.", true);
    return;
  }

  const form = $("#filter-form");
  const params = new URLSearchParams();
  const status = form.elements.status.value;
  const branch = form.elements.branch.value.trim();

  if (status) params.set("status", status);
  if (branch) params.set("branch", branch);

  params.set("page", "1");
  params.set("limit", "20");

  try {
    const path = `/api/v1/applications?${params.toString()}`;
    const result = await request(path);
    renderApplications(result);
    showMessage("Applications loaded successfully.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function refreshIdentity() {
  if (!token) return;

  try {
    const result = await request("/api/v1/auth/me");
    const user = result?.user || result?.data?.user || result?.data || result;
    renderUser(user);
    setAuthenticated(true);
  } catch (error) {
    token = "";
    sessionStorage.removeItem("lats_test_token");
    currentUser = null;
    setAuthenticated(false);
    showMessage(`Session could not be verified: ${error.message}`, true);
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;

  try {
    showMessage("Signing in…");

    const response = await fetch(apiUrl("/api/v1/auth/login"), {
      method: "POST",
      headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true"
    },
      body: JSON.stringify({ email, password })
    });

    const raw = await response.text();
    let data;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { message: raw };
    }

    showResponse(data, response.status, "/api/v1/auth/login");

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${data?.message || data?.error || "Login failed"}`
      );
    }

    const result = data?.data || data;

    if (!result?.token) {
      throw new Error("The login response did not contain a token. Check the response structure.");
    }

    token = result.token;
    sessionStorage.setItem("lats_test_token", token);

    if (result.user) renderUser(result.user);

    form.elements.password.value = "";
    setAuthenticated(true);
    await refreshIdentity();
    showMessage("Login successful.");
  } catch (error) {
    form.elements.password.value = "";
    showMessage(error.message, true);
  }
});

$("#logout").addEventListener("click", () => {
  token = "";
  currentUser = null;
  sessionStorage.removeItem("lats_test_token");
  renderUser({});
  setAuthenticated(false);
  $("#app-count").textContent = "—";
  showMessage("Logged out. The dashboard session token was cleared.");
});

$("#refresh-all").addEventListener("click", async () => {
  await checkHealth();
  await refreshIdentity();
  if (token) await loadApplications();
});

$("#refresh-apps").addEventListener("click", loadApplications);

$("#filter-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  activeSummaryStatuses = null;
  await loadApplications();
});

document.querySelectorAll(".nav[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.view;

    document.querySelectorAll(".nav[data-view]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });

    document.querySelectorAll(".view").forEach((view) => {
      view.hidden = view.id !== `view-${target}`;
    });

    const titles = {
      overview: "Developer Overview",
      applications: "Loan Applications",
      "workflow-test": "Workflow Test",
      api: "API Inspector"
    };

    $("#page-title").textContent = titles[target] || "Developer Dashboard";
  });
});

$("#api-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const path = event.currentTarget.elements.endpoint.value;

  if (path !== "/health" && !token) {
    showMessage("Sign in before calling authenticated endpoints.", true);
    return;
  }

  try {
    const result = await request(path);
    if (path === "/api/v1/applications") renderApplications(result);
    showMessage("GET request completed.");
  } catch (error) {
    showMessage(error.message, true);
  }
});


$("#workflow-test-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');

  if (!token || !currentUser) {
    showMessage("Please sign in before creating a test application.", true);
    return;
  }

  if (
    currentUser.role !== "sales" ||
    !Array.isArray(currentUser.permissions) ||
    !currentUser.permissions.includes("application:create")
  ) {
    showMessage(
      "Creation is restricted to a Sales account with application:create permission.",
      true
    );
    return;
  }

  if (
    !confirm(
      "Create ONE synthetic test application in lats_dev? Existing applications will not be changed."
    )
  ) {
    return;
  }

  const payload = {
    branch: form.elements.branch.value.trim(),
    productName: form.elements.productName.value.trim(),
    customerName: form.elements.customerName.value.trim(),
    customerPhone: form.elements.customerPhone.value.trim(),
    requestedAmount: Number(form.elements.requestedAmount.value),
    tenorMonths: Number(form.elements.tenorMonths.value),
    purpose: form.elements.purpose.value.trim()
  };

  if (
    !payload.branch ||
    !payload.productName ||
    !payload.customerName ||
    !payload.customerPhone ||
    !payload.purpose ||
    !Number.isFinite(payload.requestedAmount) ||
    payload.requestedAmount <= 0 ||
    !Number.isInteger(payload.tenorMonths) ||
    payload.tenorMonths <= 0
  ) {
    showMessage("Check the form: all fields are required and the amount and tenor must be positive.", true);
    return;
  }

  submitButton.disabled = true;

  try {
    const result = await request("/api/v1/applications", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    const created =
      result?.data?.application ||
      result?.data ||
      result?.application ||
      result;

    showMessage(
      `Creation request succeeded. Application ID: ${created?.id || "Check the API response"}. ` +
      `Application number: ${created?.appNumber || "Check the API response"}. ` +
      `Status: ${created?.status || "Check the API response"}.`
    );

    submitButton.textContent = "Test application created";
    await loadApplications();
  } catch (error) {
    showMessage(
      `${error.message} If the response is unclear, inspect the API response before retrying to avoid creating a duplicate.`,
      true
    );
    submitButton.disabled = false;
  }
});


async function submitSyntheticWorkflowTest() {
  const applicationId = "bede793b-ae01-4818-ba1b-46b34fd1fbb4";

  if (!token || !currentUser || currentUser.role !== "sales") {
    showMessage("Sign in with the Sales test account before submitting.", true);
    return;
  }

  if (!confirm("Submit only LN-2026-000014 for HOD review?")) return;

  try {
    const result = await request(
      `/api/v1/applications/${applicationId}/submit`,
      { method: "POST" }
    );

    showMessage(
      `Submission request succeeded. Response: ${JSON.stringify(result)}`
    );

    await loadApplications();
  } catch (error) {
    showMessage(
      `${error.message}. Check the application's current status before retrying.`,
      true
    );
  }
}

window.addEventListener("lats-submit-synthetic-test", () => {
  submitSyntheticWorkflowTest();
});

setAuthenticated(Boolean(token));
checkHealth();

if (token) refreshIdentity();


const HOD_TEST_APPLICATION_ID = "bede793b-ae01-4818-ba1b-46b34fd1fbb4";

$("#send-hod-query").addEventListener("click", async () => {
  if (!token || !currentUser) {
    showMessage("Please sign in as the HOD test account first.", true);
    return;
  }

  if (currentUser.role !== "hod" ||
      !currentUser.permissions?.includes("hod:approve")) {
    showMessage("This test action requires the HOD role and hod:approve permission.", true);
    return;
  }

  const confirmed = window.confirm(
    "Send a QUERY only for synthetic application LN-2026-000014? " +
    "This will not approve the application or mark KYC confirmed."
  );

  if (!confirmed) return;

  try {
    const result = await request(
      `/api/v1/applications/${HOD_TEST_APPLICATION_ID}/hod-decision`,
      {
        method: "POST",
        body: JSON.stringify({
          decision: "query",
          comment: "Synthetic workflow test only: please verify the test application details."
        })
      }
    );

    showMessage(
      `HOD query request completed. Returned status: ${result?.status ?? "check response below"}`
    );

    await loadApplications();
  } catch (error) {
    showMessage(error.message, true);
  }
});



$("#resolve-hod-query").addEventListener("click", async () => {
  if (!token || !currentUser) {
    showMessage("Please sign in as the Sales test account first.", true);
    return;
  }

  if (currentUser.role !== "sales" ||
      !currentUser.permissions?.includes("application:create")) {
    showMessage("This test action requires the Sales test account.", true);
    return;
  }

  const confirmed = window.confirm(
    "Resolve the HOD query for synthetic application LN-2026-000014? " +
    "This should return it to HOD_IN_REVIEW. KYC will remain unchanged."
  );

  if (!confirmed) return;

  try {
    const result = await request(
      "/api/v1/applications/bede793b-ae01-4818-ba1b-46b34fd1fbb4/resolve-query",
      {
        method: "POST",
        body: JSON.stringify({
          comment: "Synthetic workflow test only: Sales has reviewed and resolved the HOD query."
        })
      }
    );

    showMessage(
      `Query resolution completed. Returned status: ${result?.status ?? "check response below"}`
    );

    await loadApplications();
  } catch (error) {
    showMessage(error.message, true);
  }
});
