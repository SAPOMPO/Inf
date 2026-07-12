import { db, ref, push } from "./firebase.js";

function extractDeviceType(userAgent, screenWidth) {
    if (/Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) {
        return "Móvil";
    }
    if (/Tablet|iPad/i.test(userAgent) || (screenWidth >= 768 && screenWidth <= 1024)) {
        return "Tablet";
    }
    return "Escritorio";
}

function extractOS(userAgent) {
    let osVersion = "Desconocida";
    let osName = "Desconocido";

    if (/Windows NT 10.0/i.test(userAgent)) { osName = "Windows"; osVersion = "10/11"; }
    else if (/Windows NT 6.3/i.test(userAgent)) { osName = "Windows"; osVersion = "8.1"; }
    else if (/Windows NT 6.2/i.test(userAgent)) { osName = "Windows"; osVersion = "8"; }
    else if (/Windows NT 6.1/i.test(userAgent)) { osName = "Windows"; osVersion = "7"; }
    else if (/Mac OS X/i.test(userAgent)) {
        osName = "MacOS";
        const match = userAgent.match(/Mac OS X (\d+[._]\d+[._]?\d*)/i);
        if (match) osVersion = match[1].replace(/_/g, '.');
    }
    else if (/Android/i.test(userAgent)) {
        osName = "Android";
        const match = userAgent.match(/Android (\d+(\.\d+)?)/i);
        if (match) osVersion = match[1];
    }
    else if (/iPhone OS/i.test(userAgent)) {
        osName = "iOS";
        const match = userAgent.match(/OS (\d+[_]\d+)/i);
        if (match) osVersion = match[1].replace(/_/g, '.');
    }
    else if (/Linux/i.test(userAgent)) {
        osName = "Linux";
    }

    return `${osName} ${osVersion}`.trim();
}

function extractBrowser(userAgent) {
    let browserName = "Desconocido";
    let browserVersion = "Desconocida";

    if (userAgent.includes("Edg/")) {
        browserName = "Edge";
        browserVersion = userAgent.split("Edg/")[1].split(" ")[0];
    } else if (userAgent.includes("OPR/")) {
        browserName = "Opera";
        browserVersion = userAgent.split("OPR/")[1].split(" ")[0];
    } else if (userAgent.includes("Chrome/")) {
        browserName = "Chrome";
        browserVersion = userAgent.split("Chrome/")[1].split(" ")[0];
    } else if (userAgent.includes("Firefox/")) {
        browserName = "Firefox";
        browserVersion = userAgent.split("Firefox/")[1].split(" ")[0];
    } else if (userAgent.includes("Safari/") && !userAgent.includes("Chrome/")) {
        browserName = "Safari";
        const versionMatch = userAgent.match(/Version\/(\d+\.\d+)/);
        if (versionMatch) browserVersion = versionMatch[1];
    }

    return `${browserName} ${browserVersion}`;
}

async function retrieveClientData() {
    const dataObject = {
        timestampIso: new Date().toISOString(),
        timestampLocal: new Date().toString(),
        ip: "Desconocida",
        location: {},
        os: extractOS(navigator.userAgent),
        browser: extractBrowser(navigator.userAgent),
        deviceType: extractDeviceType(navigator.userAgent, window.innerWidth),
        screen: {
            orientation: window.screen.orientation ? window.screen.orientation.type : "Desconocida",
            totalWidth: window.screen.width,
            totalHeight: window.screen.height,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight
        },
        systemLanguage: navigator.language || "Desconocido",
        cpuCores: navigator.hardwareConcurrency || "Desconocido",
        ramGb: navigator.deviceMemory || "Desconocida",
        gpu: "Desconocida",
        battery: {
            level: "Desconocido",
            charging: "Desconocido"
        },
        network: "Desconocido",
        duration: {
            totalSeconds: 0,
            activeSeconds: 0,
            inactiveSeconds: 0
        }
    };

    try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
        if (gl) {
            const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
            if (debugInfo) {
                dataObject.gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            }
        }
    } catch (error) {}

    try {
        if ("getBattery" in navigator) {
            const battery = await navigator.getBattery();
            dataObject.battery.level = battery.level * 100;
            dataObject.battery.charging = battery.charging;
        }
    } catch (error) {}

    try {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (connection) {
            dataObject.network = connection.effectiveType || "Desconocida";
        }
    } catch (error) {}

    try {
        const ipResponse = await fetch("https://api.ipify.org?format=json");
        if (ipResponse.ok) {
            const ipData = await ipResponse.json();
            dataObject.ip = ipData.ip;
        }
    } catch (error) {}

    try {
        if (dataObject.ip !== "Desconocida") {
            const geoResponse = await fetch(`https://ipapi.co/${dataObject.ip}/json/`);
            if (geoResponse.ok) {
                const geoData = await geoResponse.json();
                dataObject.location = {
                    country: geoData.country_name || "Desconocido",
                    region: geoData.region || "Desconocido",
                    city: geoData.city || "Desconocido",
                    postalCode: geoData.postal || "Desconocido",
                    isp: geoData.org || "Desconocido",
                    latitude: geoData.latitude || "Desconocido",
                    longitude: geoData.longitude || "Desconocido"
                };
            }
        }
    } catch (error) {}

    return dataObject;
}

let activeTime = 0;
let inactiveTime = 0;
let lastTick = Date.now();
let isUserActive = !document.hidden;

function updateTimers() {
    const now = Date.now();
    const delta = (now - lastTick) / 1000;
    if (isUserActive) {
        activeTime += delta;
    } else {
        inactiveTime += delta;
    }
    lastTick = now;
}

async function initializeAnalytics() {
    try {
        const initialData = await retrieveClientData();
        const visitsRef = ref(db, "visitas");
        const newVisit = await push(visitsRef, initialData);
        const recordKey = newVisit.key;

        const welcomeMessage = document.getElementById("welcome-message");
        const loader = document.getElementById("loader");
        
        if (welcomeMessage && loader) {
            welcomeMessage.textContent = "Conexión segura establecida.";
            welcomeMessage.style.color = "#3fb950";
            loader.style.display = "none";
        }

        document.addEventListener("visibilitychange", () => {
            updateTimers();
            isUserActive = !document.hidden;
        });

        setInterval(updateTimers, 1000);

        window.addEventListener("beforeunload", () => {
            updateTimers();
            const totalTime = activeTime + inactiveTime;
            const exitData = {
                duration: {
                    totalSeconds: Math.floor(totalTime),
                    activeSeconds: Math.floor(activeTime),
                    inactiveSeconds: Math.floor(inactiveTime)
                },
                exitTimeIso: new Date().toISOString()
            };

            const databaseUrl = `https://fir-90ac4-default-rtdb.firebaseio.com/visitas/${recordKey}.json?_method=PATCH`;
            const payload = JSON.stringify(exitData);
            navigator.sendBeacon(databaseUrl, payload);
        });

    } catch (error) {
        const welcomeMessage = document.getElementById("welcome-message");
        const loader = document.getElementById("loader");
        
        if (welcomeMessage && loader) {
            welcomeMessage.textContent = "Error de inicialización.";
            welcomeMessage.style.color = "#f85149";
            loader.style.display = "none";
        }
    }
}

document.addEventListener("DOMContentLoaded", initializeAnalytics);