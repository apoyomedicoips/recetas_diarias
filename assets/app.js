// Configuración general del frontend
const CONFIG = {
  GAS_ENDPOINT: "https://script.google.com/macros/s/AKfycbyyu7F38-TxdXhGP-CZzBGaQobtWWp1PnuKXJvXZV6gYGawTgzUf7aFc3hXMEU2ttmfrg/exec",
  LOGO_URL: "https://i.postimg.cc/REEMPLAZAR_RUTA/logo-ips.png", // sustituir por URL real del logo
  UMBRAL_CRITICO_DEFAULT: 7
};

const state = {
  user: null,
  filters: {
    fechaDesde: null,
    fechaHasta: null,
    farmacia: "",
    medicamento: "",
    soloEsenciales: false,
    umbralCritico: CONFIG.UMBRAL_CRITICO_DEFAULT
  },
  charts: {
    series: null,
    topMeds: null
  },
  tables: {
    stockCritico: null,
    quiebresFarmacia: null
  }
};

// ======================= Utilidades =======================

function setLogoSources(){
  const logoUrl = CONFIG.LOGO_URL;
  document.getElementById("login-logo").src = logoUrl;
  document.getElementById("header-logo").src = logoUrl;
  document.getElementById("footer-logo").src = logoUrl;
}

function setFooterYear(){
  const y = new Date().getFullYear();
  document.getElementById("footer-year").textContent = String(y);
}

function showElement(id){
  document.getElementById(id).classList.remove("d-none");
}

function hideElement(id){
  document.getElementById(id).classList.add("d-none");
}

function setBadge(text, type){
  const badge = document.getElementById("badge-estado");
  badge.textContent = text;
  badge.className = "badge border";
  if(type === "error"){
    badge.classList.add("bg-danger-subtle","text-danger","border-danger-subtle");
  } else if(type === "loading"){
    badge.classList.add("bg-warning-subtle","text-warning","border-warning-subtle");
  } else {
    badge.classList.add("bg-success-subtle","text-success","border-success-subtle");
  }
}

function showLoading(show){
  const overlay = document.getElementById("loading-overlay");
  if(show){
    overlay.classList.remove("d-none");
    setBadge("Actualizando datos...", "loading");
  } else {
    overlay.classList.add("d-none");
  }
}

function formatInt(x){
  if(x === null || x === undefined || isNaN(x)) return "-";
  return x.toLocaleString("es-PY");
}

function formatPct(x){
  if(x === null || x === undefined || isNaN(x)) return "-";
  return (x*100).toFixed(1) + "%";
}

function formatFixed(x, d){
  if(x === null || x === undefined || isNaN(x)) return "-";
  return Number(x).toFixed(d);
}

async function fetchJson(params){
  const url = new URL(CONFIG.GAS_ENDPOINT);
  Object.entries(params).forEach(([k,v]) => {
    if(v !== null && v !== undefined && v !== ""){
      url.searchParams.set(k, v);
    }
  });

  const res = await fetch(url.toString(), { method: "GET", redirect: "follow" });
  if(!res.ok){
    throw new Error("HTTP " + res.status);
  }
  const data = await res.json();
  if(data && data.ok === false){
    throw new Error(data.error || "Error en API");
  }
  return data;
}

// ======================= Login =======================

async function handleLogin(evt){
  evt.preventDefault();
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value.trim();
  const errorBox = document.getElementById("login-error");
  errorBox.classList.add("d-none");
  errorBox.textContent = "";

  if(!user || !pass){
    errorBox.textContent = "Ingrese usuario y contraseña.";
    errorBox.classList.remove("d-none");
    return;
  }

  try{
    document.getElementById("login-form").querySelector("button[type='submit']").disabled = true;

    const data = await fetchJson({
      action: "login",
      usuario: user,
      clave: pass
    });

    if(!data || !data.ok){
      throw new Error(data && data.message ? data.message : "Credenciales inválidas");
    }

    state.user = {
      usuario: data.usuario,
      nombre: data.nombre,
      rol: data.rol || "usuario"
    };

    document.getElementById("user-name").textContent = state.user.nombre || state.user.usuario;

    // Cambiar vistas
    document.getElementById("login-screen").classList.add("d-none");
    document.getElementById("app-shell").classList.remove("d-none");

    await inicializarDashboard();
  } catch(err){
    console.error(err);
    errorBox.textContent = err.message || "No se pudo iniciar sesión.";
    errorBox.classList.remove("d-none");
  } finally {
    document.getElementById("login-form").querySelector("button[type='submit']").disabled = false;
  }
}

function handleLogout(){
  state.user = null;
  // Limpiar campos
  document.getElementById("login-user").value = "";
  document.getElementById("login-pass").value = "";
  document.getElementById("user-name").textContent = "-";
  // Mostrar login
  document.getElementById("app-shell").classList.add("d-none");
  document.getElementById("login-screen").classList.remove("d-none");
}

// ======================= Filtros =======================

function leerFiltrosDesdeUI(){
  state.filters.fechaDesde = document.getElementById("f-fecha-desde").value || null;
  state.filters.fechaHasta = document.getElementById("f-fecha-hasta").value || null;
  state.filters.farmacia = document.getElementById("f-farmacia").value || "";
  state.filters.medicamento = document.getElementById("f-medicamento").value || "";
  state.filters.soloEsenciales = document.getElementById("f-solo-esenciales").checked;
  const umbral = Number(document.getElementById("f-umbral-critico").value);
  state.filters.umbralCritico = isNaN(umbral) || umbral <= 0 ? CONFIG.UMBRAL_CRITICO_DEFAULT : umbral;
}

function resetFiltros(){
  document.getElementById("f-fecha-desde").value = "";
  document.getElementById("f-fecha-hasta").value = "";
  document.getElementById("f-farmacia").value = "";
  document.getElementById("f-medicamento").value = "";
  document.getElementById("f-solo-esenciales").checked = false;
  document.getElementById("f-umbral-critico").value = CONFIG.UMBRAL_CRITICO_DEFAULT;
  leerFiltrosDesdeUI();
}

// ======================= Inicialización =======================

async function inicializarDashboard(){
  try{
    showLoading(true);
    setBadge("Cargando metadatos...", "loading");

    const meta = await fetchJson({ action: "metadata" });
    poblarFiltros(meta);
    resetFiltros();

    await actualizarDashboard();
  } catch(err){
    console.error(err);
    setBadge("Error al cargar datos", "error");
    alert("Error al cargar datos iniciales: " + err.message);
  } finally {
    showLoading(false);
  }
}

function poblarFiltros(meta){
  // Fechas mínimas y máximas
  if(meta && meta.fechas){
    document.getElementById("f-fecha-desde").value = meta.fechas.min || "";
    document.getElementById("f-fecha-hasta").value = meta.fechas.max || "";
  }

  // Farmacias
  const selFarm = document.getElementById("f-farmacia");
  selFarm.innerHTML = '<option value="">Todas</option>';
  if(meta && Array.isArray(meta.farmacias)){
    meta.farmacias.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.codigo;
      opt.textContent = f.codigo + " - " + f.nombre;
      selFarm.appendChild(opt);
    });
  }

  // Medicamentos
  const selMed = document.getElementById("f-medicamento");
  selMed.innerHTML = '<option value="">Todos</option>';
  if(meta && Array.isArray(meta.medicamentos)){
    meta.medicamentos.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.codigo;
      opt.textContent = m.codigo + " - " + m.nombre;
      selMed.appendChild(opt);
    });
  }
}

// ======================= Actualización del tablero =======================

async function actualizarDashboard(){
  leerFiltrosDesdeUI();
  showLoading(true);
  setBadge("Actualizando tablero...", "loading");

  try{
    const params = {
      action: "summary",
      fechaDesde: state.filters.fechaDesde,
      fechaHasta: state.filters.fechaHasta,
      farmacia: state.filters.farmacia,
      medicamento: state.filters.medicamento,
      soloEsenciales: state.filters.soloEsenciales ? "1" : "",
      umbralCritico: state.filters.umbralCritico
    };

    const data = await fetchJson(params);
    refrescarKpis(data);
    refrescarEtiquetas(data);
    refrescarCharts(data);
    refrescarTablas(data);

    setBadge("Datos actualizados", "ok");
  } catch(err){
    console.error(err);
    setBadge("Error al actualizar", "error");
    alert("Error al actualizar tablero: " + err.message);
  } finally{
    showLoading(false);
  }
}

function refrescarEtiquetas(data){
  if(!data || !data.fechas) return;
  const periodo = (data.fechas.min || "?") + " a " + (data.fechas.max || "?");
  document.getElementById("lbl-periodo").textContent = periodo;
}

function refrescarKpis(data){
  if(!data || !data.kpis) return;
  const kpis = data.kpis;
  document.getElementById("kpi-recetas").textContent = formatInt(kpis.total_recetado || 0);
  document.getElementById("kpi-dispensado").textContent = formatInt(kpis.total_dispensado || 0);
  document.getElementById("kpi-quiebre").textContent = formatPct(kpis.tasa_quiebre || 0);
  document.getElementById("kpi-criticos").textContent = formatInt(kpis.items_criticos || 0);
}

// ======================= Gráficos =======================

function buildOrUpdateChartSeries(series){
  const ctx = document.getElementById("chart-series").getContext("2d");
  const labels = (series && Array.isArray(series.fechas)) ? series.fechas : [];
  const rec = (series && Array.isArray(series.recetado)) ? series.recetado : [];
  const disp = (series && Array.isArray(series.dispensado)) ? series.dispensado : [];

  const data = {
    labels,
    datasets: [
      {
        label: "Recetado",
        data: rec,
        borderColor: "rgba(248, 250, 252, 0.8)",
        backgroundColor: "rgba(248, 250, 252, 0.1)",
        tension: 0.25,
        fill: false
      },
      {
        label: "Dispensado",
        data: disp,
        borderColor: "rgba(56, 189, 248, 0.9)",
        backgroundColor: "rgba(56, 189, 248, 0.15)",
        tension: 0.25,
        fill: true
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 8,
          color: "#9ca3af"
        },
        grid: {
          color: "rgba(55,65,81,0.4)"
        }
      },
      y: {
        ticks: {
          color: "#9ca3af"
        },
        grid: {
          color: "rgba(31,41,55,0.5)"
        }
      }
    },
    plugins: {
      legend: {
        labels: {
          color: "#e5e7eb"
        }
      }
    }
  };

  if(state.charts.series){
    state.charts.series.data = data;
    state.charts.series.options = options;
    state.charts.series.update();
  } else {
    state.charts.series = new Chart(ctx, {
      type: "line",
      data,
      options
    });
  }
}

function buildOrUpdateChartTopMeds(topMeds){
  const ctx = document.getElementById("chart-top-meds").getContext("2d");
  const labels = Array.isArray(topMeds) ? topMeds.map(m => m.medicamento) : [];
  const disp = Array.isArray(topMeds) ? topMeds.map(m => m.dispensado) : [];

  const data = {
    labels,
    datasets: [
      {
        label: "Unidades dispensadas",
        data: disp,
        backgroundColor: "rgba(34, 197, 94, 0.7)",
        borderRadius: 6
      }
    ]
  };

  const options = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { color: "#9ca3af" },
        grid: { color: "rgba(31,41,55,0.5)" }
      },
      y: {
        ticks: { color: "#9ca3af" },
        grid: { display:false }
      }
    },
    plugins: {
      legend: {
        display:false
      }
    }
  };

  if(state.charts.topMeds){
    state.charts.topMeds.data = data;
    state.charts.topMeds.options = options;
    state.charts.topMeds.update();
  } else {
    state.charts.topMeds = new Chart(ctx, {
      type: "bar",
      data,
      options
    });
  }
}

function refrescarCharts(data){
  buildOrUpdateChartSeries(data.series || null);
  buildOrUpdateChartTopMeds(data.top_meds || []);
}

// ======================= Tablas =======================

function crearOActualizarTablaStockCritico(rows){
  const tableId = "#tbl-stock-critico";
  if(state.tables.stockCritico){
    const dt = state.tables.stockCritico;
    dt.clear();
    dt.rows.add(rows);
    dt.draw();
    return;
  }

  state.tables.stockCritico = $(tableId).DataTable({
    data: rows,
    columns: [
      { data: "farmacia" },
      { data: "medicamento" },
      { data: "stock_ult", render: formatInt },
      { data: "consumo_diario", render: v => formatFixed(v, 2) },
      { data: "dias_cobertura", render: v => formatFixed(v, 1) },
      { data: "reposicion_requerida", render: formatInt }
    ],
    pageLength: 8,
    lengthChange: false,
    order: [[4, "asc"]],
    language: {
      url: "https://cdn.datatables.net/plug-ins/1.13.8/i18n/es-ES.json"
    }
  });
}

function crearOActualizarTablaQuiebres(rows){
  const tableId = "#tbl-quiebres-farmacia";
  if(state.tables.quiebresFarmacia){
    const dt = state.tables.quiebresFarmacia;
    dt.clear();
    dt.rows.add(rows);
    dt.draw();
    return;
  }

  state.tables.quiebresFarmacia = $(tableId).DataTable({
    data: rows,
    columns: [
      { data: "farmacia" },
      { data: "dias_observados", render: formatInt },
      { data: "recetado", render: formatInt },
      { data: "dispensado", render: formatInt },
      { data: "quiebres", render: formatInt },
      { data: "tasa_quiebre", render: formatPct },
      { data: "fill_rate_global", render: formatPct }
    ],
    pageLength: 8,
    lengthChange: false,
    order: [[5, "desc"]],
    language: {
      url: "https://cdn.datatables.net/plug-ins/1.13.8/i18n/es-ES.json"
    }
  });
}

function refrescarTablas(data){
  crearOActualizarTablaStockCritico(data.stock_critico || []);
  crearOActualizarTablaQuiebres(data.quiebres_farmacia || []);
}

// ======================= Eventos DOM =======================

document.addEventListener("DOMContentLoaded", () => {
  setLogoSources();
  setFooterYear();

  document.getElementById("login-form").addEventListener("submit", handleLogin);
  document.getElementById("btn-logout").addEventListener("click", handleLogout);

  document.getElementById("btn-aplicar-filtros").addEventListener("click", () => {
    actualizarDashboard();
  });

  document.getElementById("btn-reset-filtros").addEventListener("click", () => {
    resetFiltros();
    actualizarDashboard();
  });
});
