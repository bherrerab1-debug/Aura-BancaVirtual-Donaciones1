// =========================================================================
// CONFIGURACIÓN CENTRAL DE LAS APIS (Ecosistema Integrado AURA & DONACIONES)
// =========================================================================
const API = "https://api-banco-services.azurewebsites.net";
const API_DONACIONES_AZURE = "https://donacionesapi.azurewebsites.net/api/Donaciones";

let appState = {
    cliente: null,
    cuentaId: null,
    saldo: 0,
    movimientos: []
};

let financialChartInstance = null;

// ========================================\
// INICIALIZACIÓN DE ENTORNO
// ========================================\
document.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
});

function initApp() {
    actualizarSaludo();
}

function actualizarSaludo() {
    const el = document.getElementById("greeting");
    if (!el) return;

    const h = new Date().getHours();
    if (h < 12) el.innerText = \"Buenos días\";
    else if (h < 19) el.innerText = \"Buenas tardes\";
    else el.innerText = \"Buenas noches\";
}

// ========================================\
// ESCUCHADORES DE EVENTOS DE FORMULARIO
// ========================================\
function setupEventListeners() {
    document.getElementById("form-login")?.addEventListener("submit", handleLogin);
    document.getElementById("form-register")?.addEventListener("submit", handleRegister);
    document.getElementById("form-transfer")?.addEventListener("submit", handleTransfer);

    // Escuchador exclusivo del nuevo formulario de Donaciones con tu API
    document.getElementById("form-donar-banco")?.addEventListener("submit", handleDonacionReal);

    // Sistema de navegación nativo del dashboard (Se adaptó para soportar la nueva sección)
    document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const targetId = item.getAttribute("data-target");

            document.querySelectorAll(".sidebar-nav .nav-item").forEach(i => i.classList.remove("active"));
            document.querySelectorAll(".app-section").forEach(s => s.classList.remove("active"));

            item.classList.add("active");
            document.getElementById(targetId)?.classList.add("active");

            // Si el usuario entra al módulo de donaciones, refrescamos el historial desde Azure
            if (targetId === "sec-donaciones") {
                cargarDonacionesDesdeAzure();
            }
        });
    });
}

// =========================================================================
// MÓDULO NUEVO: INTEGRACIÓN CON TU API DE DONACIONES EN AZURE
// =========================================================================

// Función 1: Carga y renderiza la interfaz de auditoría basada en tu GET /api/Donaciones
async function cargarDonacionesDesdeAzure() {
    const tbody = document.getElementById("table-donaciones-api-body");
    if (!tbody) return;

    try {
        const res = await fetch(API_DONACIONES_AZURE);
        if (!res.ok) throw new Error("Fallo en el servicio Azure");

        const donaciones = await res.json();
        tbody.innerHTML = "";

        if (donaciones.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No hay donaciones en el ledger central.</td></tr>`;
            return;
        }

        // Renderizado inverso para ver las transacciones más recientes arriba
        donaciones.reverse().forEach(d => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td style="font-family: monospace; color: var(--accent-gold);">${d.codigoTransaccionBanco || 'TX-N/A'}</td>
                <td>Q${parseFloat(d.montoTotal).toFixed(2)}</td>
                <td class="txt-aprobado">Q${parseFloat(d.montoInstitucion95).toFixed(2)}</td>
                <td style="color: var(--text-secondary);">Q${parseFloat(d.montoComisionBanco5).toFixed(2)}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error("Error cargando auditoría de Azure:", err);
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--accent-crimson);">Error al conectar con Azure Ledger.</td></tr>`;
    }
}

// Función 2: Procesa la donación real consumiendo el POST /api/Donaciones/procesar de tu Azure
async function handleDonacionReal(e) {
    e.preventDefault();

    const instId = parseInt(document.getElementById("donation-institution").value);
    const monto = parseFloat(document.getElementById("donation-amount").value);

    if (monto <= 0 || isNaN(monto)) {
        showToast("Establezca un volumen de capital válido ❌", "error");
        return;
    }

    if (monto > appState.saldo) {
        showToast("Liquidez insuficiente en cuenta de cargo ❌", "error");
        return;
    }

    // Estructura JSON adaptada a la DTO de tu controlador conectado al banco central
    const payload = {
        institucionId: instId,
        cuentaId: appState.cuentaId, // ID numérico de la sesión real
        montoTotal: monto
    };

    try {
        showToast("Transmitiendo orden de débito a Azure... ⏳", "normal");

        const res = await fetch(`${API_DONACIONES_AZURE}/procesar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok) {
            showToast("Donación autorizada y debitada de forma exitosa ✅", "success");
            document.getElementById("form-donar-banco").reset();

            // Forzar actualización inmediata de la interfaz y del saldo local en la pantalla
            await syncDashboardData(appState.cuentaId);
            await cargarDonacionesDesdeAzure();
        } else {
            showToast(`Rechazado por Azure: ${data.mensaje || 'Error operativo'} ❌`, "error");
        }
    } catch (err) {
        console.error("Fallo de comunicación con la API de donaciones:", err);
        showToast("Error de enlace crítico con el microservicio de Azure ❌", "error");
    }
}

// ========================================\
// OPERACIONES DEL CORE BANCARIO (AURA)
// ========================================\
async function handleLogin(e) {
    e.preventDefault();
    const cui = document.getElementById("login-cui").value;
    const pin = document.getElementById("login-pin").value;

    try {
        const res = await fetch(`${API}/api/Cliente/login?cui=${cui}&pin=${pin}`, { method: "POST" });
        if (!res.ok) {
            showToast("Credenciales de acceso inválidas ❌", "error");
            return;
        }
        const cliente = await res.json();
        showToast("Autenticación verificada correctamente ✅", "success");

        await syncDashboardData(cliente.cuentaId);

        document.getElementById("auth-container").classList.add("hidden");
        document.getElementById("main-app").classList.remove("hidden");
    } catch (err) {
        showToast("Fallo de conexión con la infraestructura central ❌", "error");
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById("reg-name").value;
    const cui = document.getElementById("reg-cui").value;
    const pin = document.getElementById("reg-pin").value;

    try {
        const res = await fetch(`${API}/api/Cliente/registro?nombre=${encodeURIComponent(name)}&cui=${cui}&pin=${pin}`, { method: "POST" });
        if (!res.ok) {
            showToast("Error estructural en el registro o CUI duplicado ❌", "error");
            return;
        }
        showToast("Registro patrimonial completado con éxito ✅", "success");
        document.getElementById("form-register").reset();
        switchAuthForm("login");
    } catch (err) {
        showToast("Error al procesar alta en base de datos ❌", "error");
    }
}

async function handleTransfer(e) {
    e.preventDefault();
    const dest = document.getElementById("transfer-account").value;
    const amt = parseFloat(document.getElementById("transfer-amount").value);

    if (amt > appState.saldo) {
        showToast("Liquidez insuficiente en cuenta de cargo ❌", "error");
        return;
    }

    try {
        const res = await fetch(`${API}/api/Banco/procesar?cuentaId=${appState.cuentaId}&monto=${amt}&servicio=Transferencia_Hacia_ID_${dest}`, { method: "POST" });
        if (!res.ok) {
            showToast("La transferencia estratégica ha sido rechazada ❌", "error");
            return;
        }
        showToast("Transferencia interbancaria ejecutada ✅", "success");
        document.getElementById("form-transfer").reset();
        await syncDashboardData(appState.cuentaId);
    } catch (err) {
        showToast("Fallo de red en transferencia ❌", "error");
    }
}

// Sincronización analítica de datos financieros y actualización de paneles en tiempo real
async function syncDashboardData(cuentaId) {
    try {
        const [resCliente, resSaldo, resMovs] = await Promise.all([
            fetch(`${API}/api/Cliente/cuenta/${cuentaId}`),
            fetch(`${API}/api/Cuenta/saldo?cuentaId=${cuentaId}`),
            fetch(`${API}/api/Cuenta/movimientos?cuentaId=${cuentaId}`)
        ]);

        const cliente = await resCliente.json();
        const saldo = await resSaldo.json();
        const movimientos = await resMovs.json();

        appState.cliente = cliente;
        appState.cuentaId = cuentaId;
        appState.saldo = parseFloat(saldo);
        appState.movimientos = movimientos;

        document.getElementById("user-display-name").innerText = cliente.nombre;
        document.getElementById("account-display-id").innerText = `ID: ${cuentaId}`;
        document.getElementById("balance-amount").innerText = appState.saldo.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        renderMovementsTable(movimientos);
        renderFinancialChart(movimientos);
    } catch (err) {
        console.error("Error en sincronización táctica:", err);
    }
}

function renderMovementsTable(movs) {
    const tbody = document.querySelector(".table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (movs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Sin actividad registrada en el ledger.</td></tr>`;
        return;
    }

    movs.reverse().forEach(m => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${new Date(m.fecha).toLocaleString()}</td>
            <td>${m.descripcion || 'Transacción de Servicios'}</td>
            <td><span class="txt-aprobado">APROBADO</span></td>
            <td style="color: var(--accent-crimson); font-weight: 600;">- Q${parseFloat(m.monto).toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderFinancialChart(movs) {
    const ctx = document.getElementById("financialChart")?.getContext("2d");
    if (!ctx) return;

    if (financialChartInstance) {
        financialChartInstance.destroy();
    }

    const cleanMovs = movs.slice(-6).reverse();
    const labels = cleanMovs.map(m => formatFecha(m.fecha));
    const data = cleanMovs.map(m => parseFloat(m.monto));

    if (data.length === 0) {
        data.push(0);
        labels.push("Sin datos");
    }

    financialChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Volumen de Retiros (Q)',
                data: data,
                borderColor: '#d4af37',
                backgroundColor: 'rgba(212, 175, 55, 0.05)',
                borderWidth: 2,
                pointBackgroundColor: '#d4af37',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.02)' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
                y: { grid: { color: 'rgba(255,255,255,0.02)' }, ticks: { color: '#9ca3af', font: { size: 10 } } }
            }
        }
    });
}

function switchAuthForm(formType) {
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
    if (formType === "login") document.getElementById("form-login").classList.add("active");
    else document.getElementById("form-register").classList.add("active");
}

function formatFecha(f) {
    if (!f) return "";
    return new Date(f).toLocaleDateString("es-GT", { day: 'numeric', month: 'short' });
}

function logout() {
    appState = { cliente: null, cuentaId: null, saldo: 0, movimientos: [] };

    if (financialChartInstance) {
        financialChartInstance.destroy();
        financialChartInstance = null;
    }

    document.getElementById("main-app").classList.add("hidden");
    document.getElementById("auth-container").classList.remove("hidden");
    document.getElementById("form-login").reset();
    switchAuthForm("login");

    showToast("Sesión cerrada de manera segura ✅", "normal");
}

function showToast(msg, type = "normal") {
    const c = document.getElementById("toast-container");
    if (!c) return;

    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.innerText = msg;

    c.appendChild(t);

    setTimeout(() => {
        t.style.opacity = "0";
        setTimeout(() => t.remove(), 400);
    }, 4000);
}