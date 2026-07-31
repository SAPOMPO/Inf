import { db, doc, collection, writeBatch, onSnapshot, query, where, orderBy, limit, getDocs } from "./firebase.js";

class TelemetryNetworkError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = "TelemetryNetworkError";
        this.statusCode = statusCode;
        this.timestamp = new Date().toISOString();
    }
}

class TelemetryApiError extends Error {
    constructor(message, endpoint) {
        super(message);
        this.name = "TelemetryApiError";
        this.endpoint = endpoint;
        this.timestamp = new Date().toISOString();
    }
}

class TelemetryTimeoutError extends Error {
    constructor(message, timeoutDuration) {
        super(message);
        this.name = "TelemetryTimeoutError";
        this.timeoutDuration = timeoutDuration;
        this.timestamp = new Date().toISOString();
    }
}

class FirestoreWriteError extends Error {
    constructor(message, errorCode) {
        super(message);
        this.name = "FirestoreWriteError";
        this.errorCode = errorCode;
        this.timestamp = new Date().toISOString();
    }
}

const FIRESTORE_PROJECT_ID = "fir-90ac4";
const ENDPOINT_FIRESTORE_REST = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/visitas_avanzadas`;

const fetchWithExponentialBackoff = async (url, options = {}, maxRetries = 5, baseDelayMs = 1000) => {
    let currentRetry = 0;
    while (currentRetry < maxRetries) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
        try {
            const fetchOptions = { ...options, signal: controller.signal };
            delete fetchOptions.timeoutMs;
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);
            
            if (response.ok) {
                return await response.json();
            }
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                throw new TelemetryNetworkError("Client error encountered", response.status);
            }
            throw new TelemetryApiError("Server error or rate limit", url);
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === "AbortError") {
                if (currentRetry === maxRetries - 1) {
                    throw new TelemetryTimeoutError("Max retries reached due to timeout", options.timeoutMs || 5000);
                }
            } else if (error instanceof TelemetryNetworkError) {
                throw error;
            }
            currentRetry++;
            if (currentRetry >= maxRetries) {
                throw error;
            }
            const delay = baseDelayMs * Math.pow(2, currentRetry) + Math.floor(Math.random() * 250);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

const getGpuInfo = () => {
    try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
        if (!gl) return { vendor: "N/A", renderer: "N/A" };
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        return debugInfo ? {
            vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
            renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        } : { vendor: "N/A", renderer: "N/A" };
    } catch {
        return { vendor: "Error", renderer: "Error" };
    }
};

const getPluginsInfo = () => {
    try {
        return Array.from(navigator.plugins).map(p => p.name).join(", ") || "Ninguno";
    } catch {
        return "N/A";
    }
};

const getBatteryData = async () => {
    try {
        if (!("getBattery" in navigator)) return { level: "N/A", charging: "N/A", chargingTime: "N/A", dischargingTime: "N/A" };
        const b = await navigator.getBattery();
        return {
            level: b.level * 100,
            charging: b.charging,
            chargingTime: b.chargingTime === Infinity ? "Infinity" : b.chargingTime,
            dischargingTime: b.dischargingTime === Infinity ? "Infinity" : b.dischargingTime
        };
    } catch {
        return { level: "Error", charging: "Error", chargingTime: "Error", dischargingTime: "Error" };
    }
};

const getNetworkData = async () => {
    try {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) return { effectiveType: "N/A", downlink: "N/A", rtt: "N/A", saveData: "N/A" };
        return {
            effectiveType: conn.effectiveType || "N/A",
            downlink: conn.downlink || "N/A",
            rtt: conn.rtt || "N/A",
            saveData: conn.saveData || false
        };
    } catch {
        return { effectiveType: "Error", downlink: "Error", rtt: "Error", saveData: "Error" };
    }
};

const getUaData = async () => {
    try {
        if (!navigator.userAgentData) return { platform: navigator.platform, architecture: "N/A", bitness: "N/A", brands: "N/A" };
        const ua = await navigator.userAgentData.getHighEntropyValues(["architecture", "bitness", "model", "platform", "platformVersion", "fullVersionList"]);
        return {
            platform: ua.platform || "N/A",
            architecture: ua.architecture || "N/A",
            bitness: ua.bitness || "N/A",
            brands: ua.fullVersionList ? ua.fullVersionList.map(b => `${b.brand} ${b.version}`).join(", ") : "N/A"
        };
    } catch {
        return { platform: "Error", architecture: "Error", bitness: "Error", brands: "Error" };
    }
};

const getIpAndGeoData = async () => {
    try {
        const ipData = await fetchWithExponentialBackoff("https://api.ipify.org?format=json", { timeoutMs: 3500 }, 3, 600);
        if (!ipData || !ipData.ip) throw new TelemetryApiError("Invalid IP response structure", "ipify");
        
        const geoData = await fetchWithExponentialBackoff(`https://ipapi.co/${ipData.ip}/json/`, { timeoutMs: 3500 }, 3, 600);
        if (!geoData) throw new TelemetryApiError("Invalid Geo response structure", "ipapi");
        
        return {
            ip: ipData.ip,
            country: geoData.country_name || "N/A",
            region: geoData.region || "N/A",
            city: geoData.city || "N/A",
            isp: geoData.org || "N/A",
            latitude: geoData.latitude || "N/A",
            longitude: geoData.longitude || "N/A"
        };
    } catch (error) {
        return { ip: "Fallida", country: "N/A", region: "N/A", city: "N/A", isp: "N/A", latitude: "N/A", longitude: "N/A" };
    }
};

const gatherClientTelemetry = async () => {
    const timestampIso = new Date().toISOString();
    
    const staticData = {
        hardware: {
            cores: navigator.hardwareConcurrency || "N/A",
            ramGb: navigator.deviceMemory || "N/A"
        },
        display: {
            colorDepth: window.screen.colorDepth || "N/A",
            pixelDepth: window.screen.pixelDepth || "N/A",
            devicePixelRatio: window.devicePixelRatio || "N/A",
            orientation: window.screen.orientation ? window.screen.orientation.type : "N/A",
            maxTouchPoints: navigator.maxTouchPoints || 0,
            isFullscreen: document.fullscreenElement !== null,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight
        },
        software: {
            languages: navigator.languages ? navigator.languages.join(", ") : navigator.language,
            cookiesEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack === "1" || navigator.doNotTrack === "yes",
            plugins: getPluginsInfo()
        },
        gpu: getGpuInfo()
    };

    const [battery, network, uaData, geoData] = await Promise.all([
        getBatteryData(),
        getNetworkData(),
        getUaData(),
        getIpAndGeoData()
    ]);

    return {
        timestampIso,
        ...staticData,
        battery,
        network,
        environment: uaData,
        location: geoData,
        session: {
            totalSeconds: 0,
            activeSeconds: 0,
            inactiveSeconds: 0,
            eventsFired: 0
        }
    };
};

let activeTime = 0;
let inactiveTime = 0;
let lastTick = Date.now();
let lastActivityTime = Date.now();
let isUserActive = !document.hidden;
let eventCounter = 0;
let recordKey = null;

const updateActivityState = () => {
    isUserActive = true;
    lastActivityTime = Date.now();
    eventCounter++;
};

const setupActivityListeners = () => {
    const options = { passive: true };
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt => {
        window.addEventListener(evt, updateActivityState, options);
    });
    
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) updateActivityState();
    });
};

const updateTimers = () => {
    const now = Date.now();
    const delta = (now - lastTick) / 1000;
    
    if (document.hidden || (now - lastActivityTime > 8000)) {
        isUserActive = false;
    }
    
    if (isUserActive) {
        activeTime += delta;
    } else {
        inactiveTime += delta;
    }
    lastTick = now;
};

const updateUiState = (state) => {
    const box = document.getElementById("ui-box");
    const msg = document.getElementById("status-message");
    const spinner = document.getElementById("spinner");
    const icon = document.getElementById("status-icon");

    box.className = `content-box ${state}`;
    spinner.style.display = "none";
    icon.style.display = "block";

    if (state === "success") {
        msg.textContent = "Los datos se le enviara en un momento, por favor espere... (45-60 segundos)";
        icon.textContent = "✔️";
    } else {
        msg.textContent = "Error de de busqueda de datos, por favor recarga la pagina de nuevo.";
        icon.textContent = "❌";
    }
};

const executeForceDisconnect = () => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.95)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.justifyContent = "center";
    overlay.style.alignItems = "center";
    overlay.style.color = "#ff4c4c";
    overlay.style.fontFamily = "monospace";

    const message = document.createElement("h1");
    message.textContent = "CONEXIÓN TERMINADA POR EL ADMINISTRADOR";
    message.style.fontSize = "2rem";
    message.style.marginBottom = "20px";
    message.style.textAlign = "center";

    const subMessage = document.createElement("p");
    subMessage.textContent = "Su sesión ha sido revocada remotamente.";
    subMessage.style.fontSize = "1.2rem";

    overlay.appendChild(message);
    overlay.appendChild(subMessage);
    document.body.appendChild(overlay);

    window.removeEventListener("beforeunload", handleUnloadEvent);
};

const setupRealtimeListener = (docRef) => {
    try {
        onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                if (data.force_disconnect === true) {
                    executeForceDisconnect();
                }
            }
        }, (error) => {
            if (error.code === "permission-denied") {
                updateUiState("error");
            }
        });
    } catch (error) {
        updateUiState("error");
    }
};

const initializeSystem = async () => {
    try {
        if (!navigator.onLine) {
            throw new TelemetryNetworkError("Client is offline during initialization", 0);
        }

        const telemetryPayload = await gatherClientTelemetry();
        const mainCollectionRef = collection(db, "visitas_avanzadas");
        const mainDocRef = doc(mainCollectionRef);
        recordKey = mainDocRef.id;

        const batch = writeBatch(db);

        batch.set(mainDocRef, {
            timestampIso: telemetryPayload.timestampIso,
            userAgent: navigator.userAgent,
            force_disconnect: false
        });

        const hardwareRef = doc(mainCollectionRef, recordKey, "metricas_hardware", "datos");
        batch.set(hardwareRef, {
            hardware: telemetryPayload.hardware,
            display: telemetryPayload.display,
            gpu: telemetryPayload.gpu
        });

        const networkRef = doc(mainCollectionRef, recordKey, "metricas_red", "datos");
        batch.set(networkRef, {
            battery: telemetryPayload.battery,
            network: telemetryPayload.network,
            location: telemetryPayload.location,
            environment: telemetryPayload.environment
        });

        const sessionRef = doc(mainCollectionRef, recordKey, "sesion_tiempos", "datos");
        batch.set(sessionRef, {
            session: telemetryPayload.session,
            software: telemetryPayload.software
        });

        await batch.commit();

        setupActivityListeners();
        setInterval(updateTimers, 1000);
        updateUiState("success");
        setupRealtimeListener(mainDocRef);
    } catch (error) {
        updateUiState("error");
    }
};

const buildFirestoreRestPayload = (active, inactive, counter) => {
    return {
        fields: {
            session: {
                mapValue: {
                    fields: {
                        totalSeconds: { doubleValue: parseFloat((active + inactive).toFixed(2)) },
                        activeSeconds: { doubleValue: parseFloat(active.toFixed(2)) },
                        inactiveSeconds: { doubleValue: parseFloat(inactive.toFixed(2)) },
                        eventsFired: { integerValue: counter }
                    }
                }
            },
            exitTimeIso: { stringValue: new Date().toISOString() }
        }
    };
};

const handleUnloadEvent = () => {
    if (!recordKey) return;
    
    updateTimers();
    const exitData = buildFirestoreRestPayload(activeTime, inactiveTime, eventCounter);
    const url = `${ENDPOINT_FIRESTORE_REST}/${recordKey}/sesion_tiempos/datos?updateMask.fieldPaths=session&updateMask.fieldPaths=exitTimeIso`;
    
    try {
        fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exitData),
            keepalive: true
        });
    } catch (e) {
        try {
            navigator.sendBeacon(url, JSON.stringify(exitData));
        } catch (innerError) {
            recordKey = null;
        }
    }
};

window.addEventListener("beforeunload", handleUnloadEvent);
document.addEventListener("DOMContentLoaded", initializeSystem);

const runExampleQueriesForAdmin = async () => {
    try {
        const baseRef = collection(db, "visitas_avanzadas");

        const q1 = query(baseRef, where("force_disconnect", "==", false), orderBy("timestampIso", "desc"), limit(10));
        const snapshot1 = await getDocs(q1);
        const activeUsers = [];
        snapshot1.forEach(docSnap => activeUsers.push({ id: docSnap.id, ...docSnap.data() }));

        const q2 = query(baseRef, where("userAgent", ">=", "Mozilla"), limit(5));
        const snapshot2 = await getDocs(q2);
        const mozillaUsers = [];
        snapshot2.forEach(docSnap => mozillaUsers.push({ id: docSnap.id, ...docSnap.data() }));

        const hardwareGroupRef = collection(db, "metricas_hardware");
        const q3 = query(hardwareGroupRef, where("gpu.vendor", "==", "NVIDIA"), limit(20));
        const snapshot3 = await getDocs(q3);
        const nvidiaGpus = [];
        snapshot3.forEach(docSnap => nvidiaGpus.push({ id: docSnap.id, ...docSnap.data() }));

        const networkGroupRef = collection(db, "metricas_red");
        const q4 = query(networkGroupRef, where("location.country", "==", "Colombia"), orderBy("network.downlink", "desc"), limit(15));
        const snapshot4 = await getDocs(q4);
        const colombiaUsers = [];
        snapshot4.forEach(docSnap => colombiaUsers.push({ id: docSnap.id, ...docSnap.data() }));

        return { activeUsers, mozillaUsers, nvidiaGpus, colombiaUsers };
    } catch (error) {
        if (error.code === "failed-precondition") {
            return { indexRequired: true, message: error.message };
        }
        return { error: true, code: error.code };
    }
};