// ========== VEX IQ BLE SNIFFER HOOK ==========
// Intercepts services, characteristics, reads, writes, notifications.
console.log("%c[BLE Hook] Installing...", "color:#0f0; font-weight:bold");

const origRequestDevice =
    navigator.bluetooth.requestDevice.bind(navigator.bluetooth);

navigator.bluetooth.requestDevice = async function (options) {
    console.log("%c[BLE Hook] requestDevice options:", "color:#0af", options);

    const device = await origRequestDevice(options);
    console.log("%c[BLE Hook] Device selected:", "color:#0af", device);

    if (!device.gatt) return device;

    const origConnect = device.gatt.connect.bind(device.gatt);

    device.gatt.connect = async function () {
        console.log("%c[BLE Hook] gatt.connect()", "color:#0f0");

        const server = await origConnect();
        console.log("%c[BLE Hook] GATT connected:", "color:#0f0", server);

        // -------------------------
        // Hook getPrimaryService
        // -------------------------
        const origGetPrimaryService =
            server.getPrimaryService.bind(server);

        server.getPrimaryService = async function (serviceUUID) {
            console.log("%c[BLE Hook] getPrimaryService:", "color:#fa0", serviceUUID);

            const service = await origGetPrimaryService(serviceUUID);

            hookService(service);
            return service;
        };

        // -------------------------
        // Hook getPrimaryServices
        // -------------------------
        const origGetPrimaryServices =
            server.getPrimaryServices.bind(server);

        server.getPrimaryServices = async function () {
            console.log("%c[BLE Hook] getPrimaryServices()", "color:#fa0");

            const services = await origGetPrimaryServices();
            console.log("%c[BLE Hook] → returned services:", "color:#fa0", services);

            for (const s of services) hookService(s);
            return services;
        };

        return server;
    };

    return device;
};

// =======================================================
// SERVICE HOOKING: wrap getCharacteristic & getCharacteristics
// =======================================================
function hookService(service) {
    if (service._bleSnifferHooked) return;
    service._bleSnifferHooked = true;

    console.log("%c[BLE Hook] Hooking service:", "color:#0ff", service.uuid);

    const origGetCharacteristic = service.getCharacteristic.bind(service);
    service.getCharacteristic = async function (charUUID) {
        console.log("%c[BLE Hook]   getCharacteristic:", "color:#0ff", charUUID);

        const characteristic = await origGetCharacteristic(charUUID);

        hookCharacteristic(characteristic);
        return characteristic;
    };

    const origGetCharacteristics = service.getCharacteristics?.bind(service);
    if (origGetCharacteristics) {
        service.getCharacteristics = async function () {
            console.log("%c[BLE Hook]   getCharacteristics()", "color:#0ff");
            const chars = await origGetCharacteristics();
            for (const c of chars) hookCharacteristic(c);
            return chars;
        };
    }
}

// =======================================================
// CHARACTERISTIC HOOKING
// =======================================================
function hookCharacteristic(char) {
    if (char._bleSnifferHooked) return;
    char._bleSnifferHooked = true;

    console.log(
        "%c[BLE Hook]     Hooking characteristic:",
        "color:#f0f",
        char.uuid
    );

    // ---- readValue ----
    const origReadValue = char.readValue?.bind(char);
    if (origReadValue) {
        char.readValue = async function () {
            console.log("%c[BLE Hook]     readValue:", "color:#f0f", char.uuid);

            const v = await origReadValue();
            logData("[READ]", v);
            return v;
        };
    }

    // ---- writeValue ----
    const origWriteValue = char.writeValue?.bind(char);
    if (origWriteValue) {
        char.writeValue = async function (value) {
            console.log("%c[BLE Hook]     writeValue:", "color:#f0f", char.uuid);

            logData("[WRITE]", value);
            return origWriteValue(value);
        };
    }

    // ---- writeValueWithoutResponse ----
    const origWriteNoResp = char.writeValueWithoutResponse?.bind(char);
    if (origWriteNoResp) {
        char.writeValueWithoutResponse = async function (value) {
            console.log("%c[BLE Hook]     writeValueWithoutResponse:",
                "color:#f0f", char.uuid);

            logData("[WRITE_NR]", value);
            return origWriteNoResp(value);
        };
    }

    // ---- startNotifications ----
    const origStartNotif = char.startNotifications?.bind(char);
    if (origStartNotif) {
        char.startNotifications = async function () {
            console.log("%c[BLE Hook]     startNotifications:", "color:#f0f", char.uuid);

            const result = await origStartNotif();

            char.addEventListener("characteristicvaluechanged", evt => {
                const dv = evt.target.value;
                logData(`[NOTIFY: ${char.uuid}]`, dv);
            });

            return result;
        };
    }
}

// =======================================================
// Utility: pretty-print bytes and ASCII
// =======================================================
function logData(prefix, val) {
    if (!val) return;

    let bytes = [];
    let ascii = "";

    if (val instanceof DataView) {
        for (let i = 0; i < val.byteLength; i++) {
            const b = val.getUint8(i);
            bytes.push(b.toString(16).padStart(2, "0"));
            ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : ".";
        }
    } else if (val instanceof Uint8Array) {
        for (const b of val) {
            bytes.push(b.toString(16).padStart(2, "0"));
            ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : ".";
        }
    } else {
        console.log(prefix, "[unknown type]", val);
        return;
    }

    console.log(
        `%c${prefix} bytes: [${bytes.join(" ")}]  ascii:"${ascii}"`,
        "color:#ccc;font-family:monospace"
    );
}

console.log("%c[BLE Hook ready]", "color:#0f0; font-weight:bold");
