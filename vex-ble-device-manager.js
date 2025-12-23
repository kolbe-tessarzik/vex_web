var LoggerLevels;
(function (LoggerLevels) {
    LoggerLevels[LoggerLevels["TRACE"] = 0] = "TRACE";
    LoggerLevels[LoggerLevels["DEBUG"] = 1] = "DEBUG";
    LoggerLevels[LoggerLevels["INFO"] = 2] = "INFO";
    LoggerLevels[LoggerLevels["WARN"] = 3] = "WARN";
    LoggerLevels[LoggerLevels["ERROR"] = 4] = "ERROR";
    LoggerLevels[LoggerLevels["SILENT"] = 5] = "SILENT";
})(LoggerLevels || (LoggerLevels = {}));

// based on loglevel - https://github.com/pimterry/loglevel
// Slightly dubious tricks to cut down minimized file size
// tslint:disable:no-empty
function noop() { }
// tslint:enable:no-empty
const undefinedType = "undefined";
const logMethods = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
];
//#region helpers
// Cross-browser bind equivalent that works at least back to IE6
function bindMethod(obj, methodName) {
    const method = obj[methodName];
    if (typeof method.bind === "function") {
        return method.bind(obj);
    }
    else {
        return Function.prototype.bind.call(method, obj);
    }
}
// Build the best logging method possible for this env
// Wherever possible we want to bind, not wrap, to preserve stack traces
function realMethod(methodName) {
    if (methodName === "debug") {
        methodName = "log";
    }
    if (typeof console === undefinedType) {
        return false; // No method possible, for now - fixed later by enableLoggingWhenConsoleArrives
    }
    else if (console[methodName] !== undefined) {
        return bindMethod(console, methodName);
    }
    else if (console.log !== undefined) {
        return bindMethod(console, "log");
    }
    else {
        return noop;
    }
}
//#endregion helpers
//#region prefix
function levelFormatter(level) {
    return (level.toUpperCase() + "     ").slice(0, 5);
}
function nameFormatter(name) {
    return name || "root";
}
function timestampFormater(date) {
    return date.toISOString();
}
function prefixFormatter(template, level, name, timestamp) {
    template = template.replace(/%t/, timestampFormater(timestamp));
    template = template.replace(/%l/, levelFormatter(level));
    template = template.replace(/%n/, nameFormatter(name));
    return template;
}
//#endregion prefix
//#region history
const historyLoggersByName = {};
class HistoryLogger {
    constructor(name, defaultLevel) {
        this.name = name;
        this.defaultLevel = defaultLevel;
        this.levels = LoggerLevels;
        this.lines = [];
        this.loggerList = new Set();
        // Initialize with the right level
        const initialLevel = this.defaultLevel == null ? "INFO" : this.defaultLevel;
        this.setLevel(initialLevel);
        this.maxLines = 1000;
    }
    getName() {
        return this.name;
    }
    getLevel() {
        return this.currentLevel;
    }
    setLevel(level) {
        if (typeof level === "string" && this.levels[level.toUpperCase()] !== undefined) {
            level = this.levels[level.toUpperCase()];
        }
        if (typeof level === "number" && level >= 0 && level <= this.levels.SILENT) {
            this.currentLevel = level;
            // we need to rebuild any loggers that use this as the level change may
            // require updating the internal functions.
            const loggers = this.getLoggers();
            for (let logger of loggers) {
                logger.rebuildLogger();
            }
        }
        else {
            throw new RangeError("setLevel() called with invalid level: " + level);
        }
    }
    enableAll() {
        this.setLevel(this.levels.TRACE);
    }
    disableAll() {
        this.setLevel(this.levels.SILENT);
    }
    getMaxLines() {
        return this.maxLines;
    }
    setMaxLines(maxLines) {
        if (maxLines > 0) {
            this.maxLines = maxLines;
            while (this.lines.length >= this.maxLines) {
                this.lines.shift();
            }
        }
    }
    addToLogHistory(logEntry) {
        if (!logEntry) {
            return;
        }
        try {
            // compose the log output from args
            const output = logEntry.map((x) => {
                if (x === undefined) {
                    return "undefined";
                }
                else if (x === null) {
                    return "null";
                }
                else if (x instanceof Error) {
                    // Errors are also objects, so we need to handle them before the
                    // next check so that we actually get the error in the log...
                    return x.toString();
                }
                else if (typeof x === "object") {
                    return JSON.stringify(x);
                }
                return x.toString();
            }).join(" ");
            // add to log
            if (this.lines.length === this.maxLines) {
                this.lines.shift();
            }
            this.lines.push(output);
        }
        catch (ex) {
            // log.error("error collecting logs", ex);
        }
    }
    getLogHistory() {
        return this.lines;
    }
    getLogHistoryAsString() {
        return this.getLogHistory().join("\n");
    }
    clearLogHistory() {
        this.lines = [];
    }
    addLogger(name) {
        this.loggerList.add(name);
    }
    removeLogger(name) {
        this.loggerList.delete(name);
    }
    getLoggers() {
        const out = [];
        for (let name of this.loggerList) {
            const logger = loggersByName[name];
            if (logger) {
                out.push(logger);
            }
        }
        return out;
    }
}
//#endregion history
// where all the loggers are stored
const loggersByName = {};
class Logger {
    constructor(name, defaultLevel) {
        this.name = name;
        this.defaultLevel = defaultLevel;
        this.levels = LoggerLevels;
        // Initialize with the right level
        let initialLevel = this.defaultLevel == null ? "WARN" : this.defaultLevel;
        this.setLevel(initialLevel);
    }
    /**
     * create a function to log the data
     * @param methodName the name of the "level". this is also used for what the level is in the prefix
     * @param level the limit for the nor
     * @param loggerName the name of the logger. this is used with the prefix logic
     * @returns
     */
    methodFactory(methodName, level, loggerName) {
        const originalMethod = realMethod(methodName);
        const levelNum = LoggerLevels[methodName.toUpperCase()];
        const scope = this;
        return function (...args) {
            const prefix = prefixFormatter('[%t] %l (%n):', methodName.toUpperCase(), loggerName, new Date());
            if (args.length && typeof args[0] === 'string') {
                // concat prefix with first argument to support string substitutions
                args[0] = prefix + ' ' + args[0];
            }
            else {
                args.unshift(prefix);
            }
            if (levelNum >= scope.currentLevel) {
                originalMethod.apply(undefined, args);
            }
            if (scope.historyLogger && levelNum >= scope.historyLogger.getLevel()) {
                scope.historyLogger.addToLogHistory(args);
            }
        };
    }
    getName() {
        return this.name;
    }
    getLevel() {
        return this.currentLevel;
    }
    setLevel(level) {
        if (typeof level === "string" && this.levels[level.toUpperCase()] !== undefined) {
            level = this.levels[level.toUpperCase()];
        }
        if (typeof level === "number" && level >= 0 && level <= this.levels.SILENT) {
            this.currentLevel = level;
            this.replaceLoggingMethods(level, this.name);
            if (typeof console === undefinedType && level < this.levels.SILENT) {
                return "No console available for logging";
            }
        }
        else {
            throw new RangeError("log.setLevel() called with invalid level: " + level);
        }
    }
    enableAll() {
        this.setLevel(this.levels.TRACE);
    }
    disableAll() {
        this.setLevel(this.levels.SILENT);
    }
    getLogger(name) {
        if (typeof name !== "string" || name === "") {
            throw new TypeError("You must supply a name when creating a logger.");
        }
        let namedlogger = loggersByName[name];
        if (!namedlogger) {
            namedlogger = loggersByName[name] = new Logger(name, this.getLevel());
        }
        return namedlogger;
    }
    getLoggers() {
        return loggersByName;
    }
    /**
     * call this to set the fuinctions that are called by the logger. this lets us not do anything if
     * the function would be below the desired log level.
     * @param level the target log level
     * @param loggerName the name of the logger the functions are for
     */
    replaceLoggingMethods(level, loggerName) {
        const historyLevel = this.historyLogger ? this.historyLogger.getLevel() : this.levels.SILENT;
        const minLevel = Math.min(historyLevel, level);
        for (let i = 0; i < logMethods.length; i++) {
            const methodName = logMethods[i];
            const levelname = LoggerLevels[level];
            this[methodName] = (i < minLevel) ?
                noop :
                this.methodFactory(methodName, levelname, loggerName);
        }
        // Define log.log as an alias for log.debug
        this.log = this.debug;
    }
    /**
     * this is for internal use but needs to be public so the HistoryLogger
     * class can access it.
     */
    rebuildLogger() {
        this.replaceLoggingMethods(this.currentLevel, this.name);
    }
    /**
     * will tell this logger to log to a history logger
     * @param name the name of the history logger to use for this logger
     * @returns
     */
    setHistoryLogger(name) {
        if (typeof name !== "string" || name === "") {
            throw new TypeError("You must supply a name when creating a HistoryLogger.");
        }
        if (this.historyLogger) {
            this.historyLogger.removeLogger(this.name);
        }
        this.historyLogger = historyLoggersByName[name];
        if (!this.historyLogger) {
            this.historyLogger = historyLoggersByName[name] = new HistoryLogger(name, this.getLevel());
        }
        this.historyLogger.addLogger(this.name);
        this.rebuildLogger();
        return this.historyLogger;
    }
    /**
     * Will return the current HistoryLogger object for this logger
     * @returns HistoryLogger for the logger
     */
    getHistoryLogger() {
        return this.historyLogger;
    }
    /**
     * tells the logger to stop logging to the configured history logger.
     */
    removehistoryLogger() {
        if (this.historyLogger) {
            this.historyLogger.removeLogger(this.name);
            this.historyLogger = undefined;
            this.rebuildLogger();
        }
    }
    /**
     * gets all the current history logger objects
     * @returns
     */
    getHistoryLoggers() {
        return historyLoggersByName;
    }
    /**
     * will find and return the hitoriy logger with the specified name,
     * or undefined if it does not exist
     */
    getHistoryLoggerByName(name) {
        return historyLoggersByName[name];
    }
}
const logger = new Logger();








class Byte {
    constructor(Value) {
        this.Number = new Uint8Array(1);
        this.Number[0] = Value;
    }
    Get() {
        return this.Number[0];
    }
    Set(newValue) {
        this.Number[0] = newValue;
    }
}
function checkAllIntType(Value) {
    return Value instanceof Int8 || Value instanceof UInt8 || Value instanceof Int16 || Value instanceof UInt16 || Value instanceof Int32 || Value instanceof UInt32;
}
class Int8 {
    constructor(Value) {
        this.Number = new DataView(new ArrayBuffer(1));
        this.Set(Value);
    }
    Get() {
        return this.Number.getInt8(0);
    }
    Set(Value) {
        let initValue = 0;
        if (Value instanceof Int8 || Value instanceof UInt8 || Value instanceof Int16 || Value instanceof UInt16 || Value instanceof Int32 || Value instanceof UInt32) {
            initValue = Value.Get();
        }
        else {
            initValue = Value;
        }
        this.Number.setInt8(0, initValue);
    }
}
class UInt8 {
    constructor(Value) {
        this.Number = new DataView(new ArrayBuffer(1));
        this.Set(Value);
    }
    Get() {
        return this.Number.getUint8(0);
    }
    Set(Value) {
        let initValue = 0;
        if (Value instanceof Int8 || Value instanceof UInt8 || Value instanceof Int16 || Value instanceof UInt16 || Value instanceof Int32 || Value instanceof UInt32) {
            initValue = Value.Get();
        }
        else {
            initValue = Value;
        }
        this.Number.setUint8(0, initValue);
    }
}
class Int32 {
    constructor(Value) {
        this.Number = new DataView(new ArrayBuffer(4));
        this.Set(Value);
    }
    Get() {
        return this.Number.getInt32(0, true);
    }
    Set(Value) {
        let initValue = 0;
        if (Value instanceof Int8 || Value instanceof UInt8 || Value instanceof Int16 || Value instanceof UInt16 || Value instanceof Int32 || Value instanceof UInt32) {
            initValue = Value.Get();
        }
        else {
            initValue = Value;
        }
        this.Number.setInt32(0, initValue, true);
    }
}
class UInt32 {
    constructor(Value) {
        this.Number = new DataView(new ArrayBuffer(4));
        this.Set(Value);
    }
    Get() {
        return this.Number.getUint32(0, true);
    }
    Set(Value) {
        let initValue = 0;
        if (Value instanceof Int8 || Value instanceof UInt8 || Value instanceof Int16 || Value instanceof UInt16 || Value instanceof Int32 || Value instanceof UInt32) {
            initValue = Value.Get();
        }
        else {
            initValue = Value;
        }
        this.Number.setUint32(0, initValue, true);
    }
}
// tslint:disable-next-line: max-classes-per-file
class Int16 {
    constructor(Value) {
        this.Number = new DataView(new ArrayBuffer(2));
        this.Set(Value);
    }
    Get() {
        return this.Number.getInt16(0, true);
    }
    Set(Value) {
        let initValue = 0;
        if (Value instanceof Int8 || Value instanceof UInt8 || Value instanceof Int16 || Value instanceof UInt16 || Value instanceof Int32 || Value instanceof UInt32) {
            initValue = Value.Get();
        }
        else {
            initValue = Value;
        }
        this.Number.setInt16(0, initValue, true);
    }
}
// tslint:disable-next-line: max-classes-per-file
class UInt16 {
    constructor(Value) {
        this.Number = new DataView(new ArrayBuffer(2));
        this.Set(Value);
    }
    Get() {
        return this.Number.getUint16(0, true);
    }
    Set(Value) {
        let initValue = 0;
        if (Value instanceof Int8 || Value instanceof UInt8 || Value instanceof Int16 || Value instanceof UInt16 || Value instanceof Int32 || Value instanceof UInt32) {
            initValue = Value.Get();
        }
        else {
            initValue = Value;
        }
        this.Number.setUint16(0, initValue, true);
    }
}
function uint32ToByteArray(source) {
    const uint32Num = new UInt32(source);
    const byteNum = new Byte(0);
    const byteArr = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
        if (source > 255) {
            uint32Num.Set(source / 256);
            byteNum.Set(source - uint32Num.Get() * 256);
        }
        else {
            byteNum.Set(uint32Num.Get());
            uint32Num.Set(0);
        }
        byteArr[i] = byteNum.Get();
        source = uint32Num.Get();
    }
    return (byteArr);
}
function uint16ToByteArray(source) {
    const dv = new DataView(new ArrayBuffer(2));
    dv.setUint16(0, source, true);
    return new Uint8Array(dv.buffer);
}
function byteArrayToUint32(sourceByteArray) {
    const DV = new DataView(new ArrayBuffer(4));
    DV.setUint8(0, sourceByteArray[0]);
    DV.setUint8(1, sourceByteArray[1]);
    DV.setUint8(2, sourceByteArray[2]);
    DV.setUint8(3, sourceByteArray[3]);
    return DV.getUint32(0, true);
}
function byteArrayToInt32(sourceByteArray) {
    const DV = new DataView(new ArrayBuffer(4));
    DV.setUint8(0, sourceByteArray[0]);
    DV.setUint8(1, sourceByteArray[1]);
    DV.setUint8(2, sourceByteArray[2]);
    DV.setUint8(3, sourceByteArray[3]);
    return DV.getInt32(0, true);
}
function ToUint32(n) {
    return n >>> 0;
}
function uint16(n) {
    return n & 0xFFFF;
}
/** @returns {Boolean} true if system is big endian */
function isBigEndian() {
    const array = new Uint8Array(4);
    const view = new Uint32Array(array.buffer);
    return !((view[0] = 1) & array[0]);
}

const log1 = logger.getLogger("vex-web-ble-device-manager-eventsystem");
log1.setLevel(LoggerLevels.WARN);
log1.setHistoryLogger("vex-web-ble-device-manager");

class EventSystem {
  static eventCallbacks = {
      "VEXBLEBrowser.DeviceInfo": [],
      "VEXBLEBrowser.ConnectionState": [],
      "VEXBLEBrowser.SensorStatus": [],
      "VEXBLEBrowser.PortCommandStatus": [],
      "VEXBLEBrowser.FWUpdateProgress": [],
      "VEXBLEBrowser.FWUpdateComplete": [],
      "VEXBLEBrowser.PortConfig": [],
      "VEXBLEBrowser.UserSettingsStatus": [],
      "VEXBLEBrowser.AckReceived": [],
      "VEXBLEBrowser.RXDataAdmin": [],
      "VEXBLEBrowser.RXDataUser": [],
      "VEXBLEBrowser.EnterLockCode": [],
      "VEXBLEBrowser.AIMRemoteControlBotStatus": [],
      "VEXBLEBrowser.AIMRemoteControlCommandStatus": [],
      "VEXBLEBrowser.AIMRemoteControlAIVisionStatus": [],
      // TODO: the below will become obsolete soon
      "VEXBLEBrowser.ProgramStatus": [],
      "VEXBLEBrowser.BotStatus": [],
      "VEXBLEBrowser.SensorUpdate": [],
      "VEXBLEBrowser.GyroUpdate": [],
      "VEXBLEBrowser.PortUpdate": [],
  };
  static getSubscriberCount(eventName) {
      return EventSystem.eventCallbacks[eventName].length;
  }
  static on(eventName, callback) {
      if (EventSystem.eventCallbacks[eventName].indexOf(callback) >= 0) {
          return;
      }
      EventSystem.eventCallbacks[eventName].push(callback);
  }
  static off(eventName, callback) {
      const i = EventSystem.eventCallbacks[eventName].indexOf(callback);
      if (i < 0) {
          //console.warn("Unknown callback.");
          return;
      }
      EventSystem.eventCallbacks[eventName].splice(i, 1);
  }
  static fireEvent(eventName, ...args) {
      if (EventSystem.eventCallbacks[eventName]) {
          EventSystem.eventCallbacks[eventName].forEach((callback) => {
              callback(...args);
          });
      }
  }
}

function save(name, asset) {
    return new Promise((resolve, reject) => {
        saveToLocalStorage(name, asset)
            .then((result) => {
            resolve(result);
        })
            .catch(() => {
            reject();
        });
    });
}
function load(name, maxAge) {
    return new Promise((resolve, reject) => {
        readFromLocalStorage(name, maxAge)
            .then((asset) => {
            resolve(asset);
        })
            .catch(() => {
            reject();
        });
    });
}
function getResourceFolder() {
    // return "chrome-extension://" + chrome.runtime.id + "/resources/";
    return "resources";
}
function saveToLocalStorage(name, asset) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get('app_prefs', (result) => {
                let prefs = undefined;
                if (result !== undefined && result.app_prefs !== undefined)
                    prefs = JSON.parse(result.app_prefs);
                if (!prefs) {
                    // never set
                    prefs = { app_prefs: {} };
                }
                prefs.app_prefs[name] = asset;
                chrome.storage.local.set({ 'app_prefs': JSON.stringify(prefs) }, () => {
                    if (chrome.runtime.lastError) {
                        console.log('storage: ' + chrome.runtime.lastError.message);
                        resolve(0);
                    }
                    chrome.storage.local.getBytesInUse('app_prefs', (num) => {
                        console.log('storage: ' + num + ' bytes used');
                        resolve(num);
                    });
                });
            });
        }
        catch (e) {
            console.log('storage: not available');
            resolve(undefined);
        }
    });
}
function readFromLocalStorage(name, maxAge) {
    return new Promise((resolve, reject) => {
        try {
            // see if we have vexos object
            chrome.storage.local.get('app_prefs', (result) => {
                let prefs = undefined;
                if (result !== undefined && result.app_prefs !== undefined)
                    prefs = JSON.parse(result.app_prefs);
                if (!prefs) {
                    // never set
                    resolve(undefined);
                    return;
                }
                let obj = prefs.app_prefs[name];
                if (!obj) {
                    // never set
                    resolve(undefined);
                    return;
                }
                resolve(obj);
            });
        }
        catch (e) {
            console.log('storage: not available');
            resolve(undefined);
        }
    });
}

const log2 = logger.getLogger("vex-web-ble-device-manager-prog-utils");
log2.setLevel(LoggerLevels.WARN);
log2.setHistoryLogger("vex-web-ble-device-manager");

class AIMBLECommand {
    constructor() {
        this.cmd_type = new UInt8(0);
        this.cmd_id = new UInt8(0);
        this.active_cmd_uuid = new UInt16(0);
        this.length = new UInt8(0);
        this.thread_id = new UInt8(0);
        this.reserved1 = new UInt8(0);
        this.reserved2 = new UInt8(0);
        this.ble_cmd_payload = [];
    }
    // must update this function if the struct variables are modified!
    toByteArray() {
        const byteArray = [];
        byteArray.push(this.cmd_type);
        byteArray.push(this.cmd_id);
        byteArray.push(new UInt8(this.active_cmd_uuid.Get() & 0xFF));
        byteArray.push(new UInt8(this.active_cmd_uuid.Get() >> 8));
        byteArray.push(this.length);
        byteArray.push(this.thread_id);
        byteArray.push(this.reserved1);
        byteArray.push(this.reserved2);
        byteArray.push(...this.ble_cmd_payload);
        return byteArray;
    }
    toUin8Array() {
        return new Uint8Array(this.toByteArray().map((x) => x.Get()));
    }
}
var AimProgramCommands;
(function (AimProgramCommands) {
    AimProgramCommands[AimProgramCommands["CMD_LIGHT_SET"] = 1] = "CMD_LIGHT_SET";
    AimProgramCommands[AimProgramCommands["CMD_LIGHT_CLEAR_ALL"] = 2] = "CMD_LIGHT_CLEAR_ALL";
    AimProgramCommands[AimProgramCommands["CMD_LIGHT_BATT_CAP"] = 3] = "CMD_LIGHT_BATT_CAP";
    AimProgramCommands[AimProgramCommands["CMD_PLAY_SOUND"] = 4] = "CMD_PLAY_SOUND";
    AimProgramCommands[AimProgramCommands["CMD_PLAY_TONE"] = 5] = "CMD_PLAY_TONE";
    AimProgramCommands[AimProgramCommands["CMD_DRIVE"] = 6] = "CMD_DRIVE";
    AimProgramCommands[AimProgramCommands["CMD_DRIVE_FOR"] = 7] = "CMD_DRIVE_FOR";
    AimProgramCommands[AimProgramCommands["CMD_TURN"] = 8] = "CMD_TURN";
    AimProgramCommands[AimProgramCommands["CMD_TURN_TO"] = 9] = "CMD_TURN_TO";
    AimProgramCommands[AimProgramCommands["CMD_TURN_FOR"] = 10] = "CMD_TURN_FOR";
    AimProgramCommands[AimProgramCommands["CMD_SPIN_WHEELS"] = 11] = "CMD_SPIN_WHEELS";
    AimProgramCommands[AimProgramCommands["CMD_SET_POSE"] = 12] = "CMD_SET_POSE";
    AimProgramCommands[AimProgramCommands["CMD_MOTOR_STOP_ALL"] = 13] = "CMD_MOTOR_STOP_ALL";
    AimProgramCommands[AimProgramCommands["CMD_KICK_SOFT"] = 14] = "CMD_KICK_SOFT";
    AimProgramCommands[AimProgramCommands["CMD_KICK_MEDIUM"] = 15] = "CMD_KICK_MEDIUM";
    AimProgramCommands[AimProgramCommands["CMD_KICK_HARD"] = 16] = "CMD_KICK_HARD";
    AimProgramCommands[AimProgramCommands["CMD_KICK_MFG"] = 17] = "CMD_KICK_MFG";
    AimProgramCommands[AimProgramCommands["CMD_IMU_CAL"] = 18] = "CMD_IMU_CAL";
    AimProgramCommands[AimProgramCommands["CMD_LCD_PRINT_AT"] = 19] = "CMD_LCD_PRINT_AT";
    AimProgramCommands[AimProgramCommands["CMD_PROG_INIT"] = 20] = "CMD_PROG_INIT";
    AimProgramCommands[AimProgramCommands["CMD_LCD_CLEAR_SCREEN"] = 21] = "CMD_LCD_CLEAR_SCREEN";
    AimProgramCommands[AimProgramCommands["CMD_SHOW_EMOJI"] = 22] = "CMD_SHOW_EMOJI";
    AimProgramCommands[AimProgramCommands["CMD_HIDE_EMOJI"] = 23] = "CMD_HIDE_EMOJI";
    AimProgramCommands[AimProgramCommands["CMD_UNKNOWN"] = 24] = "CMD_UNKNOWN";
    AimProgramCommands[AimProgramCommands["CMD_BLE_PROG_START"] = 25] = "CMD_BLE_PROG_START";
    AimProgramCommands[AimProgramCommands["CMD_BLE_PROG_STOP"] = 26] = "CMD_BLE_PROG_STOP";
    AimProgramCommands[AimProgramCommands["CMD_TAG_DETECTION"] = 32] = "CMD_TAG_DETECTION";
    AimProgramCommands[AimProgramCommands["CMD_COLOR_DETECTION"] = 33] = "CMD_COLOR_DETECTION";
    AimProgramCommands[AimProgramCommands["CMD_MODEL_DETECTION"] = 34] = "CMD_MODEL_DETECTION";
    AimProgramCommands[AimProgramCommands["CMD_AIV_RESET"] = 35] = "CMD_AIV_RESET";
    AimProgramCommands[AimProgramCommands["CMD_SET_TAG_FAMILY"] = 36] = "CMD_SET_TAG_FAMILY";
    // CMD_SET_BOT_CONFIG_PRESET = 0x50,
    // CMD_SET_CONTROL_VALUES = 0xA1,
    // CMD_SHUTDOWN = 0xB0,
    AimProgramCommands[AimProgramCommands["CMD_LOCATE"] = 112] = "CMD_LOCATE";
})(AimProgramCommands || (AimProgramCommands = {}));
var ProgramCommands;
(function (ProgramCommands) {
    ProgramCommands[ProgramCommands["CMD_FWD"] = 1] = "CMD_FWD";
    ProgramCommands[ProgramCommands["CMD_FWD_FOR"] = 2] = "CMD_FWD_FOR";
    // CMD_FWD_TO =          0x03  // 0x(FF)Vel(mmps)(unsigned) (FFFF)mm(signed) (FF)CMD ID
    ProgramCommands[ProgramCommands["CMD_FWD_UNTIL"] = 4] = "CMD_FWD_UNTIL";
    ProgramCommands[ProgramCommands["CMD_TURN"] = 17] = "CMD_TURN";
    ProgramCommands[ProgramCommands["CMD_TURN_FOR"] = 18] = "CMD_TURN_FOR";
    ProgramCommands[ProgramCommands["CMD_TURN_TO"] = 19] = "CMD_TURN_TO";
    ProgramCommands[ProgramCommands["CMD_TURN_UNTIL"] = 20] = "CMD_TURN_UNTIL";
    ProgramCommands[ProgramCommands["CMD_TURN_RAND"] = 21] = "CMD_TURN_RAND";
    ProgramCommands[ProgramCommands["CMD_ARM_TILT"] = 22] = "CMD_ARM_TILT";
    ProgramCommands[ProgramCommands["CMD_ARM_TILT_FOR"] = 23] = "CMD_ARM_TILT_FOR";
    ProgramCommands[ProgramCommands["CMD_ARM_TILT_TO"] = 24] = "CMD_ARM_TILT_TO";
    ProgramCommands[ProgramCommands["CMD_STOP_DRIVE"] = 31] = "CMD_STOP_DRIVE";
    ProgramCommands[ProgramCommands["CMD_RESET_POS"] = 33] = "CMD_RESET_POS";
    ProgramCommands[ProgramCommands["CMD_RESET_HEADING"] = 34] = "CMD_RESET_HEADING";
    ProgramCommands[ProgramCommands["CMD_CAL_GYRO"] = 35] = "CMD_CAL_GYRO";
    ProgramCommands[ProgramCommands["CMD_SET_HEADING"] = 49] = "CMD_SET_HEADING";
    ProgramCommands[ProgramCommands["CMD_SET_VELOCITY"] = 50] = "CMD_SET_VELOCITY";
    ProgramCommands[ProgramCommands["CMD_SET_TURNRATE"] = 51] = "CMD_SET_TURNRATE";
    ProgramCommands[ProgramCommands["CMD_SET_TIMEOUT"] = 52] = "CMD_SET_TIMEOUT";
    ProgramCommands[ProgramCommands["CMD_SET_STOPPING"] = 53] = "CMD_SET_STOPPING";
    ProgramCommands[ProgramCommands["CMD_SET_DRIVE_ACC"] = 54] = "CMD_SET_DRIVE_ACC";
    ProgramCommands[ProgramCommands["CMD_SET_DRIVE_SENS"] = 55] = "CMD_SET_DRIVE_SENS";
    ProgramCommands[ProgramCommands["CMD_SOUND"] = 65] = "CMD_SOUND";
    ProgramCommands[ProgramCommands["CMD_SET_VOLUME"] = 66] = "CMD_SET_VOLUME";
    ProgramCommands[ProgramCommands["CMD_LED_COLOR"] = 81] = "CMD_LED_COLOR";
    ProgramCommands[ProgramCommands["CMD_GLOW"] = 82] = "CMD_GLOW";
    ProgramCommands[ProgramCommands["CMD_SET_FLOOR_THRESH"] = 90] = "CMD_SET_FLOOR_THRESH";
    ProgramCommands[ProgramCommands["CMD_SET_FLOOR_LED"] = 91] = "CMD_SET_FLOOR_LED";
    ProgramCommands[ProgramCommands["CMD_ACT"] = 180] = "CMD_ACT";
    // Control
    ProgramCommands[ProgramCommands["CMD_WAIT_UNTIL"] = 96] = "CMD_WAIT_UNTIL";
    ProgramCommands[ProgramCommands["CMD_DELAY"] = 97] = "CMD_DELAY";
    // Start Conditionals
    ProgramCommands[ProgramCommands["CMD_IF_PROX"] = 98] = "CMD_IF_PROX";
    ProgramCommands[ProgramCommands["CMD_IF_COLOR"] = 99] = "CMD_IF_COLOR";
    ProgramCommands[ProgramCommands["CMD_IF_CRASH"] = 100] = "CMD_IF_CRASH";
    ProgramCommands[ProgramCommands["CMD_IF_BUTTON"] = 101] = "CMD_IF_BUTTON";
    ProgramCommands[ProgramCommands["CMD_IF_LIGHT"] = 102] = "CMD_IF_LIGHT";
    ProgramCommands[ProgramCommands["CMD_ELSE"] = 110] = "CMD_ELSE";
    ProgramCommands[ProgramCommands["CMD_ENDIF"] = 111] = "CMD_ENDIF";
    // End Conditionals
    ProgramCommands[ProgramCommands["CMD_P_SPIN"] = 113] = "CMD_P_SPIN";
    ProgramCommands[ProgramCommands["CMD_P_SPIN_FOR"] = 114] = "CMD_P_SPIN_FOR";
    ProgramCommands[ProgramCommands["CMD_P_SPIN_TO"] = 115] = "CMD_P_SPIN_TO";
    ProgramCommands[ProgramCommands["CMD_P_SPIN_TO_A"] = 116] = "CMD_P_SPIN_TO_A";
    ProgramCommands[ProgramCommands["CMD_P_STOP"] = 121] = "CMD_P_STOP";
    ProgramCommands[ProgramCommands["CMD_P_SET_POS"] = 122] = "CMD_P_SET_POS";
    ProgramCommands[ProgramCommands["CMD_P_SET_VEL"] = 123] = "CMD_P_SET_VEL";
    ProgramCommands[ProgramCommands["CMD_P_SET_I_LIMIT"] = 124] = "CMD_P_SET_I_LIMIT";
    ProgramCommands[ProgramCommands["CMD_P_SET_BRAKE"] = 125] = "CMD_P_SET_BRAKE";
    ProgramCommands[ProgramCommands["CMD_P_SET_TIMEOUT"] = 126] = "CMD_P_SET_TIMEOUT";
    ProgramCommands[ProgramCommands["CMD_P_SET_STALL_TO"] = 127] = "CMD_P_SET_STALL_TO";
    ProgramCommands[ProgramCommands["CMD_P_MAG_SET_POWER"] = 129] = "CMD_P_MAG_SET_POWER";
    ProgramCommands[ProgramCommands["CMD_P_DROP"] = 130] = "CMD_P_DROP";
    ProgramCommands[ProgramCommands["CMD_P_BOOST"] = 131] = "CMD_P_BOOST";
    ProgramCommands[ProgramCommands["CMD_P_HOLD"] = 132] = "CMD_P_HOLD";
    ProgramCommands[ProgramCommands["CMD_P_SET_LED"] = 133] = "CMD_P_SET_LED";
    ProgramCommands[ProgramCommands["CMD_GOTO"] = 144] = "CMD_GOTO";
    ProgramCommands[ProgramCommands["CMD_END"] = 145] = "CMD_END";
    ProgramCommands[ProgramCommands["CMD_PAUSE"] = 146] = "CMD_PAUSE";
    // Sensor commmands
    ProgramCommands[ProgramCommands["CMD_SET_SENS_LED"] = 176] = "CMD_SET_SENS_LED";
    ProgramCommands[ProgramCommands["CMD_SET_SENS_PROX"] = 177] = "CMD_SET_SENS_PROX";
    ProgramCommands[ProgramCommands["CMD_NO_COMMAND"] = 255] = "CMD_NO_COMMAND";
})(ProgramCommands || (ProgramCommands = {}));
var ProgramConst;
(function (ProgramConst) {
    ProgramConst[ProgramConst["PROG_CMD_NONE"] = 0] = "PROG_CMD_NONE";
    ProgramConst[ProgramConst["PROG_CMD_STOP"] = 1] = "PROG_CMD_STOP";
    ProgramConst[ProgramConst["PROG_CMD_STEP"] = 2] = "PROG_CMD_STEP";
    ProgramConst[ProgramConst["PROG_CMD_PLAY"] = 3] = "PROG_CMD_PLAY";
    ProgramConst[ProgramConst["PROG_CMD_PAUSE"] = 4] = "PROG_CMD_PAUSE";
    ProgramConst[ProgramConst["PROG_CMD_ADD"] = 16] = "PROG_CMD_ADD";
    ProgramConst[ProgramConst["PROG_CMD_REMOVE"] = 17] = "PROG_CMD_REMOVE";
    ProgramConst[ProgramConst["PROG_CMD_REMOVE_ALL"] = 18] = "PROG_CMD_REMOVE_ALL";
    ProgramConst[ProgramConst["PROG_CMD_ADD_CARD_ID"] = 19] = "PROG_CMD_ADD_CARD_ID";
    ProgramConst[ProgramConst["PROG_CMD_SET_CMD_DELAY"] = 26] = "PROG_CMD_SET_CMD_DELAY";
    ProgramConst[ProgramConst["PROG_CMD_SET_IGNORE_CONN_DROP"] = 27] = "PROG_CMD_SET_IGNORE_CONN_DROP";
    ProgramConst[ProgramConst["PROG_CMD_SET_USER_SETTINGS"] = 28] = "PROG_CMD_SET_USER_SETTINGS";
    ProgramConst[ProgramConst["PROG_CMD_GET_USER_SETTINGS"] = 29] = "PROG_CMD_GET_USER_SETTINGS";
    ProgramConst[ProgramConst["PROG_CMD_EXE_SINGLE"] = 32] = "PROG_CMD_EXE_SINGLE";
    ProgramConst[ProgramConst["PROG_CMD_CLEAR_PORT_EVENTS"] = 33] = "PROG_CMD_CLEAR_PORT_EVENTS";
    ProgramConst[ProgramConst["PROG_CMD_RAW_PWM"] = 48] = "PROG_CMD_RAW_PWM";
    ProgramConst[ProgramConst["PROG_CMD_SET_BOT_NAME"] = 64] = "PROG_CMD_SET_BOT_NAME";
    ProgramConst[ProgramConst["PROG_CMD_SET_BOT_CONFIG_PRESET"] = 80] = "PROG_CMD_SET_BOT_CONFIG_PRESET";
    ProgramConst[ProgramConst["PROG_CMD_SET_PORT_CONFIG"] = 81] = "PROG_CMD_SET_PORT_CONFIG";
    ProgramConst[ProgramConst["PROG_CMD_SET_PROD_TEST_MODE"] = 82] = "PROG_CMD_SET_PROD_TEST_MODE";
    ProgramConst[ProgramConst["PROG_CMD_LOCATE"] = 112] = "PROG_CMD_LOCATE";
    ProgramConst[ProgramConst["PROG_CMD_GET_CONN_INT"] = 144] = "PROG_CMD_GET_CONN_INT";
    ProgramConst[ProgramConst["PROG_CMD_CODER_READ_CARDS"] = 96] = "PROG_CMD_CODER_READ_CARDS";
    ProgramConst[ProgramConst["PROG_CMD_CODER_RUN_LEDS"] = 97] = "PROG_CMD_CODER_RUN_LEDS";
    ProgramConst[ProgramConst["CODER_CMD_CODER_READ_REG"] = 98] = "CODER_CMD_CODER_READ_REG";
    ProgramConst[ProgramConst["CODER_CMD_CODER_WRITE_REG"] = 99] = "CODER_CMD_CODER_WRITE_REG";
    ProgramConst[ProgramConst["PROG_CMD_CODER_SET_STATE"] = 100] = "PROG_CMD_CODER_SET_STATE";
    ProgramConst[ProgramConst["CODER_CMD_SET_USER_SETTINGS"] = 101] = "CODER_CMD_SET_USER_SETTINGS";
    ProgramConst[ProgramConst["CODER_CMD_GET_USER_SETTINGS"] = 102] = "CODER_CMD_GET_USER_SETTINGS";
    ProgramConst[ProgramConst["CODER_CMD_CLEAR_PAIR"] = 105] = "CODER_CMD_CLEAR_PAIR";
    ProgramConst[ProgramConst["PROG_CMD_SET_BUTTON_CMD"] = 160] = "PROG_CMD_SET_BUTTON_CMD";
    ProgramConst[ProgramConst["PROG_CMD_SET_CONTROLL_VALUES"] = 161] = "PROG_CMD_SET_CONTROLL_VALUES";
    ProgramConst[ProgramConst["PROG_CMD_SAVE_CONTROL_CONFIG_CMD"] = 162] = "PROG_CMD_SAVE_CONTROL_CONFIG_CMD";
    ProgramConst[ProgramConst["PROG_CMD_SET_STICK_MODE_CMD"] = 163] = "PROG_CMD_SET_STICK_MODE_CMD";
})(ProgramConst || (ProgramConst = {}));
const CommandStrings = {};
function initCommandString() {
    CommandStrings[ProgramCommands.CMD_FWD] = "Drive";
}
initCommandString();
function getStringForCommandID(CmdID) {
    // TODO: needs to implement this for all the commands
    const name = CommandStrings[CmdID];
    if (name) {
        return name;
    }
    return "Unknown";
}
function scriptLineToCommand(script) {
    let retVal = 0;
    try {
        if (!script) {
            return retVal;
        }
        script = script.trim();
        const parts = script.split(" ") || [];
        if (parts.length === 0) {
            return retVal;
        }
        const command = parts[0].toUpperCase().trim();
        switch (command) {
            case "SET_FLOOR_THRESH": {
                // Description: Set 123 line detction threshold
                // Format SET_FLOOR_THRESH NewThresh
                // NewThresh: 0 < value > 4096
                if (parts.length < 2) {
                    break;
                }
                const colorID = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = (new UInt32(ProgramCommands.CMD_SET_FLOOR_THRESH)).Get();
                retVal += (new UInt32(new UInt32(new UInt16(colorID)).Get() << 8)).Get();
                break;
            }
            case "SET_FLOOR_LED": {
                // Description: Set 123 line detction led on or off
                // Format SET_FLOOR_LED enable
                // enable: != 0 == on
                if (parts.length < 2) {
                    break;
                }
                const colorID = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = (new UInt32(ProgramCommands.CMD_SET_FLOOR_LED)).Get();
                retVal += (new UInt32(new UInt32(new UInt16(colorID)).Get() << 8)).Get();
                break;
            }
            case "ACT": {
                // Description: Have 123 perform an action
                // Format ACT actionID
                // actionID: {NA=0, Happy=1, Sad=2, Crazy=3}
                if (parts.length < 2) {
                    break;
                }
                const act = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = (new UInt32(ProgramCommands.CMD_ACT)).Get();
                retVal += (new UInt32(new UInt32(new UInt16(act)).Get() << 8)).Get();
                break;
            }
            case "SET_RGB": {
                // Description: Set 123 LED RGB
                // Format SET_RGB red green blue
                // red: 0-255
                // green: 0-255
                // blue: 0-255
                if (parts.length < 4) {
                    break;
                }
                const r = (new UInt8(parseInt(parts[1], 10))).Get();
                const g = (new UInt8(parseInt(parts[2], 10))).Get();
                const b = (new UInt8(parseInt(parts[3], 10))).Get();
                retVal = (new UInt32(ProgramCommands.CMD_LED_COLOR)).Get();
                retVal += (new UInt32(new UInt32(new UInt16(b)).Get() << 8)).Get();
                retVal += (new UInt32(new UInt32(new UInt16(g)).Get() << 16)).Get();
                retVal += (new UInt32(new UInt32(new UInt16(r)).Get() << 24)).Get();
                break;
            }
            case "GLOW": {
                // Description: Set 123 LED RGB by color ID
                // Format GLOW Color_ID
                // Color_ID: {off=0, red=1, green=2, blue=3, yellow=4, cyan=5, magenta=6, orange=7, white=8}
                if (parts.length < 2) {
                    break;
                }
                const colorID = (new UInt8(parseInt(parts[1], 10))).Get();
                retVal = (new UInt32(ProgramCommands.CMD_GLOW)).Get();
                retVal += (new UInt32(new UInt32(new UInt16(colorID)).Get() << 8)).Get();
                break;
            }
            case "SET_STOPPING": {
                // Description: Sets brake mode for drivetrain
                // Format "SET_STOPPING newBrakeMode"
                // Port = 0 - 3
                // newBrakeMode = (1 = Brake), (2 = Coast), (3 = Hold)
                let newPos = (new Int16(0)).Get();
                if (parts.length > 1) {
                    newPos = (new Int16(parseInt(parts[1], 10))).Get();
                }
                retVal = (new UInt32(ProgramCommands.CMD_SET_STOPPING)).Get();
                retVal += (new UInt32((new UInt32(newPos)).Get() << 8)).Get();
                break;
            }
            case "SET_ACC": {
                // Description: Sets acceleration profile for drive
                // Format "SET_ACC newAccel"
                // newAccel = 1 -> 4 (faster acceleration -> slower Acceleration)
                let newAcc = (new Int8(0)).Get();
                if (parts.length > 1) {
                    newAcc = (new Int8(parseInt(parts[1], 10))).Get();
                }
                retVal = (new UInt32(ProgramCommands.CMD_SET_DRIVE_ACC)).Get();
                retVal += (new UInt32((new UInt32(newAcc)).Get() << 8)).Get();
                break;
            }
            case "SET_SENS": {
                // Description: Set control drive sensetivity.
                // Format "SET_SENS newSensitivity"
                // newSensitivity = 1 -> 100 (%)
                let newAcc = (new Int8(100)).Get();
                if (parts.length > 1) {
                    newAcc = (new Int8(parseInt(parts[1], 10))).Get();
                }
                retVal = (new UInt32(ProgramCommands.CMD_SET_DRIVE_SENS)).Get();
                retVal += (new UInt32((new UInt32(newAcc)).Get() << 8)).Get();
                break;
            }
            case "SET_VELOCITY": {
                // Description: Sets target velocity of drivetrain
                // Format "SET_VELOCITY newVelocity(optional)"
                // newVelocity = new target velocity in mm(123) or degrees(Go) if blank newVelocity = 0
                let newPos = (new Int16(0)).Get();
                if (parts.length > 1) {
                    newPos = (new Int16(parseInt(parts[1], 10))).Get();
                }
                retVal = (new UInt32(ProgramCommands.CMD_SET_VELOCITY)).Get();
                retVal += (new UInt32((new UInt32(newPos)).Get() << 8)).Get();
                break;
            }
            case "SET_HEADING": {
                // Description: Sets target heading of drivetrain
                // Format "SET_HEADING newHeading(optional)"
                // newHeading = new target heading in degrees if blank newHeading = 0
                let newPos = (new Int16(0)).Get();
                if (parts.length > 1) {
                    newPos = (new Int16(parseInt(parts[1], 10))).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_SET_HEADING).Get();
                retVal += new UInt32(new UInt32(newPos).Get() << 8).Get();
                break;
            }
            case "SET_TIMEOUT": {
                // Description: Sets target drive and turn timeout for the drivetrain
                // Format "SET_TIMEOUT newTimeout(optional)"
                // newTimeout = new command timout in ms(unsigned). 0 == return to default;
                let newTimeout = new UInt32(0).Get();
                if (parts.length > 1) {
                    newTimeout = new UInt32(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_SET_TIMEOUT).Get();
                retVal += new UInt32(new UInt32(newTimeout).Get() << 8).Get();
                break;
            }
            case "SET_TURNRATE": {
                // Description: Sets turn rate of drivetrain
                // Format "SET_TURNRATE newTurnRate(optional)"
                // newTurnRate = new turn rate in degrees per second if blank turnRate = 0
                let newPos = new Int16(0).Get();
                if (parts.length > 1) {
                    newPos = new Int16(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_SET_TURNRATE).Get();
                retVal += new UInt32(new UInt32(newPos).Get() << 8).Get();
                break;
            }
            case "CAL_GYRO": {
                // Description: Calibrates the gyro and blocks until done. Heading will reset to 0
                // Format "CAL_GYRO"
                retVal = new UInt32(ProgramCommands.CMD_CAL_GYRO).Get();
                break;
            }
            case "RESET_HEADING": {
                // Description: Sets the reported heading of the drivetrain
                // Format "RESET_HEADING newHeading(optional)"
                // newHeading = new heading in degrees. If blank newHeading = 0
                let newPos = new Int16(0).Get();
                if (parts.length > 1) {
                    newPos = new Int16(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_RESET_HEADING).Get();
                retVal += new UInt32(new UInt32(newPos).Get() << 8).Get();
                break;
            }
            case "RESET_POS": {
                // Description: Sets the reported position of the drivetrain
                // Format: "RESET_POS newPos(optional)"
                // newPos = new position in mm (123) or degrees (Go)
                let newPos = new Int16(0).Get();
                if (parts.length > 1) {
                    newPos = new Int16(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_RESET_POS).Get();
                retVal += new UInt32(new UInt32(newPos).Get() << 8).Get();
                break;
            }
            case "DELAY": {
                // Description: Pauses script for time
                // Format: DELAY count
                // count = ms to delay
                let delay = new UInt32(0).Get();
                if (parts.length > 1) {
                    delay = new UInt32(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_DELAY).Get();
                retVal += new UInt32(delay << 8).Get();
                break;
            }
            case "WAIT": {
                // Description: Pauses script for time
                // Format: WAIT count
                // count = ms to delay
                let delay = new UInt32(0).Get();
                if (parts.length > 1) {
                    delay = new UInt32(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_DELAY).Get();
                retVal += new UInt32(delay << 8).Get();
                break;
            }
            case "DRIVE_STOP": {
                // Description: Stops all motors on drivetrain
                // Format DRIVE_STOP breakMode(optional)
                // breakMode = vexBreakMode
                let breakMode = new UInt8(0).Get();
                if (parts.length > 1) {
                    breakMode = new UInt8(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_STOP_DRIVE).Get();
                retVal += new UInt32(new UInt32(breakMode).Get() << 8).Get();
                break;
            }
            case "DRIVE": {
                // Description: Start driving at a velocity
                // Format DRIVE vel
                // vel = mm per second (123) or deg per second (Go)
                if (parts.length < 2) {
                    break;
                }
                const vel = (new Int16(parseInt(parts[1], 10))).Get();
                retVal = (new UInt32(ProgramCommands.CMD_FWD)).Get();
                retVal += (new UInt32((vel << 8))).Get();
                break;
            }
            case "DRIVE_FOR": {
                // Description: Drive a distance and stop
                // Format DRIVE_FOR dist vel(optional)
                // dist = mm
                // vel = mm per second (123) or percent (Go)
                if (parts.length < 2) {
                    break;
                }
                const dist = (new Int16(parseInt(parts[1], 10))).Get();
                let vel = (new UInt8(0)).Get();
                if (parts.length > 2) {
                    const testVel = (new Int16(parseInt(parts[2], 10))).Get();
                    if (testVel > 100) {
                        vel = (new UInt8(100)).Get();
                    }
                    else if (testVel < 0) {
                        // error
                        break;
                    }
                    else {
                        vel = (new UInt8(testVel)).Get();
                    }
                }
                retVal = (new UInt32(ProgramCommands.CMD_FWD_FOR)).Get();
                retVal += (new UInt32(new UInt32(new UInt16(dist)).Get() << 8)).Get();
                retVal += (new UInt32(new UInt32(new UInt8(vel)).Get() << 24)).Get();
                break;
            }
            case "DRIVE_UNTIL": {
                // Description: Drive until an event is set
                // Format DRIVE_UNTIL event vel
                // event = 1 = Crash, 2 = Obj Detected, 3 = Btn 1 pressed, 4 = Btn2, 5 = Btn 3, 6 = Btn4
                // vel = mm per second (123) or deg per second (Go)
                if (parts.length < 2) {
                    break;
                }
                const event = new UInt8(parseInt(parts[1], 10)).Get();
                let vel = new Int16(0).Get();
                if (parts.length > 2) {
                    vel = new Int16(parseInt(parts[2], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_FWD_UNTIL).Get();
                retVal += new UInt32(new UInt32(new UInt16(event)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt32(vel)).Get() << 16).Get();
                break;
            }
            case "WAIT_UNTIL": {
                // Description: Block until an event is set
                // Format WAIT_UNTIL event
                // event = 1 = Crash, 2 = Obj Detected, 3 = Btn 1 pressed, 4 = Btn2, 5 = Btn 3, 6 = Btn4
                if (parts.length < 2) {
                    break;
                }
                const event = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_WAIT_UNTIL).Get();
                retVal += new UInt32(new UInt32(new UInt16(event)).Get() << 8).Get();
                break;
            }
            case "TURN_UNTIL": {
                // Description: Drivetrain turn until an event is set
                // Format TURN_UNTIL event turnrate
                // event = 1 = Crash, 2 = Obj Detected, 3 = Btn 1 pressed, 4 = Btn2, 5 = Btn 3, 6 = Btn4
                // turnrate = deg per second
                if (parts.length < 2) {
                    break;
                }
                const event = new UInt8(parseInt(parts[1], 10)).Get();
                let turnrate = new Int16(0).Get();
                if (parts.length > 2) {
                    turnrate = new Int16(parseInt(parts[2], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_TURN_UNTIL).Get();
                retVal += new UInt32(new UInt32(new UInt16(event)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt32(turnrate)).Get() << 16).Get();
                break;
            }
            case "TURN_RANDOM": {
                // Description: Drivetrain turn for a random number of degrees (-360 - 360)
                // Format TURN_RANDOM vel(optional)
                // vel = mm per second (123) or deg per second (Go) (500 max)
                let Vel = new Int16(0).Get();
                if (parts.length > 1) {
                    Vel = new Int16(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_TURN_RAND).Get();
                retVal += new UInt32(new UInt32(new UInt16(Vel)).Get() << 8).Get();
                break;
            }
            case "TURN_FOR": {
                // Description: Drivetrain turn for a number of degrees
                // Format TURN_FOR dist vel
                // dist = degrees (signed absolute)
                // vel = mm per second (123) or percent (Go)
                if (parts.length < 2) {
                    break;
                }
                const dist = new Int16(parseInt(parts[1], 10)).Get();
                let vel = new UInt8(0).Get();
                if (parts.length > 2) {
                    const testVel = new UInt16(parseInt(parts[2], 10)).Get();
                    if (testVel > 100) {
                        vel = new UInt8(100).Get();
                    }
                    else {
                        vel = new UInt8(testVel).Get();
                    }
                }
                retVal = new UInt32(ProgramCommands.CMD_TURN_FOR).Get();
                retVal += new UInt32(new UInt32(new UInt16(dist)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt8(vel)).Get() << 24).Get();
                break;
            }
            case "TURN_TO": {
                // Description: Drivetrain turn to a set absolute heading
                // Format TURN_TO dist vel
                // dist = degrees (signed absolute)
                // vel = mm per second (123) or percent (Go)
                if (parts.length < 2) {
                    break;
                }
                const dist = new Int16(parseInt(parts[1], 10)).Get();
                let vel = new UInt8(0).Get();
                if (parts.length > 2) {
                    const testVel = new UInt16(parseInt(parts[2], 10)).Get();
                    if (testVel > 100) {
                        vel = new UInt8(100).Get();
                    }
                    else {
                        vel = new UInt8(testVel).Get();
                    }
                }
                retVal = new UInt32(ProgramCommands.CMD_TURN_TO).Get();
                retVal += new UInt32(new UInt32(new UInt16(dist)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt8(vel)).Get() << 24).Get();
                break;
            }
            case "TURN": {
                // Description: Drivetrain start turning with velocity
                // Format TURN vel
                // vel = deg per second
                if (parts.length < 2) {
                    break;
                }
                const Vel = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_TURN).Get();
                retVal += new UInt32(new UInt32(new UInt16(Vel)).Get() << 8).Get();
                break;
            }
            case "IF_LIGHT": {
                // Description: Conditional, If light or dark?
                // Format "IF_LIGHT color"
                // value -1 = dark, 1 = light
                if (parts.length < 2) {
                    break;
                }
                const value = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_IF_LIGHT).Get();
                retVal += new UInt32(new UInt32(new UInt16(value)).Get() << 8).Get();
                break;
            }
            case "IF_BUTTON": {
                // Description: Conditional, If button is pressed/released
                // Format "IF_BUTTON button state"
                // button = 1=Up,2=Rt,3=Dn,4=Lt)(Go Button = port)
                // state = 1 = pressed, -1 = released, 0 = either
                if (parts.length < 3) {
                    break;
                }
                const button = new UInt8(parseInt(parts[1], 10)).Get();
                const state = new Int8(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_IF_BUTTON).Get();
                retVal += new UInt32(new UInt32(new UInt16(button)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(state).Get() << 16).Get();
                break;
            }
            case "GOTO": {
                // Description: Jump program counter to command number
                // Format "GOTO line(optional)"
                // line = line number to go to (0 based)
                let line = new UInt8(0).Get();
                if (parts.length > 1 && parts[1] !== "") {
                    line = new UInt8(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_GOTO).Get();
                retVal += new UInt32(new UInt32(new UInt16(line)).Get() << 8).Get();
                break;
            }
            case "IF_CRASH": {
                // Description: Conditional, If crash detected?
                // Format "IF_CRASH"
                retVal = new UInt32(ProgramCommands.CMD_IF_CRASH).Get();
                break;
            }
            case "IF_COLOR": {
                // Description: Conditional, If color == (???)
                // Format "IF_COLOR color"
                // color = (Red = 1, Green = 2, Blue = 3, ...)
                if (parts.length < 2) {
                    break;
                }
                const color = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_IF_COLOR).Get();
                retVal += new UInt32(new UInt32(new UInt16(color)).Get() << 8).Get();
                break;
            }
            case "IF_PROX": {
                // Description: Conditional, If proximity value is > < or == value
                // Format "IF_PROX operand value"
                // operand = 0 = "==", -1 = "<", 1 = ">"
                // value = 0 - 255
                if (parts.length < 3) {
                    break;
                }
                const operand = new Int8(parseInt(parts[1], 10)).Get();
                const value = new UInt8(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_IF_PROX).Get();
                retVal += new UInt32(new UInt32(new UInt16(operand)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(value).Get() << 16).Get();
                break;
            }
            case "ELSE": {
                // Description: Conditional, Start of else section
                // Format "ELSE"
                retVal = new UInt32(ProgramCommands.CMD_ELSE).Get();
                break;
            }
            case "END_IF": {
                // Description: Conditional, Ends an if statement.
                // Format "END_IF"
                retVal = new UInt32(ProgramCommands.CMD_ENDIF).Get();
                break;
            }
            case "SET_SWITCH_LED": {
                // Description: Set Go bumper LED power > 0 == Green / < 0 == Red
                // Format "SET_SWITCH_LED port time"
                // Port = 0 - 3
                // power = -100 to 100 % power
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const power = new Int16(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SET_LED).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(power).Get() << 16).Get();
                break;
            }
            case "MAG_HOLD": {
                // Description: Start the magnet holding at power. This had no time limit. You must set hold to 0 to stop.
                // Format "MAG_HOLD port time"
                // Port = 0 - 3
                // power = -100 to 100 % power
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const power = new Int8(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_HOLD).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(power).Get() << 16).Get();
                break;
            }
            case "MAG_BOOST": {
                // Description: Turn mag power on at boost power with timeout
                // Format "MAG_BOOST port time"
                // Port = 0 - 3
                // time = Time in ms
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const time = new UInt16(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_BOOST).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(time).Get() << 16).Get();
                break;
            }
            case "MAG_DROP": {
                // Description: Turn mag power on at -boost power with timeout
                // Format "MAG_DROP port time"
                // Port = 0 - 3
                // time = Time in ms
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const time = new UInt16(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_DROP).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(time).Get() << 16).Get();
                break;
            }
            case "MAG_SET_POWER": {
                // Description: Set mag power to be used when Boost/Drop
                // Format "MAG_SET_POWER port power"
                // Port = 0 - 3
                // power = 0%-100%
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const power = new UInt8(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_MAG_SET_POWER).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(power).Get() << 16).Get();
                break;
            }
            case "SET_I_LIMIT": {
                // Description: Set motor current limit
                // Format "SET_I_LIMIT port ILimit(optional)"
                // Port = 0 - 3
                // ilimit = new current limit in percent
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                let newIlimit = new UInt16(0).Get();
                if (parts.length > 2) {
                    newIlimit = new UInt16(parseInt(parts[2], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_P_SET_I_LIMIT).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newIlimit).Get() << 16).Get();
                break;
            }
            case "SET_MOTOR_TIMEOUT": {
                // Description: Set motor timeout
                // Format "SET_MOTOR_TIMEOUT port timeout"
                // Port = 0 - 3
                // timeout = new timeout in ms. 0 = no timeout. Dft = 5000
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                let newTimeout = new UInt16(0).Get();
                if (parts.length > 2) {
                    newTimeout = new UInt16(parseInt(parts[2], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_P_SET_TIMEOUT).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newTimeout).Get() << 16).Get();
                break;
            }
            case "SET_MOTOR_STALL_TIMEOUT": {
                // Description: Set motor timeout for stalls
                // Format "SET_MOTOR_STALL_TIMEOUT port timeout"
                // Port = 0 - 3
                // timeout = new timeout in ms. 0 = no timeout. Dft = 5000
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                let newTimeout = new UInt16(0).Get();
                if (parts.length > 2) {
                    newTimeout = new UInt16(parseInt(parts[2], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_P_SET_STALL_TO).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newTimeout).Get() << 16).Get();
                break;
            }
            case "SET_MOTOR_POS": {
                // Description: Set motor reported position
                // Format "SET_MOTOR_POS port newPos(optional)"
                // Port = 0 - 3
                // newPos = new position in mm (123) or degrees (Go) (blank = 0)
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                let newPos = new Int32(0).Get();
                if (parts.length > 2) {
                    newPos = new Int32(parseInt(parts[2], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_P_SET_POS).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newPos).Get() << 16).Get();
                break;
            }
            case "SET_MOTOR_VEL": {
                // Description: Set motor target velocity
                // Format "SET_MOTOR_POS port newVelocity"
                // Port = 0 - 3
                // newVelocity = new velocity in mmps (123) or degrees per sec (Go)
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const newVel = new Int16(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SET_VEL).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newVel).Get() << 16).Get();
                break;
            }
            case "SET_MOTOR_BRAKE": {
                // Description: Set motor target velocity
                // Format "SET_MOTOR_BRAKE port newBrakeMode"
                // Port = 0 - 3
                // newBrakeMode = (1 = Brake), (2 = Coast), (3 = Hold)
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const newVel = new Int16(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SET_BRAKE).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newVel).Get() << 16).Get();
                break;
            }
            case "STOP_MOTOR": {
                // Description: Stop motor from spinning
                // Format STOP_MOTOR port breakMode(optional)
                // port = 0 - 3
                // breakMode = vexBreakMode
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                let breakMode = new UInt8(0).Get();
                if (parts.length > 2) {
                    breakMode = new UInt8(parseInt(parts[2], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_P_STOP).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(breakMode).Get() << 16).Get();
                break;
            }
            case "SPIN_TO": {
                // Description: Spin motor to position
                // Format SPIN_TO port position
                // port = 0 - 3
                // position(signed) = mm (123) or degrees (Go)
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const pos = new Int16(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN_TO).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(pos)).Get() << 16).Get();
                break;
            }
            case "SPIN_FOR": {
                // Description: Spin motor for a number of degrees
                // Format SPIN_FOR port position
                // port = 0 - 3
                // position(signed) = mm (123) or degrees (Go)
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const pos = new Int16(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN_FOR).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(pos)).Get() << 16).Get();
                break;
            }
            case "SPIN": {
                // Description: Start spinning motor at velocity
                // Format SPIN port vel
                // port = 0 - 3
                // vel(signed) = mm per second (123) or deg per second (Go)
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const vel = new Int16(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(vel)).Get() << 16).Get();
                break;
            }
            case "SPIN_TO_A": {
                // Description: Spin motor to a specific angle
                // Format SPIN_TO_A port angle
                // Port = 0 - 3
                // angle = 0 to 360 (degrees)
                if (parts.length < 3) {
                    break;
                }
                const port = new UInt8(parseInt(parts[1], 10)).Get();
                const pos = new Int16(parseInt(parts[2], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN_TO_A).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(pos)).Get() << 16).Get();
                break;
            }
            case "END": {
                // Discription: Ends the program and stops all motors. Sets program state to Stop
                // Format: END
                retVal = new UInt32(ProgramCommands.CMD_END).Get();
                break;
            }
            case "PAUSE": {
                // Discription: Sets program state to Pause.
                // Format: PAUSE
                retVal = new UInt32(ProgramCommands.CMD_PAUSE).Get();
                break;
            }
            case "SET_ARM_ROTATION": {
                // Discription: Sets arm reported rotation position
                // Format "SET_ARM_ROTATION newPos(optional)"
                // newPos = new position in degrees (Go) (blank = 0)
                const port = new UInt8(0).Get();
                let newPos = new Int16(0).Get();
                if (parts.length > 1) {
                    newPos = new Int16(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_P_SET_POS).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newPos).Get() << 16).Get();
                break;
            }
            case "SET_ARM_ROTATE_VEL": {
                // Discription: Sets arm rotation velocity
                // Format "SET_ARM_ROTATE_VEL newVelocity"
                // newVelocity = new velocity in degrees per sec (Go)
                const port = new UInt8(0).Get();
                const newVel = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SET_VEL).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newVel).Get() << 16).Get();
                break;
            }
            case "ARM_STOP_ROTATE": {
                // Discription: Stops arm from rotating
                // Format ARM_STOP_ROTATE breakMode(optional)
                // breakMode = vexBreakMode
                const port = new UInt8(0).Get();
                let breakMode = new UInt8(0).Get();
                if (parts.length > 1) {
                    breakMode = new UInt8(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_P_STOP).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(breakMode).Get() << 16).Get();
                break;
            }
            case "ARM_ROTATE_TO": {
                // Discription: Rotate Arm to specific heading
                // Format ARM_ROTATE_TO position
                // position(signed) = degrees (Go)
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(0).Get();
                const pos = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN_TO).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(pos)).Get() << 16).Get();
                break;
            }
            case "ARM_ROTATE_FOR": {
                // Discription: Rotate Arm for degrees
                // Format ARM_ROTATE_FOR degs
                // degs(signed) = degrees (Go)
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(0).Get();
                const pos = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN_FOR).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(pos)).Get() << 16).Get();
                break;
            }
            case "ARM_ROTATE": {
                // Discription: Start rotating arm at velocity
                // Format SPIN vel
                // vel(signed) = deg per second (Go)
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(0).Get();
                const vel = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(vel)).Get() << 16).Get();
                break;
            }
            case "ARM_ROTATE_TO_A": {
                // Discription: Rotate are to a specific angle
                // Format ARM_ROTATE_TO_A angle
                // angle = 0 to 360 (degrees)
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(0).Get();
                const pos = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN_TO_A).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(pos)).Get() << 16).Get();
                break;
            }
            case "SET_ARM_TILT": {
                // Discription: Sets arm tilt position
                // Format "SET_ARM_TILT newPos(optional)"
                // newPos = new position in degrees (Go) (blank = 0)
                const port = new UInt8(3).Get();
                let newPos = new Int16(0).Get();
                if (parts.length > 1) {
                    newPos = new Int16(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_P_SET_POS).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newPos).Get() << 16).Get();
                break;
            }
            case "SET_ARM_TILT_VEL": {
                // Discription: Sets arm tilt velocity
                // Format "SET_ARM_TILT_VEL newVelocity"
                // newVelocity = new velocity in degrees per sec (Go)
                const port = new UInt8(3).Get();
                const newVel = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SET_VEL).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(newVel).Get() << 16).Get();
                break;
            }
            case "ARM_STOP_TILT": {
                // Discription: Stops arm from tilting
                // Format ARM_STOP_TILT breakMode(optional)
                // breakMode = vexBreakMode
                const port = new UInt8(3);
                let breakMode = new UInt8(0).Get();
                if (parts.length > 1) {
                    breakMode = new UInt8(parseInt(parts[1], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_P_STOP).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(breakMode).Get() << 16).Get();
                break;
            }
            case "ARM_TILT": {
                // Discription: Start arm tilting
                // Format ARM_TILT vel
                // vel = deg per second
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(3).Get();
                const vel = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(vel)).Get() << 16).Get();
                break;
            }
            case "ARM_TILT_FOR": {
                // Discription: Tilt Arm for degrees
                // Format ARM_TILT_FOR degs
                // degs(signed) = degrees (Go)
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(3).Get();
                const pos = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN_FOR).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(pos)).Get() << 16).Get();
                break;
            }
            case "ARM_TILT_TO": {
                // Discription: Tilt Arm to specific angle + = up
                // Format ARM_TILT_TO angle
                // angle(signed) = degrees (Go)
                if (parts.length < 2) {
                    break;
                }
                const port = new UInt8(3).Get();
                const pos = new Int16(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_P_SPIN_TO).Get();
                retVal += new UInt32(new UInt32(new UInt16(port)).Get() << 8).Get();
                retVal += new UInt32(new UInt32(new UInt16(pos)).Get() << 16).Get();
                break;
            }
            case "PLAY_SOUND": {
                // Description: Play sound file
                // Format "PLAY_SOUND fileID"
                // fileID = 0 - ??
                if (parts.length < 2) {
                    break;
                }
                const fileID = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_SOUND).Get();
                retVal += new UInt32(new UInt32(new UInt16(0x03)).Get() << 24).Get();
                retVal += new UInt32(new UInt32(new UInt16(fileID)).Get() << 16).Get();
                break;
            }
            case "PLAY_MIDI": {
                // Description: Play MIDI file
                // Format "PLAY_MIDI fileID"
                // fileID = 0 - ??
                if (parts.length < 2) {
                    break;
                }
                const fileID = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_SOUND).Get();
                retVal += new UInt32(new UInt32(new UInt16(0x02)).Get() << 24).Get();
                retVal += new UInt32(new UInt32(new UInt16(fileID)).Get() << 16).Get();
                break;
            }
            case "PLAY_TONE": {
                // Description: Play tone
                // Format "PLAY_TONE toneID instrument(optional)"
                // toneID = 0 - ??
                // instrument =  ????
                if (parts.length < 2) {
                    break;
                }
                let instrument = new UInt8(0).Get();
                if (parts.length > 2) {
                    instrument = new UInt8(parseInt(parts[2], 10)).Get();
                }
                retVal = new UInt32(ProgramCommands.CMD_SOUND).Get();
                retVal += new UInt32(new UInt32(new UInt16(0x01)).Get() << 24).Get();
                retVal += new UInt32(new UInt32(instrument).Get() << 16).Get();
                break;
            }
            case "SET_VOLUME": {
                // Discription: Set sound volume (0 - 15)
                // Format SET_VOLUME newVol
                // newVol (0 - 15)
                if (parts.length < 2) {
                    break;
                }
                const vol = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_SET_VOLUME).Get();
                retVal += new UInt32(new UInt32(vol).Get() << 8).Get();
                break;
            }
            case "SET_SENSOR_LED": {
                // Discription: Set brightness of sensor LED
                // Format SET_SENSOR_LED newBrightness
                // newBrightness (0 - 100%)
                if (parts.length < 2) {
                    break;
                }
                const vol = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_SET_SENS_LED).Get();
                retVal += new UInt32(new UInt32(vol).Get() << 8).Get();
                break;
            }
            case "SET_SENSOR_PROX": {
                // Discription: Set proximity sensitivity preset
                // Format SET_SENSOR_PROX newPreset
                // newPreset (0 -  4) 0 = close 4 = far
                if (parts.length < 2) {
                    break;
                }
                const vol = new UInt8(parseInt(parts[1], 10)).Get();
                retVal = new UInt32(ProgramCommands.CMD_SET_SENS_PROX).Get();
                retVal += new UInt32(new UInt32(vol).Get() << 8).Get();
                break;
            }
            //
            default:
                break;
        }
    }
    catch (ex) {
        log2.error("Error during script to command: ", ex);
    }
    return retVal;
}
function scriptLineToCommandAIM(script, uuid) {
    let command = new AIMBLECommand();
    //convert string uuid to uint16 
    command.active_cmd_uuid = new UInt16(uuid);
    try {
        if (!script) {
            return command;
        }
        script = script.trim();
        const parts = script.split(" ") || [];
        if (parts.length === 0) {
            return command;
        }
        const commandStr = parts[0].toUpperCase().trim();
        switch (commandStr) {
            // args: LED_NUM RED GREEN BLUE (LED_NUM == 0 means command applies to ALL LEDs)
            // OR: RED1 GREEN1 BLUE1 RED2 GREEN2 BLUE2 ... RED6 GREEN6 BLUE6
            // For red 25, red 100, green 25, green 100, blue 25, blue 100, do:
            //  CMD_LIGHT_SET 25 00 00 100 00 00 00 25 00 00 100 00 00 00 25 00 00 100
            // to turn all LEDS to WHITE:
            // CMD_LIGHT_SET 0 100 100 100
            case "CMD_LIGHT_SET": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_LIGHT_SET);
                if (parts.length == 5) {
                    let led_num = parseInt(parts[1], 10);
                    let red = parseInt(parts[2], 10);
                    let green = parseInt(parts[3], 10);
                    let blue = parseInt(parts[4], 10);
                    if (isNaN(led_num) || isNaN(red) || isNaN(green) || isNaN(blue)) {
                        break;
                    }
                    for (let led = 1; led <= 6; led++) {
                        if (led === led_num || led_num === 0) {
                            command.ble_cmd_payload.push(new UInt8(red));
                            command.ble_cmd_payload.push(new UInt8(green));
                            command.ble_cmd_payload.push(new UInt8(blue));
                            command.ble_cmd_payload.push(new UInt8(1)); // a 1 means use these rgb values to update the led
                        }
                        else {
                            command.ble_cmd_payload.push(new UInt8(0));
                            command.ble_cmd_payload.push(new UInt8(0));
                            command.ble_cmd_payload.push(new UInt8(0));
                            command.ble_cmd_payload.push(new UInt8(0)); // a 0 means ignore these rgb values and don't update the led
                        }
                    }
                }
                else if (parts.length == 19) {
                    let parsing_error = false;
                    for (let led = 1; led <= 6; led++) {
                        for (let color = 1; color <= 3; color++) {
                            const value = parseInt(parts[(led - 1) * 3 + color], 10);
                            if (isNaN(value)) {
                                parsing_error = true;
                                console.log("error during arg parsing");
                                break;
                            }
                            command.ble_cmd_payload.push(new UInt8(value));
                        }
                        command.ble_cmd_payload.push(new UInt8(1)); // a one means needs updating
                    }
                    if (parsing_error) {
                        break; // invalid command, so success = false
                    }
                }
                else { //if parts.count is not a valid number
                    break;
                }
                break;
            }
            case "CMD_LIGHT_CLEAR_ALL":
                break;
            case "CMD_LIGHT_BATT_CAP":
                break;
            case "CMD_PLAY_SOUND": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_PLAY_SOUND);
                if (parts.length < 3) {
                    break;
                }
                let sound = parseInt(parts[1], 10); //index of sounds from 0 to 18, final sounds TBD
                let volume = parseInt(parts[2], 10);
                command.ble_cmd_payload.push(new UInt8(sound));
                command.ble_cmd_payload.push(new UInt8(volume));
                break;
            }
            // CMD_DRIVE 90 100 drives for 90 degrees at 100 mm/s
            case "CMD_DRIVE": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_DRIVE);
                if (parts.length < 3) {
                    break;
                }
                const drive_angle = parseFloat(parts[1]);
                const drive_speed_mmps = parseFloat(parts[2]);
                if (isNaN(drive_angle) || isNaN(drive_speed_mmps)) {
                    break;
                }
                const angleBytes = new Uint8Array(new Float32Array([drive_angle]).buffer);
                for (let i = 0; i < angleBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(angleBytes[i]));
                }
                const speedBytes = new Uint8Array(new Float32Array([drive_speed_mmps]).buffer);
                for (let i = 0; i < speedBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(speedBytes[i]));
                }
                break;
            }
            // drive for 90 mm at angle 0 and at 100 mm/s: CMD_DRIVE_FOR 90 0 0 100 0    
            case "CMD_DRIVE_FOR": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_DRIVE_FOR);
                if (parts.length < 6) {
                    break;
                }
                const distance = parseFloat(parts[1]);
                const drive_angle = parseFloat(parts[2]);
                const final_heading = parseFloat(parts[3]); // parameter is not used so does nothing
                const drive_speed_mmps = parseFloat(parts[4]);
                const turn_rate_dps = parseFloat(parts[5]); // doesn't really do anything either since final_heading does nothing
                if (isNaN(distance) || isNaN(drive_angle) || isNaN(final_heading) || isNaN(drive_speed_mmps) || isNaN(turn_rate_dps)) {
                    break;
                }
                const distanceBytes = new Uint8Array(new Float32Array([distance]).buffer);
                for (let i = 0; i < distanceBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(distanceBytes[i]));
                }
                const driveAngleBytes = new Uint8Array(new Float32Array([drive_angle]).buffer);
                for (let i = 0; i < driveAngleBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(driveAngleBytes[i]));
                }
                const finalHeadingBytes = new Uint8Array(new Float32Array([final_heading]).buffer);
                for (let i = 0; i < finalHeadingBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(finalHeadingBytes[i]));
                }
                const driveSpeedBytes = new Uint8Array(new Float32Array([drive_speed_mmps]).buffer);
                for (let i = 0; i < driveSpeedBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(driveSpeedBytes[i]));
                }
                const turnRateBytes = new Uint8Array(new Float32Array([turn_rate_dps]).buffer);
                for (let i = 0; i < turnRateBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(turnRateBytes[i]));
                }
                break;
            }
            case "CMD_TURN": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_TURN);
                if (parts.length < 2) {
                    break;
                }
                const turn_rate = parseFloat(parts[1]);
                if (isNaN(turn_rate)) {
                    break;
                }
                const turnRateBytes = new Uint8Array(new Float32Array([turn_rate]).buffer);
                for (let i = 0; i < turnRateBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(turnRateBytes[i]));
                }
                break;
            }
            case "CMD_TURN_TO": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_TURN_TO);
                if (parts.length < 3) {
                    break;
                }
                const heading = parseFloat(parts[1]);
                const turn_rate = parseFloat(parts[2]); // speed, not velocity
                if (isNaN(heading) || isNaN(turn_rate)) {
                    break;
                }
                const headingBytes = new Uint8Array(new Float32Array([heading]).buffer);
                for (let i = 0; i < headingBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(headingBytes[i]));
                }
                const turnRateBytes = new Uint8Array(new Float32Array([turn_rate]).buffer);
                for (let i = 0; i < turnRateBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(turnRateBytes[i]));
                }
                break;
            }
            case "CMD_TURN_FOR": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_TURN_FOR);
                if (parts.length < 3) {
                    break;
                }
                const angle = parseFloat(parts[1]);
                const turn_rate = parseFloat(parts[2]); // speed, not velocity
                if (isNaN(angle) || isNaN(turn_rate)) {
                    break;
                }
                const angleBytes = new Uint8Array(new Float32Array([angle]).buffer);
                for (let i = 0; i < angleBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(angleBytes[i]));
                }
                const turnRateBytes = new Uint8Array(new Float32Array([turn_rate]).buffer);
                for (let i = 0; i < turnRateBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(turnRateBytes[i]));
                }
                break;
            }
            //examples: CMD_SPIN_WHEELS 30 1 30 0 30 0 spins only motor 1 (motors 2 and 3 values are ignored because needs_update = 0)
            // CMD_SPIN_WHEELS 30 1 0 1 0 1 spins motor 1 and stops motors 2 and 3
            case "CMD_SPIN_WHEELS": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_SPIN_WHEELS);
                if (parts.length < 7) {
                    break;
                }
                let parsing_error = false;
                for (let wheel = 1; wheel <= 3; wheel++) {
                    const velocity = parseFloat(parts[(wheel - 1) * 2 + 1]);
                    const needs_update = parseInt(parts[(wheel - 1) * 2 + 2], 10);
                    if (isNaN(velocity) || isNaN(needs_update)) {
                        parsing_error = true;
                        console.log("error during arg parsing");
                        break;
                    }
                    const velocityBytes = new Uint8Array(new Float32Array([velocity]).buffer);
                    for (let i = 0; i < velocityBytes.length; i++) {
                        command.ble_cmd_payload.push(new UInt8(velocityBytes[i]));
                    }
                    command.ble_cmd_payload.push(new UInt8(needs_update !== 0 ? 1 : 0));
                }
                if (parsing_error) {
                    break;
                }
                console.log("command", command);
                break;
            }
            case "CMD_SET_POSE": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_SET_POSE);
                if (parts.length < 3) {
                    break;
                }
                const x = parseFloat(parts[1]);
                const y = parseFloat(parts[2]);
                if (isNaN(x) || isNaN(y)) {
                    break;
                }
                const xBytes = new Uint8Array(new Float32Array([x]).buffer);
                for (let i = 0; i < xBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(xBytes[i]));
                }
                const yBytes = new Uint8Array(new Float32Array([y]).buffer);
                for (let i = 0; i < yBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(yBytes[i]));
                }
                break;
            }
            case "CMD_MOTOR_STOP_ALL": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_MOTOR_STOP_ALL);
                break;
            }
            case "CMD_KICK_SOFT": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_KICK_SOFT);
                break;
            }
            case "CMD_KICK_MEDIUM": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_KICK_MEDIUM);
                break;
            }
            case "CMD_KICK_HARD": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_KICK_HARD);
                break;
            }
            case "CMD_KICK_MFG": {
                log2.error("This app doesn't currently support this command, do we need it?");
                break;
            }
            case "CMD_IMU_CAL": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_IMU_CAL);
                break;
            }
            // must send CMD_BLE_PROG_START first
            //CMD_LCD_PRINT_AT 20 120 1 I am alive!
            case "CMD_LCD_PRINT_AT": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_LCD_PRINT_AT);
                if (parts.length < 4) {
                    break;
                }
                const x = parseInt(parts[1], 10);
                const y = parseInt(parts[2], 10);
                const b_opaque = parseInt(parts[3], 10);
                if (isNaN(x) || isNaN(y) || isNaN(b_opaque)) {
                    break;
                }
                command.ble_cmd_payload.push(new UInt8(x & 0xFF));
                command.ble_cmd_payload.push(new UInt8((x >> 8) & 0xFF));
                command.ble_cmd_payload.push(new UInt8(y & 0xFF));
                command.ble_cmd_payload.push(new UInt8((y >> 8) & 0xFF));
                command.ble_cmd_payload.push(new UInt8(b_opaque !== 0 ? 1 : 0));
                const string_payload = parts.slice(4).join(" ");
                console.log(`string_payload: ${string_payload}`);
                const stringPayloadBytes = new TextEncoder().encode(string_payload);
                for (let i = 0; i < stringPayloadBytes.length; i++) {
                    command.ble_cmd_payload.push(new UInt8(stringPayloadBytes[i]));
                }
                command.length = new UInt8(stringPayloadBytes.length);
                log2.debug("command", command);
                break;
            }
            //CMD_LCD_CLEAR_SCREEN 0 0 0 for BLACK
            case "CMD_LCD_CLEAR_SCREEN": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_LCD_CLEAR_SCREEN);
                if (parts.length < 4) {
                    break;
                }
                const red = parseInt(parts[1], 10);
                const green = parseInt(parts[2], 10);
                const blue = parseInt(parts[3], 10);
                if (isNaN(red) || isNaN(green) || isNaN(blue)) {
                    break;
                }
                // NOTE: switching byte order here!
                command.ble_cmd_payload.push(new UInt8(blue));
                command.ble_cmd_payload.push(new UInt8(green));
                command.ble_cmd_payload.push(new UInt8(red));
                break;
            }
            case "CMD_SHOW_EMOJI": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_SHOW_EMOJI);
                if (parts.length < 3) {
                    break;
                }
                const name = parseInt(parts[1], 10);
                const look = parseInt(parts[2], 10);
                if (isNaN(name) || isNaN(look)) {
                    break;
                }
                command.ble_cmd_payload.push(new UInt8(name));
                command.ble_cmd_payload.push(new UInt8(look));
                break;
            }
            case "CMD_HIDE_EMOJI": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_HIDE_EMOJI);
                break;
            }
            case "CMD_TAG_DETECTION": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_TAG_DETECTION);
                if (parts.length < 2) {
                    break;
                }
                const b_enable = parseInt(parts[1], 10);
                if (isNaN(b_enable)) {
                    break;
                }
                command.ble_cmd_payload.push(new UInt8(b_enable !== 0 ? 1 : 0));
                break;
            }
            case "CMD_COLOR_DETECTION": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_COLOR_DETECTION);
                if (parts.length < 3) {
                    break;
                }
                const b_enable = parseInt(parts[1], 10);
                const b_merge = parseInt(parts[2], 10);
                let flags = 0;
                if (isNaN(b_enable) || isNaN(b_merge)) {
                    break;
                }
                if (b_enable !== 0) {
                    flags |= (1 << 0);
                }
                else {
                    flags |= (0 << 0);
                }
                if (b_merge !== 0) {
                    flags |= (1 << 1);
                }
                else {
                    flags |= (0 << 1);
                }
                command.ble_cmd_payload.push(new UInt8(flags));
                break;
            }
            case "CMD_MODEL_DETECTION": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_MODEL_DETECTION);
                if (parts.length < 2) {
                    break;
                }
                const b_enable = parseInt(parts[1], 10);
                if (isNaN(b_enable)) {
                    break;
                }
                command.ble_cmd_payload.push(new UInt8(b_enable !== 0 ? 1 : 0));
                break;
            }
            case "CMD_AIV_RESET": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_AIV_RESET);
                break;
            }
            case "CMD_SET_TAG_FAMILY": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_SET_TAG_FAMILY);
                if (parts.length < 2) {
                    break;
                }
                const value = parseInt(parts[1], 10);
                if (isNaN(value)) {
                    break;
                }
                command.ble_cmd_payload.push(new UInt8(value));
                break;
            }
            case "CMD_BLE_PROG_START": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_BLE_PROG_START);
                break;
            }
            case "CMD_BLE_PROG_STOP": {
                command.cmd_type = new UInt8(ProgramConst.PROG_CMD_EXE_SINGLE);
                command.cmd_id = new UInt8(AimProgramCommands.CMD_BLE_PROG_STOP);
                break;
            }
            case "BAD_MSG": {
                command.cmd_type = new UInt8(0x98);
                break;
            }
            default:
                break;
        }
    }
    catch (ex) {
        log2.error("Error during script to command: ", ex);
    }
    return command;
}


class VEXDeviceInfo {
    constructor() {
        /// Product ID for this robot
        this.productType = VEXProductTypes.Unknown;
        /// Product type string as read from device
        this.productTypeString = "";
        /// Bootloader version for device
        this.bootVersion = new VEXFirmwareVersion(0, 0, 0, 0);
        /// Firmware version for device
        this.appVersion = new VEXFirmwareVersion(0, 0, 0, 0);
        this.appVersion2 = new VEXFirmwareVersion(0, 0, 0, 0);
        /// This devices unique ID (4 bytes)
        this.deviceID = new Uint8Array(4).fill(0);
        /// This devices current mode
        this.deviceMode = VEXDeviceMode.Unknown;
        this.supportFWUpdate = false;
        this.updateNeeded = false;
        this.bootloaderUpdateNeeded = false;
        this.unlocked = true;
    }
    checkFWUpdateSupported() {
        const lessThanSupportedBootloader = this.bootVersion.isLessThan(new VEXFirmwareVersion(1, 1, 0, 0));
        const isBootloaderWithVersionError = (this.bootVersion.major === 48 && this.bootVersion.minor === 48);
        let isSupported = false;
        if (this.productType != VEXProductTypes.VEXAIM) {
            isSupported = !(lessThanSupportedBootloader || isBootloaderWithVersionError);
            ;
        }
        return isSupported;
    }
}
class VEXBLEDevice {
    constructor(Name, ProductType, VersionMajor, VersionMinor, VersionBuild, VersionBeta, DeviceID, DeviceMode) {
        /// The RSSI for the last advertising packet recived from this robot
        this.lastRSSI = -99;
        /// The current battery percentage if known
        this.batteryPercent = 0;
        this.name = Name;
        this.productType = ProductType;
        this.versionMajor = VersionMajor;
        this.versionMinor = VersionMinor;
        this.versionBuild = VersionBuild;
        this.versionBeta = VersionBeta;
        this.deviceID = DeviceID;
        this.deviceMode = DeviceMode;
        this.discoverTime = new Date();
    }
}


var __awaiter = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};










const log3 = logger.getLogger("vex-web-ble-device-manager");
log3.setLevel(LoggerLevels.WARN);
const historyLogger3 = log3.setHistoryLogger("vex-web-ble-device-manager");
historyLogger3.setLevel(LoggerLevels.DEBUG);
historyLogger3.setMaxLines(2000);

var BrainConnectionState;
(function (BrainConnectionState) {
    BrainConnectionState[BrainConnectionState["Disconnected"] = 0] = "Disconnected";
    BrainConnectionState[BrainConnectionState["Connecting"] = 1] = "Connecting";
    BrainConnectionState[BrainConnectionState["Connected"] = 2] = "Connected";
    BrainConnectionState[BrainConnectionState["Scanning"] = 3] = "Scanning";
    BrainConnectionState[BrainConnectionState["CheckingFirmware"] = 4] = "CheckingFirmware";
    BrainConnectionState[BrainConnectionState["UpdatingFirmware"] = 5] = "UpdatingFirmware";
})(BrainConnectionState || (BrainConnectionState = {}));
var PowerState;
(function (PowerState) {
    PowerState[PowerState["Off"] = 0] = "Off";
    PowerState[PowerState["Reboot"] = 2] = "Reboot";
    PowerState[PowerState["Bootload"] = 1] = "Bootload";
})(PowerState || (PowerState = {}));
/// These are the possible command on boot or after read states
var CoderCommandState;
(function (CoderCommandState) {
    CoderCommandState[CoderCommandState["Nothing"] = 0] = "Nothing";
    CoderCommandState[CoderCommandState["Play"] = 1] = "Play";
    CoderCommandState[CoderCommandState["Pause"] = 2] = "Pause";
})(CoderCommandState || (CoderCommandState = {}));
var BLEServiceID;
(function (BLEServiceID) {
    BLEServiceID["device"] = "0000180a-0000-1000-8000-00805f9b34fb";
    BLEServiceID["Programmer"] = "6faa5911-9200-49a0-a353-6152c5930ec5";
    BLEServiceID["Sensor"] = "6faa6911-9200-49a0-a353-6152c5930ec5";
    BLEServiceID["Coder"] = "6faa7911-9200-49a0-a353-6152c5930ec5";
    BLEServiceID["Reset"] = "0113de02-7a5e-11e8-adc0-fa7ae01bbebc";
    BLEServiceID["OAD"] = "6faaffc0-9200-49a0-a353-6152c5930ec5";
    BLEServiceID["AIMAdmin"] = "08590f7e-db05-467e-8757-72f6faeb13d5";
    BLEServiceID["AIMRemoteControl"] = "6c7851a0-adf7-4de6-881d-1ce2cd0fecd9";
    BLEServiceID["OneStickReset"] = "6faaffd0-9200-49a0-a353-6152c5930ec5";
    BLEServiceID["IQ2Admin"] = "08590f7e-db05-467e-8757-72f6faeb13d5";
    BLEServiceID["EXPAdmin"] = "08590f7e-db05-467e-8757-72f6faeb13d5";
})(BLEServiceID || (BLEServiceID = {}));
var BLECharacteristicsID;
(function (BLECharacteristicsID) {
    //For 123 / GO
    BLECharacteristicsID["ProgramCommand"] = "6faa5920-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["ProgramSensorStatus"] = "6faa5924-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["ProgramPortCmdStatus"] = "6faa5925-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["Reset"] = "0113e104-7a5e-11e8-adc0-fa7ae01bbebc";
    //For 123 / GO / OneStick
    BLECharacteristicsID["OADImageID"] = "6faaffc1-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["OADImageBlock"] = "6faaffc2-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["OADImageCtrl"] = "6faaffc5-9200-49a0-a353-6152c5930ec5";
    //Common
    BLECharacteristicsID["DevInfoSystemID"] = "00002a23-0000-1000-8000-00805f9b34fb";
    BLECharacteristicsID["DevInfoModelNumber"] = "00002a24-0000-1000-8000-00805f9b34fb";
    BLECharacteristicsID["DevInfoSerialNumber"] = "00002a25-0000-1000-8000-00805f9b34fb";
    BLECharacteristicsID["DevInfoFirmware"] = "00002a26-0000-1000-8000-00805f9b34fb";
    BLECharacteristicsID["DevInfoHardwareRev"] = "00002a27-0000-1000-8000-00805f9b34fb";
    BLECharacteristicsID["DevInfoSoftware"] = "00002a28-0000-1000-8000-00805f9b34fb";
    BLECharacteristicsID["DeviceInfoManufacturerName"] = "00002a29-0000-1000-8000-00805f9b34fb";
    BLECharacteristicsID["DevInfoLog"] = "00006a50-0000-1000-8000-00805f9b34fb";
    // TODO: the below will become obsolete soon
    BLECharacteristicsID["ProgramStatus"] = "6faa5921-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["ProgramBotStatus"] = "6faa5922-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["ProgramBotConfig"] = "6faa5923-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["SensorStatusShort"] = "6faa6920-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["SensorGyroDetails"] = "6faa6921-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["SensorGryoCMD"] = "6faa6922-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["SensorRegWrite"] = "6faa6923-9200-49a0-a353-6152c5930ec5";
    BLECharacteristicsID["SensorPortDetails"] = "6faa6925-9200-49a0-a353-6152c5930ec5";
    //AIM Admin Characteristics
    BLECharacteristicsID["AIMTXData"] = "08590f7e-db05-467e-8757-72f6faeb1306";
    BLECharacteristicsID["AIMRXData"] = "08590f7e-db05-467e-8757-72f6faeb13f5";
    BLECharacteristicsID["AIMTXUser"] = "08590f7e-db05-467e-8757-72f6faeb1316";
    BLECharacteristicsID["AIMRXUser"] = "08590f7e-db05-467e-8757-72f6faeb1326";
    BLECharacteristicsID["AIMCode"] = "08590f7e-db05-467e-8757-72f6faeb13e5";
    //VEX AIM
    BLECharacteristicsID["AIMRemoteControlCommand"] = "6c7851a0-adf7-4de6-881d-1ce2cd0fece9";
    BLECharacteristicsID["AIMRemoteControlStatus"] = "6c7851a0-adf7-4de6-881d-1ce2cd0fecf9";
    BLECharacteristicsID["AIMRemoteControlAIStatus"] = "6c7851a0-adf7-4de6-881d-1ce2cd0fecc9";
    //OneStick
    BLECharacteristicsID["OneStickReset"] = "6faaffd1-9200-49a0-a353-6152c5930ec5";
})(BLECharacteristicsID || (BLECharacteristicsID = {}));
var VEXProductTypes;
(function (VEXProductTypes) {
    VEXProductTypes[VEXProductTypes["Unknown"] = 0] = "Unknown";
    VEXProductTypes[VEXProductTypes["VEXIQ2Controller"] = 33] = "VEXIQ2Controller";
    VEXProductTypes[VEXProductTypes["VEXIQ2Brain"] = 32] = "VEXIQ2Brain";
    VEXProductTypes[VEXProductTypes["VEXGO"] = 49] = "VEXGO";
    VEXProductTypes[VEXProductTypes["VEX123Puck"] = 65] = "VEX123Puck";
    VEXProductTypes[VEXProductTypes["VEXCoder"] = 66] = "VEXCoder";
    VEXProductTypes[VEXProductTypes["PilotSmart"] = 74] = "PilotSmart";
    VEXProductTypes[VEXProductTypes["Pilot"] = 75] = "Pilot";
    VEXProductTypes[VEXProductTypes["PilotV2Retail"] = 76] = "PilotV2Retail";
    VEXProductTypes[VEXProductTypes["PilotV2Retail_Smart"] = 77] = "PilotV2Retail_Smart";
    VEXProductTypes[VEXProductTypes["PilotV2Edu"] = 78] = "PilotV2Edu";
    VEXProductTypes[VEXProductTypes["V5_Brain"] = 85] = "V5_Brain";
    VEXProductTypes[VEXProductTypes["VEXAIM"] = 112] = "VEXAIM";
    VEXProductTypes[VEXProductTypes["OneStickController"] = 113] = "OneStickController";
    VEXProductTypes[VEXProductTypes["VEXEXPBrain"] = 96] = "VEXEXPBrain";
    VEXProductTypes[VEXProductTypes["VEXV5Brain"] = 85] = "VEXV5Brain";
})(VEXProductTypes || (VEXProductTypes = {}));
var VEXRobotConfigPreset;
(function (VEXRobotConfigPreset) {
    VEXRobotConfigPreset[VEXRobotConfigPreset["CustomConfig"] = 0] = "CustomConfig";
    VEXRobotConfigPreset[VEXRobotConfigPreset["GOCodeBase"] = 1] = "GOCodeBase";
    VEXRobotConfigPreset[VEXRobotConfigPreset["GOArm"] = 2] = "GOArm";
    VEXRobotConfigPreset[VEXRobotConfigPreset["GOControl"] = 3] = "GOControl";
    VEXRobotConfigPreset[VEXRobotConfigPreset["BOT123"] = 17] = "BOT123";
    VEXRobotConfigPreset[VEXRobotConfigPreset["AutoConfig"] = 250] = "AutoConfig";
    VEXRobotConfigPreset[VEXRobotConfigPreset["NoConfig"] = 255] = "NoConfig";
})(VEXRobotConfigPreset || (VEXRobotConfigPreset = {}));
var VEXDeviceMode;
(function (VEXDeviceMode) {
    // Should not be used
    VEXDeviceMode[VEXDeviceMode["Unknown"] = 0] = "Unknown";
    // This robot is wanting to pair
    VEXDeviceMode[VEXDeviceMode["Pair"] = 160] = "Pair";
    // This robot is ready to connect to its pair
    VEXDeviceMode[VEXDeviceMode["Connect"] = 16] = "Connect";
    // This robot is in bootload mode
    VEXDeviceMode[VEXDeviceMode["Update"] = 32] = "Update";
    // This is a robot in production test mode
    VEXDeviceMode[VEXDeviceMode["ProdTest"] = 240] = "ProdTest";
    // This is a robot in special Identify mode
    VEXDeviceMode[VEXDeviceMode["Identify"] = 176] = "Identify";
})(VEXDeviceMode || (VEXDeviceMode = {}));
/// VEX Button IDs
var VEXButtonValues;
(function (VEXButtonValues) {
    VEXButtonValues[VEXButtonValues["SET_DEFAULT"] = 255] = "SET_DEFAULT";
    VEXButtonValues[VEXButtonValues["F_DOWN"] = 0] = "F_DOWN";
    VEXButtonValues[VEXButtonValues["E_DOWN"] = 1] = "E_DOWN";
    VEXButtonValues[VEXButtonValues["F_UP"] = 2] = "F_UP";
    VEXButtonValues[VEXButtonValues["E_UP"] = 3] = "E_UP";
    VEXButtonValues[VEXButtonValues["L_DOWN"] = 4] = "L_DOWN";
    VEXButtonValues[VEXButtonValues["L_UP"] = 5] = "L_UP";
    VEXButtonValues[VEXButtonValues["R_DOWN"] = 6] = "R_DOWN";
    VEXButtonValues[VEXButtonValues["R_UP"] = 7] = "R_UP";
    VEXButtonValues[VEXButtonValues["L_STICK"] = 8] = "L_STICK";
    VEXButtonValues[VEXButtonValues["R_STICK"] = 9] = "R_STICK";
    VEXButtonValues[VEXButtonValues["POWER"] = 10] = "POWER";
})(VEXButtonValues || (VEXButtonValues = {}));
var VEXDriveStickType;
(function (VEXDriveStickType) {
    VEXDriveStickType[VEXDriveStickType["Tank"] = 1] = "Tank";
    VEXDriveStickType[VEXDriveStickType["Left_Stick"] = 2] = "Left_Stick";
    VEXDriveStickType[VEXDriveStickType["Right_Stick"] = 3] = "Right_Stick";
    VEXDriveStickType[VEXDriveStickType["Split_Stick_Left"] = 4] = "Split_Stick_Left";
    VEXDriveStickType[VEXDriveStickType["Split_Stick_Right"] = 5] = "Split_Stick_Right";
})(VEXDriveStickType || (VEXDriveStickType = {}));
class VEXControllerValues {
    constructor() {
        this.Right1X = 0;
        this.Right1Y = 0;
        this.Left1X = 0;
        this.Left1Y = 0;
        this.Buttons1 = 0;
        this.Right2X = 0;
        this.Right2Y = 0;
        this.Left2X = 0;
        this.Left2Y = 0;
        this.Buttons2 = 0;
        this.Battery1 = 0;
        this.BatteryVolt1 = 0;
        this.Battery2 = 0;
        this.BatteryVolt2 = 0;
        this.ControllerFlags = 0;
        this.GameFlags = 0;
        this.ErrorFlags = 0;
        this.SysStatusFlags = 0;
        this.MatchClock = 0;
        this.ContinuityCount = 0;
        this.LinkMode = 0;
    }
}
var VEXFWUpdateStatus;
(function (VEXFWUpdateStatus) {
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_SUCCESS"] = 0] = "OAD_SUCCESS";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_CRC_ERR"] = 1] = "OAD_CRC_ERR";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_FLASH_ERR"] = 2] = "OAD_FLASH_ERR";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_BUFFER_OFL"] = 3] = "OAD_BUFFER_OFL";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_ALREADY_STARTED"] = 4] = "OAD_ALREADY_STARTED";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_NOT_STARTED"] = 5] = "OAD_NOT_STARTED";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_DL_NOT_COMPLETE"] = 6] = "OAD_DL_NOT_COMPLETE";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_NO_RESOURCES"] = 7] = "OAD_NO_RESOURCES";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_IMAGE_TOO_BIG"] = 8] = "OAD_IMAGE_TOO_BIG";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_INCOMPATIBLE_IMAGE"] = 9] = "OAD_INCOMPATIBLE_IMAGE";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_INVALID_FILE"] = 10] = "OAD_INVALID_FILE";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_ICOMPATIBLE_FILE"] = 11] = "OAD_ICOMPATIBLE_FILE";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_AUTH_FAIL"] = 12] = "OAD_AUTH_FAIL";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_EXT_NOT_SUPPORTED"] = 13] = "OAD_EXT_NOT_SUPPORTED";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_DL_COMPLETE"] = 14] = "OAD_DL_COMPLETE";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_CCCD_NOT_ENABLED"] = 15] = "OAD_CCCD_NOT_ENABLED";
    VEXFWUpdateStatus[VEXFWUpdateStatus["OAD_IM_ID_TIMEOUT"] = 16] = "OAD_IM_ID_TIMEOUT";
    VEXFWUpdateStatus[VEXFWUpdateStatus["ConnectionLost"] = 17] = "ConnectionLost";
    VEXFWUpdateStatus[VEXFWUpdateStatus["BadRF"] = 18] = "BadRF";
    VEXFWUpdateStatus[VEXFWUpdateStatus["FileError"] = 19] = "FileError";
    VEXFWUpdateStatus[VEXFWUpdateStatus["downloadAborted"] = 20] = "downloadAborted";
    VEXFWUpdateStatus[VEXFWUpdateStatus["CommunicationFailure"] = 21] = "CommunicationFailure";
    VEXFWUpdateStatus[VEXFWUpdateStatus["FileNotFound"] = 22] = "FileNotFound";
    VEXFWUpdateStatus[VEXFWUpdateStatus["Success"] = 128] = "Success";
})(VEXFWUpdateStatus || (VEXFWUpdateStatus = {}));
var FWDownloadState;
(function (FWDownloadState) {
    FWDownloadState[FWDownloadState["PaySize"] = 0] = "PaySize";
    FWDownloadState[FWDownloadState["ImgVerify"] = 2] = "ImgVerify";
    FWDownloadState[FWDownloadState["SendBlock"] = 3] = "SendBlock";
    FWDownloadState[FWDownloadState["Done"] = 4] = "Done";
})(FWDownloadState || (FWDownloadState = {}));
class ErrorWriteResponseTimeout extends Error {
    constructor(...params) {
        super(...params);
        this.name = "ErrorWriteResponseTimeout";
    }
}
class ErrorGATT extends Error {
    constructor(...params) {
        super(...params);
        this.name = "ErrorGATT";
    }
}
//OneStick
var OneStickOADState;
(function (OneStickOADState) {
    OneStickOADState[OneStickOADState["OAD_PROFILE_SUCCESS"] = 0] = "OAD_PROFILE_SUCCESS";
    OneStickOADState[OneStickOADState["OAD_PROFILE_VALIDATION_ERR"] = 1] = "OAD_PROFILE_VALIDATION_ERR";
    OneStickOADState[OneStickOADState["OAD_PROFILE_FLASH_ERR"] = 2] = "OAD_PROFILE_FLASH_ERR";
    OneStickOADState[OneStickOADState["OAD_PROFILE_BUFFER_OFL"] = 3] = "OAD_PROFILE_BUFFER_OFL";
    OneStickOADState[OneStickOADState["OAD_PROFILE_ALREADY_STARTED"] = 4] = "OAD_PROFILE_ALREADY_STARTED";
    OneStickOADState[OneStickOADState["OAD_PROFILE_NOT_STARTED"] = 5] = "OAD_PROFILE_NOT_STARTED";
    OneStickOADState[OneStickOADState["OAD_PROFILE_DL_NOT_COMPLETE"] = 6] = "OAD_PROFILE_DL_NOT_COMPLETE";
    OneStickOADState[OneStickOADState["OAD_PROFILE_NO_RESOURCES"] = 7] = "OAD_PROFILE_NO_RESOURCES";
    OneStickOADState[OneStickOADState["OAD_PROFILE_IMAGE_TOO_BIG"] = 8] = "OAD_PROFILE_IMAGE_TOO_BIG";
    OneStickOADState[OneStickOADState["OAD_PROFILE_INCOMPATIBLE_IMAGE"] = 9] = "OAD_PROFILE_INCOMPATIBLE_IMAGE";
    OneStickOADState[OneStickOADState["OAD_PROFILE_INVALID_FILE"] = 10] = "OAD_PROFILE_INVALID_FILE";
    OneStickOADState[OneStickOADState["OAD_PROFILE_INCOMPATIBLE_FILE"] = 11] = "OAD_PROFILE_INCOMPATIBLE_FILE";
    OneStickOADState[OneStickOADState["OAD_PROFILE_AUTH_FAIL"] = 12] = "OAD_PROFILE_AUTH_FAIL";
    OneStickOADState[OneStickOADState["OAD_PROFILE_EXT_NOT_SUPPORTED"] = 13] = "OAD_PROFILE_EXT_NOT_SUPPORTED";
    OneStickOADState[OneStickOADState["OAD_PROFILE_DL_COMPLETE"] = 14] = "OAD_PROFILE_DL_COMPLETE";
    OneStickOADState[OneStickOADState["OAD_PROFILE_CCCD_NOT_ENABLED"] = 15] = "OAD_PROFILE_CCCD_NOT_ENABLED";
    OneStickOADState[OneStickOADState["OAD_PROFILE_IMG_ID_TIMEOUT"] = 16] = "OAD_PROFILE_IMG_ID_TIMEOUT";
    OneStickOADState[OneStickOADState["OAD_PROFILE_APP_STOP_PROCESS"] = 17] = "OAD_PROFILE_APP_STOP_PROCESS";
    OneStickOADState[OneStickOADState["OAD_PROFILE_ERROR"] = 18] = "OAD_PROFILE_ERROR";
    OneStickOADState[OneStickOADState["OAD_EVT_IMG_IDENTIFY_REQ"] = 0] = "OAD_EVT_IMG_IDENTIFY_REQ";
    OneStickOADState[OneStickOADState["OAD_EVT_BLOCK_REQ"] = 1] = "OAD_EVT_BLOCK_REQ";
    OneStickOADState[OneStickOADState["OAD_EVT_TIMEOUT"] = 2] = "OAD_EVT_TIMEOUT";
    OneStickOADState[OneStickOADState["OAD_EVT_START_OAD"] = 3] = "OAD_EVT_START_OAD";
    OneStickOADState[OneStickOADState["OAD_EVT_ENABLE_IMG"] = 4] = "OAD_EVT_ENABLE_IMG";
    OneStickOADState[OneStickOADState["OAD_EVT_CANCEL_OAD"] = 5] = "OAD_EVT_CANCEL_OAD";
    OneStickOADState[OneStickOADState["OAD_REQ_GET_BLK_SZ"] = 1] = "OAD_REQ_GET_BLK_SZ";
    OneStickOADState[OneStickOADState["OAD_REQ_DISABLE_BLK_NOTIF"] = 6] = "OAD_REQ_DISABLE_BLK_NOTIF";
    OneStickOADState[OneStickOADState["OAD_REQ_GET_SW_VER"] = 7] = "OAD_REQ_GET_SW_VER";
    OneStickOADState[OneStickOADState["OAD_REQ_GET_OAD_STAT"] = 8] = "OAD_REQ_GET_OAD_STAT";
    OneStickOADState[OneStickOADState["OAD_RSP_BLK_RSP_NOTIF"] = 18] = "OAD_RSP_BLK_RSP_NOTIF";
    OneStickOADState[OneStickOADState["OAD_REQ_ERASE_BONDS"] = 19] = "OAD_REQ_ERASE_BONDS";
    OneStickOADState[OneStickOADState["OAD_RSP_CMD_NOT_SUPPORTED"] = 255] = "OAD_RSP_CMD_NOT_SUPPORTED";
    OneStickOADState[OneStickOADState["OAD_WRITE_BLOCK_SZ"] = 240] = "OAD_WRITE_BLOCK_SZ";
    OneStickOADState[OneStickOADState["OAD_WRITE_BLOCK_HEAD_SZ"] = 4] = "OAD_WRITE_BLOCK_HEAD_SZ";
})(OneStickOADState || (OneStickOADState = {}));


const __SERVICE_CHAR_MAP = {};
__SERVICE_CHAR_MAP[BLEServiceID.Programmer] = [
    BLECharacteristicsID.ProgramBotConfig,
    BLECharacteristicsID.ProgramBotStatus,
    BLECharacteristicsID.ProgramCommand,
    BLECharacteristicsID.ProgramStatus,
    BLECharacteristicsID.ProgramSensorStatus,
    BLECharacteristicsID.ProgramPortCmdStatus,
];
__SERVICE_CHAR_MAP[BLEServiceID.Reset] = [
    BLECharacteristicsID.Reset,
];
__SERVICE_CHAR_MAP[BLEServiceID.OAD] = [
    BLECharacteristicsID.OADImageID,
    BLECharacteristicsID.OADImageBlock,
    BLECharacteristicsID.OADImageCtrl,
];
__SERVICE_CHAR_MAP[BLEServiceID.device] = [
    BLECharacteristicsID.DevInfoFirmware,
    BLECharacteristicsID.DevInfoModelNumber,
    BLECharacteristicsID.DevInfoSerialNumber,
    BLECharacteristicsID.DevInfoSoftware,
    BLECharacteristicsID.DevInfoSystemID,
    BLECharacteristicsID.DevInfoHardwareRev,
    BLECharacteristicsID.DeviceInfoManufacturerName,
    BLECharacteristicsID.DevInfoLog,
];
__SERVICE_CHAR_MAP[BLEServiceID.Sensor] = [
    BLECharacteristicsID.SensorGryoCMD,
    BLECharacteristicsID.SensorGyroDetails,
    BLECharacteristicsID.SensorPortDetails,
    BLECharacteristicsID.SensorRegWrite,
    BLECharacteristicsID.SensorStatusShort,
];
__SERVICE_CHAR_MAP[BLEServiceID.AIMAdmin] = [
    BLECharacteristicsID.AIMCode,
    BLECharacteristicsID.AIMTXData,
    BLECharacteristicsID.AIMRXData,
    BLECharacteristicsID.AIMTXUser,
    BLECharacteristicsID.AIMRXUser
];
__SERVICE_CHAR_MAP[BLEServiceID.AIMRemoteControl] = [
    BLECharacteristicsID.AIMRemoteControlCommand,
    BLECharacteristicsID.AIMRemoteControlStatus,
    BLECharacteristicsID.AIMRemoteControlAIStatus,
];
__SERVICE_CHAR_MAP[BLEServiceID.OneStickReset] = [
    BLECharacteristicsID.OneStickReset,
];
function getServicesFilter(productType) {
    //GO - 0x0677 123 - 0x0675, Coder -  0x0676,
    let servicesFilter = [0x0677];
    if (productType == VEXProductTypes.VEXGO) {
        servicesFilter = [0x0677];
    }
    else if (productType == VEXProductTypes.VEX123Puck) {
        servicesFilter = [0x0675];
    }
    else if (productType == VEXProductTypes.VEXCoder) {
        servicesFilter = [0x0676];
    }
    else if (productType == VEXProductTypes.VEXAIM) {
        servicesFilter = [0x0670];
    }
    else if (productType == VEXProductTypes.OneStickController) {
        servicesFilter = [0x0671];
    }
    else if (productType == VEXProductTypes.VEXIQ2Brain) {
        servicesFilter = [0x0620];
    }
    else if (productType == VEXProductTypes.VEXEXPBrain) {
        servicesFilter = [0x0660];
    }
    return servicesFilter;
}
function getOptionalServicesFilter(productType) {
    let optionalServicesFilters = [];
    //
    if (productType == VEXProductTypes.VEXGO) {
        optionalServicesFilters = [BLEServiceID.Programmer, BLEServiceID.OAD, BLEServiceID.Reset, BLEServiceID.device, BLEServiceID.Sensor];
    }
    else if (productType == VEXProductTypes.VEX123Puck) {
        optionalServicesFilters = [BLEServiceID.Programmer, BLEServiceID.OAD, BLEServiceID.Reset, BLEServiceID.device, BLEServiceID.Sensor];
    }
    else if (productType == VEXProductTypes.VEXCoder) {
        optionalServicesFilters = [BLEServiceID.Programmer, BLEServiceID.OAD, BLEServiceID.Reset, BLEServiceID.device, BLEServiceID.Sensor];
    }
    else if (productType == VEXProductTypes.VEXAIM) {
        optionalServicesFilters = [BLEServiceID.Programmer, BLEServiceID.OAD, BLEServiceID.Reset, BLEServiceID.device, BLEServiceID.Sensor, BLEServiceID.AIMAdmin, BLEServiceID.AIMRemoteControl];
    }
    else if (productType == VEXProductTypes.OneStickController) {
        optionalServicesFilters = [BLEServiceID.device, BLEServiceID.OAD, BLEServiceID.OneStickReset];
    }
    else if (productType == VEXProductTypes.VEXIQ2Brain) {
        optionalServicesFilters = [BLEServiceID.IQ2Admin, BLEServiceID.device, BLEServiceID.Sensor];
    }
    else if (productType == VEXProductTypes.VEXEXPBrain) {
        optionalServicesFilters = [BLEServiceID.EXPAdmin, BLEServiceID.device, BLEServiceID.Sensor];
    }
    return optionalServicesFilters;
}
function printBuffer(buf, maxLength, prefix) {
    try {
        // Convert BufferSource to Uint8Array to ensure we have a .length property
        const uint8Array = buf instanceof ArrayBuffer ? new Uint8Array(buf) :
            buf instanceof Uint8Array ? buf :
                new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
        if (!maxLength) {
            maxLength = uint8Array.length;
        }
        let str = "";
        for (let i = 0; i < uint8Array.length && i < maxLength; i++) {
            str += ("00" + uint8Array[i].toString(16)).substr(-2, 2) + " ";
        }
        if (maxLength < uint8Array.length) {
            str += " ... ";
        }
        if (prefix) {
            log3.debug(prefix + " : " + str);
        }
        else {
            log3.debug(str);
        }
    }
    catch (error) {
        log3.error("printBuffer: error in printing buffer", error);
        return;
    }
}
/**
 * This is a helper function to write a value to a characteristic. It handles
 * detecting GATT errors and converting them to a single ErrorGATT type to make
 * detecting them at higher levels easier.
 * @param characteristic The characteristic to write to
 * @param value the value to write to the characteristic
 * @returns when the write is complete
 * @throws ErrorGATT if a GATT error occurs
 */
function writeCharacteristicValue(characteristic, value) {
    log3.debug("writing to characteristic:", characteristic.uuid);
    printBuffer(value, 16, "TX");
    return characteristic.writeValue(value)
        .catch((err) => {
        if (err.message.includes("GATT")) {
            log3.debug("Caught a GATT NotSupportedError:", err.message);
            throw new ErrorGATT(err.message);
        }
        throw err;
    });
}
/**
 * This is a helper function to read a value from a characteristic. It handles
 * detecting GATT errors and converting them to a single ErrorGATT type to make
 * detecting them at higher levels easier.
 * @param characteristic The characteristic or descriptor to read from
 * @returns when the read is complete with the value as a DataView
 * @throws ErrorGATT if a GATT error occurs
 */
function readCharacteristicValue(characteristic) {
    return characteristic.readValue()
        .then((rxBuffer) => {
        printBuffer(rxBuffer, 32, "RX");
        return rxBuffer;
    })
        .catch((err) => {
        if (err.name === "NotSupportedError" && err.message.includes("GATT")) {
            log3.debug("Caught a GATT NotSupportedError:", err.message);
            throw new ErrorGATT(err.message);
        }
        throw err;
    });
}
/**
 * This is a helper function to start notifications from a characteristic. It
 * handles detecting GATT errors and converting them to a single ErrorGATT type
 * to make detecting them at higher levels easier.
 * @param characteristic The characteristic to start notifications for
 * @returns A promise that resolves when notifications are started
 */
function startCharacteristicNotifications(characteristic) {
    return characteristic.startNotifications()
        .catch((err) => {
        if (err.message.includes("GATT")) {
            log3.debug("Caught a GATT NotSupportedError:", err.message);
            throw new ErrorGATT(err.message);
        }
        throw err;
    });
}
/**
 * This is a helper function to stop notifications from a characteristic. It handles
 * detecting GATT errors and converting them to a single ErrorGATT type to make
 * detecting them at higher levels easier.
 * @param characteristic The characteristic to stop notifications for
 * @returns A promise that resolves when notifications are stopped
 */
function stopCharacteristicNotifications(characteristic) {
    return characteristic.stopNotifications()
        .catch((err) => {
        if (err.message.includes("GATT")) {
            log3.debug("Caught a GATT NotSupportedError:", err.message);
            throw new ErrorGATT(err.message);
        }
        throw err;
    });
}
class ControlValues {
    constructor() {
        this.leftX = 0;
        this.leftY = 0;
        this.rightX = 0;
        this.rightY = 0;
        this.Buttons1 = 0;
        this.Buttons2 = 0;
    }
}
// declare var navigator: any;
class VEXBLEDeviceManager {
    //
    // TODO: platform will be used to filter devices
    constructor(target) {
        this.connectionState = BrainConnectionState.Disconnected;
        this.device = undefined;
        this.server = undefined;
        this.services = undefined;
        this.characteristics = {};
        this.autoUpdateOnBootLoad = false;
        this.isWaitingToBootload = false;
        this.firmwareType = VEXFirmwareType.Release;
        this.lastPortCommandStatus = undefined;
        this.lastProgramSensorStatus = undefined;
        // TODO: the below will become obsolete soon
        this.lastProgramBotStatus = undefined;
        this.lastProgramStatus = undefined;
        this.lastPortStatus = undefined;
        this.lastPortDetailsList = [new VEXPortDetails(), new VEXPortDetails(), new VEXPortDetails(), new VEXPortDetails()];
        this.lastGyroData = undefined;
        this.lastSensorStatus = undefined;
        //
        this.payloadSize = 0;
        this.downloadState = FWDownloadState.PaySize;
        this.oadLastStatus = 0;
        this.oadNextAddress = 0;
        this.deviceInfo = new VEXDeviceInfo();
        /// Data type representing the Coder user settings
        this.CurrentCoderUserSettings = undefined;
        this.Current123RobotUserSettings = undefined;
        // Subscription control flags
        this.subscribeProgramCommandStatus = false;
        this.subscribeProgramSensorStatus = false;
        this.subscribeProgramPortCommandStatus = false;
        this.subscribeFirmwareUpodateService = false;
        this.subscribeDeiviceInfoHarwareRev = false;
        this.subscribeDeviceLogService = false;
        this.subscribeAdminService = false;
        this.subscribeRemoteControlService = false;
        // TODO: the below will become obsolete soon
        this.subscribeSensor = false;
        this.subscribeGyro = false;
        this.subscribePortDetails = false;
        this.subscribeProgramStatus = false;
        this.subscribeProgramBotStatus = false;
        this.showBrainsInBootload = true;
        this.showAllBLEDevicesNear = false;
        this.isControllerUpdateRunning = false;
        this.controllerUpdateInterval = 0.050;
        //admin / user channel 
        this.rx_buffer = undefined;
        this.ble_rxTimeout = undefined;
        this.cdc = new VexCDC();
        this.lastStatus = VEXBLEDeviceManager.STATUS_GOOD;
        this.OneStickNotifiedData = undefined;
        this.OneStickNotify = false;
        /**
         * Set the name of the brain through Admin channel using CDC commands
         * @param name
         * @returns
         */
        this.SetBrainNameAdmin = (name) => __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected()) {
                return this.WriteDataAsync(this.cdc.V5_Cdc2SysKVSave("robotname", name), { timeout: 1000 })
                    .then(() => __awaiter(this, void 0, void 0, function* () {
                    let newName = yield this.GetBrainNameAdmin();
                    this.deviceInfo.name = newName;
                    EventSystem.fireEvent("VEXBLEBrowser.DeviceInfo", this.deviceInfo);
                    return newName;
                }))
                    .catch((err) => {
                    if (err instanceof ErrorGATT) {
                        throw err;
                    }
                    return undefined;
                });
            }
            else {
                return undefined;
            }
        });
        /**
         * Get the name of the brain through Admin channel using CDC commands
         * @returns {Promise<string>} the name of the brain
         */
        this.GetBrainNameAdmin = () => __awaiter(this, void 0, void 0, function* () {
            try {
                return new Promise((resolve, reject) => {
                    this.WriteDataAsync(this.cdc.V5_Cdc2SysKVRead("robotname"))
                        .then((reply) => {
                        // log3.debug("about to decode reply");
                        let deviceName = this.decodeSysKVRead(reply);
                        log3.debug("this.deviceName:", deviceName);
                        if (!deviceName) {
                            deviceName = "";
                        }
                        resolve(deviceName);
                    })
                        .catch((err) => {
                        if (err instanceof ErrorGATT) {
                            reject(err);
                            return;
                        }
                        // perhaps we don't support this yet
                        resolve(undefined);
                    });
                });
            }
            catch (ex) {
                log3.error("GetBrainNameAdmin: ", ex);
                return undefined;
            }
        });
        this.WriteData = (data, options) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!this.characteristics[BLECharacteristicsID.AIMRXData]) {
                    return;
                }
                let expectedBytes;
                let timeout = 2000;
                if (options !== null && options !== undefined) {
                    if (options.timeout !== undefined) {
                        timeout = options.timeout;
                    }
                    if (options.replyBytes !== undefined) {
                        expectedBytes = options.replyBytes;
                    }
                }
                //TODO: retry on time can be used to attempt writing again later if its an issue
                const timeoutRetry = (options === null || options === void 0 ? void 0 : options.retryOnTimeout) || false;
                const isCDCMessage = data instanceof VexCDCMessage;
                const sendData = isCDCMessage ?
                    data.data :
                    data;
                let rxExpectedBytes = isCDCMessage ? data.replyLength : 0xFFFF;
                let serialRxTimeout = null;
                const writeLowLevel = () => {
                    return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                        let rxBuffer = new ArrayBuffer(0);
                        const onReceiveData = (data) => {
                            rxBuffer = this.appendArrayBuffer(rxBuffer, data);
                            // if expected bytes is 0xFFFF then this is now CDC2 with unknown
                            // reply length and we should set from the receive packet
                            if (rxExpectedBytes == 0xFFFF) {
                                if (rxBuffer && rxBuffer.byteLength > 4) {
                                    // validate header
                                    let buf = new Uint8Array(rxBuffer);
                                    if (this.cdc.validateHeaderAndLength(buf)) {
                                        rxExpectedBytes = this.cdc.cdc2MessageGetReplyPacketLength(buf);
                                    }
                                }
                            }
                            if (rxBuffer.byteLength >= rxExpectedBytes) {
                                this.printBuffer(new Uint8Array(rxBuffer), 32, "RX");
                                clearTimeout(serialRxTimeout);
                                resolve(rxBuffer);
                                //detache callback for receiving data 
                                EventSystem.off("VEXBLEBrowser.RXDataAdmin", onReceiveData);
                            }
                            else {
                                log3.debug("waiting for more response data", rxBuffer.byteLength, rxExpectedBytes);
                            }
                        };
                        this.rx_buffer = new ArrayBuffer(0);
                        this.printBuffer(sendData, 16, "TX");
                        //attach callback for receiving data 
                        EventSystem.on("VEXBLEBrowser.RXDataAdmin", onReceiveData);
                        try {
                            yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMRXData], sendData);
                        }
                        catch (error) {
                            log3.error("writeValue failed with error:", error);
                            // return the error so it can be handled, then return
                            // as there is no point adding a timeout after this
                            // as the data was not sent. We can't expecte a
                            // response if nothing was sent...
                            reject(error);
                            return;
                        }
                        serialRxTimeout = setTimeout(() => {
                            EventSystem.off("VEXBLEBrowser.RXDataAdmin", onReceiveData);
                            reject(new ErrorWriteResponseTimeout());
                            // resolve(undefined);
                            log3.info("write response timeout after", timeout, "ms");
                        }, timeout);
                    }));
                };
                if (timeoutRetry) {
                    try {
                        return yield writeLowLevel();
                    }
                    catch (err) {
                        if (err instanceof ErrorWriteResponseTimeout) {
                            log3.warn("will retry write after response timeout...");
                        }
                        else {
                            log3.info("writeLowLevel 1st try error:", err);
                            throw err;
                        }
                    }
                }
                try {
                    return yield writeLowLevel();
                }
                catch (err) {
                    log3.info("writeLowLevel error:", err);
                    if (err instanceof ErrorWriteResponseTimeout) {
                        return undefined;
                    }
                    else {
                        throw err;
                    }
                }
            }
            catch (ex) {
                log3.debug("writeData error:", ex);
                if (ex instanceof ErrorGATT) {
                    log3.debug("Caught a GATT NotSupportedError:", ex.message);
                    throw new ErrorGATT(ex.message);
                }
            }
        });
        /**
       * Write data to a serial port using Promise
       * @param {ArrayBuffer} data the bytes to send
       * @param {vexcdc_writeOptions} opt_param2 the write data options
       * @return {Promise}
       */
        this.WriteDataAsync = (data, options) => {
            return new Promise((resolve, reject) => {
                this.WriteData(data, options)
                    .then((reply) => {
                    // log3.debug("writeData RX:", buf2hex(reply));
                    // decode simple messages
                    if (reply !== undefined && reply !== null) {
                        var str = this.cdc.decode(reply);
                    }
                    // check for timeouts and disconnect
                    if (this.lastStatus !== VEXBLEDeviceManager.STATUS_GOOD) {
                        reject(reply);
                    }
                    else {
                        resolve(reply);
                    }
                })
                    .catch((error) => {
                    log3.debug("WriteDataAsync:", error);
                    if (error instanceof ErrorGATT) {
                        reject(error);
                    }
                });
            });
        };
        /**
         * Write data to the device's user channel
         * @param data string to send
         * @returns
         */
        this.WriteDataUser = (data) => __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected() && this.characteristics[BLECharacteristicsID.AIMRXUser]) {
                let dataToSend = new TextEncoder().encode(data);
                try {
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMRXUser], dataToSend);
                    return true;
                }
                catch (ex) {
                    yield this.delay(200);
                    log3.debug("sendExecuteSingleCommand: ", ex);
                    log3.debug("sendExecuteSingleCommand: ", "Retry...");
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMRXUser], dataToSend);
                }
            }
        });
        this.updateDeviceInfoOnConnect = () => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.startNotifications();
                yield this.getConnectedDeviceInfo();
                yield this.delay(200);
                this.updateConnectionState(BrainConnectionState.Connected);
                log3.info("connected");
                EventSystem.fireEvent("VEXBLEBrowser.DeviceInfo", this.deviceInfo);
                const deviceFwVersion = this.getDeviceFirmwareVersion();
                const deviceFwVersionStr = (deviceFwVersion) ? deviceFwVersion.getString() : "not available";
                log3.info("Version from device ", deviceFwVersionStr);
                // check if its bootload
                if (this.deviceInfo.deviceMode === VEXDeviceMode.Update && this.autoUpdateOnBootLoad === true) {
                    this.isWaitingToBootload = false;
                    this.autoUpdateOnBootLoad = false;
                    this.updateFirmware();
                }
            }
            catch (ex) {
                log3.error("error during updateDeviceInfoOnConnect : ", ex);
            }
        });
        this.getLockCode = (webble_gatt_uuid, UniqueDeviceID) => __awaiter(this, void 0, void 0, function* () {
            //let dv = await readCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMCode]);
            //let codevalue = dv.getUint32(0);
            //log3.debug('code is ' + this.cdc.hex8(codevalue));
            //show lockcode on the brain
            //await this.ShowLockCodeOnBrain(true);  
            //ask VEXcode to show the LockCode dialog and send the lock code
            EventSystem.fireEvent("VEXBLEBrowser.EnterLockCode", webble_gatt_uuid, UniqueDeviceID);
        });
        this.onDisconnected = () => {
            log3.debug("disconnected");
            this.controllerLoopStop();
            // try auto connecting to the recently connected device
            // Ex: App is not closed but the brain turned off
            this.updateConnectionState(BrainConnectionState.Disconnected);
            this.unSubscribeToCharacteristics();
            this.autoconnect();
        };
        // Notification Handlers
        this.notificationHandlerProgramCommand = (ev) => {
            if (!(ev.target.value)) {
                return;
            }
            const dataView = ev.target.value;
            log3.debug("Ack Received (raw): ", dataView);
            let index = 0;
            while (index < dataView.byteLength) {
                if (dataView.getUint8(index) === 0xAA && ((index + 3) < dataView.byteLength)) {
                    index += 1;
                    const status = dataView.getUint8(index);
                    index += 1;
                    const cmd = dataView.getUint8(index);
                    index += 1;
                    //
                    if (cmd == ProgramConst.PROG_CMD_GET_USER_SETTINGS) {
                        //This will be the user settings data
                        let len = dataView.getUint8(index);
                        index += 1;
                        //Version is next byte
                        //Right now we support Version 1
                        let version = dataView.getUint8(index);
                        if (version == 1) {
                            index += 1;
                            //First byte is sound volume
                            let vol = dataView.getUint8(index);
                            // We skip the next 2 bytes for now
                            index += 3;
                            if (len > 7) {
                                if (this.Current123RobotUserSettings == undefined) {
                                    this.Current123RobotUserSettings = new VEX123RobotUserSettings();
                                }
                                this.Current123RobotUserSettings.IdleTimeout = dataView.getUint32(index, true);
                                this.Current123RobotUserSettings.SoundVolume = vol;
                                log3.debug(`RX 123 User Settings: Timeout: (${this.Current123RobotUserSettings.IdleTimeout}) Volume: (${this.Current123RobotUserSettings.SoundVolume})`);
                                EventSystem.fireEvent("VEXBLEBrowser.UserSettingsStatus", VEXUserSettingsUpdateStatus.SUCCESS);
                            }
                        }
                        else {
                            //clear current user settigns
                            this.Current123RobotUserSettings = undefined;
                            EventSystem.fireEvent("VEXBLEBrowser.UserSettingsStatus", VEXUserSettingsUpdateStatus.PARSE_ERROR);
                        }
                        break;
                    }
                    else if (cmd == ProgramConst.PROG_CMD_EXE_SINGLE) {
                        let data = dataView.getUint8(index);
                        if ((index + 3) < dataView.byteLength) {
                            let goodToGo = true;
                            //On newer version of firmware the acc for exe single contains the full command
                            //But make sure that there are not any other acks in this same packet
                            for (let i = 1; i <= 2; i++) {
                                if (dataView.getUint8(index + i) == 0xAA && dataView.getUint8(index + 1 + i) == 0x76) {
                                    goodToGo = false;
                                }
                            }
                            if (goodToGo) {
                                data = dataView.getUint32(index, true);
                                index += 3;
                            }
                        }
                        else if ((index + 1 < dataView.byteLength) && (index + 1 != 0xAA)) {
                            data = ((dataView.getUint16(index + 1) << 8) + dataView.getUint16(index));
                            index += 1;
                        }
                        log3.debug(`Ack Received (parsed): cmd: ${cmd}, status: ${status} data: ${data}`);
                        EventSystem.fireEvent("VEXBLEBrowser.AckReceived", cmd, status, data);
                    }
                    else {
                        //
                        let data = dataView.getUint8(index);
                        if (((index + 1) < dataView.byteLength) && (index + 1 != 0xAA)) {
                            data = dataView.getUint16(index);
                            index += 1;
                        }
                        log3.debug(`Ack Received (parsed): cmd: ${cmd}, status: ${status} data: ${data}`);
                        EventSystem.fireEvent("VEXBLEBrowser.AckReceived", cmd, status, data);
                    }
                }
                index += 1;
            }
        };
        this.notificationHandlerSensorStatus = (ev) => {
            if (!(ev.target.value)) {
                return;
            }
            const dataView = ev.target.value;
            if (dataView.byteLength >= 18) {
                const status = new VEXProgramSensorStatus();
                status.AccX = dataView.getInt16(0, true);
                status.AccY = dataView.getInt16(2, true);
                status.AccZ = dataView.getInt16(4, true);
                status.GyroX = dataView.getInt16(6, true);
                status.GyroY = dataView.getInt16(8, true);
                status.GyroZ = dataView.getInt16(10, true);
                status.Pitch = new Int16(dataView.getInt8(12) * 1.41).Get();
                status.Roll = new Int16(dataView.getInt8(13) * 1.41).Get();
                status.Yaw = new Int16(dataView.getInt8(14) * 1.41).Get();
                status.Hue = new UInt16(dataView.getUint8(15) * 1.41).Get();
                status.Brightness = dataView.getUint8(16);
                status.Proximity = dataView.getUint8(17);
                if (dataView.byteLength >= 20) {
                    status.Floor = dataView.getInt16(18, true);
                }
                this.lastProgramSensorStatus = status;
                EventSystem.fireEvent("VEXBLEBrowser.SensorStatus", this.lastProgramSensorStatus);
            }
        };
        this.notificationHandlerPortCommandStatus = (ev) => {
            if (!(ev.target.value)) {
                return;
            }
            const dataView = ev.target.value;
            let index = 0;
            while (index < dataView.byteLength) {
                if (dataView.getUint8(index) === 0) {
                    break;
                }
                const portNum = dataView.getUint8(index) & 0x0F;
                const devType = new UInt8(dataView.getUint8(index) & 0xF0).Get();
                if (portNum > 4) {
                    break;
                }
                if (dataView.byteLength <= (index + 2)) {
                    break;
                }
                index += 1;
                const ActiveCommand = dataView.getUint8(index);
                index += 1;
                const len = dataView.getUint8(index);
                index += 1;
                if (this.lastPortCommandStatus === undefined) {
                    this.lastPortCommandStatus = new VEXBotCommandStatus();
                }
                if (devType === VEXPortDeviceID.Motor) {
                    if (dataView.byteLength >= (index + len)) {
                        const status = new VEXPortCommandMotorStatus();
                        status.PortNumber = portNum;
                        status.DeviceID = devType;
                        status.ActiveCommand = ActiveCommand;
                        status.Current = new Int16(dataView.getInt8(index)).Get(); // dataView.getInt16(index, true);
                        index += 1;
                        status.Velocity = new Int16(dataView.getInt8(index)).Get(); // dataView.getInt16(index, true);
                        index += 1;
                        status.Position = dataView.getInt32(index, true);
                        index += 4;
                        status.Flags = dataView.getUint8(index);
                        index += 1;
                        status.ModeBits = dataView.getUint8(index);
                        index += 1;
                        if (this.lastPortCommandStatus.Ports[portNum].UpdateCounter < 255) {
                            status.UpdateCounter = this.lastPortCommandStatus.Ports[portNum].UpdateCounter + 1;
                        }
                        else {
                            status.UpdateCounter = 0;
                        }
                        this.lastPortCommandStatus.Ports[portNum] = status;
                    }
                }
                else if (devType === VEXPortDeviceID.Magnet) {
                    if (dataView.byteLength >= (index + len)) {
                        const status = new VEXPortCommandMagnetStatus();
                        status.PortNumber = portNum;
                        status.DeviceID = devType;
                        status.ActiveCommand = ActiveCommand;
                        status.PWM = dataView.getInt8(index);
                        index += 1;
                        status.Flags = dataView.getUint8(index);
                        index += 1;
                        if (this.lastPortCommandStatus.Ports[portNum].UpdateCounter < 255) {
                            status.UpdateCounter = this.lastPortCommandStatus.Ports[portNum].UpdateCounter + 1;
                        }
                        else {
                            status.UpdateCounter = 0;
                        }
                        this.lastPortCommandStatus.Ports[portNum] = status;
                    }
                }
                else if (devType === VEXPortDeviceID.Bumper) {
                    if (dataView.byteLength >= (index + len)) {
                        const status = new VEXPortCommandBumperStatus();
                        status.PortNumber = portNum;
                        status.DeviceID = devType;
                        status.ActiveCommand = ActiveCommand;
                        status.PWM = dataView.getInt8(index);
                        index += 1;
                        status.State = dataView.getUint8(index);
                        index += 1;
                        status.Flags = dataView.getUint8(index);
                        index += 1;
                        if (this.lastPortCommandStatus.Ports[portNum].UpdateCounter < 255) {
                            status.UpdateCounter = this.lastPortCommandStatus.Ports[portNum].UpdateCounter + 1;
                        }
                        else {
                            status.UpdateCounter = 0;
                        }
                        this.lastPortCommandStatus.Ports[portNum] = status;
                    }
                }
                else if (devType === VEXPortDeviceID.Sound) {
                    if (dataView.byteLength >= (index + len)) {
                        const status = new VEXPortCommandSoundStatus();
                        status.PortNumber = portNum;
                        status.DeviceID = devType;
                        status.ActiveCommand = ActiveCommand;
                        status.SoundType = dataView.getUint8(index);
                        index += 1;
                        status.SoundID = dataView.getUint8(index);
                        index += 1;
                        if (this.lastPortCommandStatus.Ports[portNum].UpdateCounter < 255) {
                            status.UpdateCounter = this.lastPortCommandStatus.Ports[portNum].UpdateCounter + 1;
                        }
                        else {
                            status.UpdateCounter = 0;
                        }
                        this.lastPortCommandStatus.Ports[portNum] = status;
                    }
                }
                else if (devType === VEXPortDeviceID.Drive123) {
                    if (dataView.byteLength >= (index + len)) {
                        const status = new VEXPortCommand123BotStatus();
                        status.PortNumber = portNum;
                        status.DeviceID = devType;
                        status.ActiveCommand = ActiveCommand;
                        this.lastPortCommandStatus.ConfigPreset = VEXRobotConfigPreset.BOT123;
                        this.lastPortCommandStatus.Battery = (dataView.getUint8(index));
                        index += 1;
                        status.Flags = dataView.getUint8(index);
                        index += 1;
                        status.Velocity = new Int16(dataView.getInt8(index)).Get(); // dataView.getInt16(index, true);
                        index += 1;
                        status.Heading = dataView.getInt16(index, true);
                        index += 2;
                        status.Position = dataView.getInt32(index, true);
                        index += 4;
                        status.ButtonState = dataView.getUint8(index);
                        index += 1;
                        status.PressedEvents = dataView.getUint8(index);
                        index += 1;
                        status.ReleasedEvents = dataView.getUint8(index);
                        index += 1;
                        status.ColorIndex = dataView.getUint8(index);
                        index += 1;
                        if (this.lastPortCommandStatus.Ports[portNum].UpdateCounter < 255) {
                            status.UpdateCounter = this.lastPortCommandStatus.Ports[portNum].UpdateCounter + 1;
                        }
                        else {
                            status.UpdateCounter = 0;
                        }
                        this.lastPortCommandStatus.Ports[portNum] = status;
                    }
                }
                else if (devType === VEXPortDeviceID.Motor123) {
                    if (dataView.byteLength >= (index + len)) {
                        const status = new VEXPortCommandMotorStatus();
                        status.PortNumber = portNum;
                        status.DeviceID = devType;
                        status.ActiveCommand = ActiveCommand;
                        this.lastPortCommandStatus.ConfigPreset = VEXRobotConfigPreset.BOT123;
                        status.Velocity = new Int16(dataView.getInt8(index)).Get();
                        index += 1;
                        status.Position = dataView.getInt32(index, true);
                        index += 4;
                        status.Flags = dataView.getUint8(index);
                        index += 1;
                        status.ModeBits = dataView.getUint8(index);
                        index += 1;
                        if (this.lastPortCommandStatus.Ports[portNum].UpdateCounter < 255) {
                            status.UpdateCounter = this.lastPortCommandStatus.Ports[portNum].UpdateCounter + 1;
                        }
                        else {
                            status.UpdateCounter = 0;
                        }
                        this.lastPortCommandStatus.Ports[portNum] = status;
                    }
                }
                else if (devType === VEXPortDeviceID.DriveTrain) {
                    if (len === 10 && (dataView.byteLength >= (index + len))) {
                        const status = new VEXPortCommandDriveStatus();
                        status.PortNumber = portNum;
                        status.DeviceID = devType;
                        status.ActiveCommand = ActiveCommand;
                        this.lastPortCommandStatus.Battery = (dataView.getUint8(index));
                        index += 1;
                        this.lastPortCommandStatus.ConfigPreset = dataView.getUint8(index);
                        index += 1;
                        status.Flags = dataView.getUint8(index);
                        index += 1;
                        status.Velocity = new Int16(dataView.getInt8(index)).Get(); // dataView.getInt16(index, true);
                        index += 1;
                        status.Heading = dataView.getInt16(index, true);
                        index += 2;
                        status.Position = dataView.getInt32(index, true);
                        index += 4;
                        if (this.lastPortCommandStatus.Ports[portNum].UpdateCounter < 255) {
                            status.UpdateCounter = this.lastPortCommandStatus.Ports[portNum].UpdateCounter + 1;
                        }
                        else {
                            status.UpdateCounter = 0;
                        }
                        this.lastPortCommandStatus.Ports[portNum] = status;
                    }
                    else if (len === 5 && (dataView.byteLength >= (index + len))) {
                        const status = new VEXPortCommandDriveStatus();
                        status.PortNumber = portNum;
                        status.DeviceID = devType;
                        status.ActiveCommand = ActiveCommand;
                        this.lastPortCommandStatus.Battery = (dataView.getUint8(index));
                        index += 1;
                        this.lastPortCommandStatus.ConfigPreset = dataView.getUint8(index);
                        index += 1;
                        status.Flags = dataView.getUint8(index);
                        index += 1;
                        status.Heading = dataView.getInt16(index, true); // (Int16(truncatingIfNeeded: value[index + 1]) << 8) + Int16(truncatingIfNeeded: value[index])
                        index += 2;
                        if (this.lastPortCommandStatus.Ports[portNum].UpdateCounter < 255) {
                            status.UpdateCounter = this.lastPortCommandStatus.Ports[portNum].UpdateCounter + 1;
                        }
                        else {
                            status.UpdateCounter = 0;
                        }
                        this.lastPortCommandStatus.Ports[portNum] = status;
                    }
                }
            }
            if (this.lastPortCommandStatus) {
                EventSystem.fireEvent("VEXBLEBrowser.PortCommandStatus", this.lastPortCommandStatus);
            }
        };
        this.notificationHandlerOADImageID = (ev) => __awaiter(this, void 0, void 0, function* () {
            if (this.productType != VEXProductTypes.OneStickController) {
                this.notificationHandlerOADImageIDGO123(ev);
            }
            else {
                this.notificationHandlerOADImageIDOneStick(ev);
            }
        });
        this.notificationHandlerOADImageCtrl = (ev) => __awaiter(this, void 0, void 0, function* () {
            if (this.productType != VEXProductTypes.OneStickController) {
                this.notificationHandlerOADImageCtrlGO123(ev);
            }
            else {
                this.notificationHandlerOADImageCtrlOneStick(ev);
            }
        });
        this.notificationHandlerOADImageBlock = (ev) => {
            if (this.productType != VEXProductTypes.OneStickController) {
                this.notificationHandlerOADImageBlockGO123(ev);
            }
            else {
                this.notificationHandlerOADImageBlockOneStick(ev);
            }
        };
        this.notificationHandlerOADImageIDGO123 = (ev) => __awaiter(this, void 0, void 0, function* () {
            if (this.connectionState != BrainConnectionState.UpdatingFirmware) {
                log3.info("Another app might be updating the connected brain");
                return;
            }
            if (!(ev.target.value)) {
                return;
            }
            const data = ev.target.value;
            const dataUint8Arr = new Uint8Array(data.buffer);
            yield this.delay(10);
            log3.debug("Bytes transferred (OADImgID): ", data.byteLength);
            // log3.debug(dataUint8Arr);
            if (dataUint8Arr[0] === 0) {
                const dataToWrite = Uint8Array.of(3);
                yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.OADImageCtrl], dataToWrite);
            }
        });
        this.notificationHandlerOADImageCtrlGO123 = (ev) => __awaiter(this, void 0, void 0, function* () {
            if (this.connectionState != BrainConnectionState.UpdatingFirmware) {
                log3.info("Another app might be updating the connected brain");
                return;
            }
            try {
                if (!(ev.target.value)) {
                    return;
                }
                const data = ev.target.value;
                const dataUint8Arr = new Uint8Array(data.buffer);
                yield this.delay(10);
                log3.debug("Bytes transferred (OADImgIDCtrl): ", data.byteLength);
                // log3.debug(dataUint8Arr);
                if (dataUint8Arr[0] === 1) {
                    this.payloadSize = (dataUint8Arr[2] << 8) + dataUint8Arr[1];
                    if (this.payloadSize > 0) {
                        this.downloadState = FWDownloadState.ImgVerify;
                        yield this.doDownload();
                    }
                    // else we may need to abort
                    this.oadLastStatus = 0;
                }
                else if (dataUint8Arr[0] === 0x12) {
                    this.oadLastStatus = dataUint8Arr[1];
                    this.oadNextAddress = data.getUint32(2, true);
                    // this.oadNextAddress = ((dataUint8Arr[5]) << 24 + (dataUint8Arr[4]) << 16);
                    // this.oadNextAddress += ((dataUint8Arr[3]) << 8 + (dataUint8Arr[2]));
                    this.downloadState = FWDownloadState.SendBlock;
                    yield this.doDownload();
                }
                else if (dataUint8Arr[0] === 0x04) {
                    this.oadLastStatus = dataUint8Arr[1];
                    if (this.oadLastStatus === 0) {
                        // report to UI
                        this.updateFWUpdateState(VEXFWUpdateStatus.Success);
                        log3.info("Firmware Download successfully completed!");
                    }
                    else {
                        const status = VEXFWUpdateStatus[this.oadLastStatus] ? this.oadLastStatus : VEXFWUpdateStatus.OAD_DL_NOT_COMPLETE;
                        //  Report status to UI
                        this.updateFWUpdateState(VEXFWUpdateStatus.OAD_DL_NOT_COMPLETE);
                    }
                }
            }
            catch (ex) {
                log3.error("OADImageCtrlHandler: error during update:", ex);
                yield this.updateFWUpdateState(VEXFWUpdateStatus.CommunicationFailure);
            }
        });
        this.notificationHandlerOADImageBlockGO123 = (ev) => {
            //
        };
        this.notificationHandlerOADImageIDOneStick = (ev) => __awaiter(this, void 0, void 0, function* () {
            if (!(ev.target.value)) {
                return;
            }
            let data = ev.target.value;
            this.OneStickNotifiedData = data;
            this.OneStickNotify = true;
        });
        this.notificationHandlerOADImageCtrlOneStick = (ev) => __awaiter(this, void 0, void 0, function* () {
            if (!(ev.target.value)) {
                return;
            }
            let data = ev.target.value;
            this.OneStickNotifiedData = data;
            this.OneStickNotify = true;
        });
        this.notificationHandlerOADImageBlockOneStick = (ev) => {
            if (!(ev.target.value)) {
                return;
            }
            let data = ev.target.value;
            this.OneStickNotifiedData = data;
            this.OneStickNotify = true;
        };
        this.notificationHandlerProgramBotConfig = (ev) => {
            if (!(ev.target.value)) {
                return;
            }
            const data = ev.target.value;
            if (data.byteLength >= 20) {
                const config = new VEXProgramPortConfig();
                config.Port1DeviceType = data.getUint8(0);
                config.Port1DeviceFlags = data.getUint8(1);
                config.Port1DeviceSettings = new Uint8Array([data.getUint8(2), data.getUint8(3), data.getUint8(4)]);
                config.Port2DeviceType = data.getUint8(5);
                config.Port2DeviceFlags = data.getUint8(6);
                config.Port2DeviceSettings = new Uint8Array([data.getUint8(7), data.getUint8(8), data.getUint8(9)]);
                config.Port3DeviceType = data.getUint8(10);
                config.Port3DeviceFlags = data.getUint8(11);
                config.Port3DeviceSettings = new Uint8Array([data.getUint8(12), data.getUint8(13), data.getUint8(14)]); // [UInt8(value[12]), UInt8(value[13]), UInt8(value[14])];
                config.Port4DeviceType = data.getUint8(15);
                config.Port4DeviceFlags = data.getUint8(16);
                config.Port4DeviceSettings = new Uint8Array([data.getUint8(17), data.getUint8(18), data.getUint8(19)]);
                this.lastProgramConfig = config;
                EventSystem.fireEvent("VEXBLEBrowser.PortConfig", this.lastProgramConfig);
            }
        };
        this.notificationHandlerDevInfoHardwareRev = (ev) => {
            try {
                if (!(ev.target.value)) {
                    return;
                }
                const data = ev.target.value;
                const decoder = new TextDecoder("utf-8");
                let deviceName = "";
                try {
                    deviceName = decoder.decode(data);
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
                this.deviceInfo.hardwareRev = deviceName;
                EventSystem.fireEvent("VEXBLEBrowser.DeviceInfo", this.deviceInfo);
            }
            catch (ex) {
                log3.error("error parsing HardwareRev");
            }
        };
        this.notificationHandlerAIMTXData = (ev) => {
            try {
                if (!(ev.target.value)) {
                    return;
                }
                let data = ev.target.value;
                //log3.debug(data);
                EventSystem.fireEvent("VEXBLEBrowser.RXDataAdmin", data.buffer);
            }
            catch (ex) {
                log3.error("error parsing AIM TX Data Admin");
            }
        };
        this.notificationHandlerAIMTXUser = (ev) => {
            try {
                if (!(ev.target.value)) {
                    return;
                }
                let data = ev.target.value;
                let consoleOutputText = new TextDecoder().decode(data);
                log3.debug(consoleOutputText);
                EventSystem.fireEvent("VEXBLEBrowser.RXDataUser", consoleOutputText);
            }
            catch (ex) {
                log3.error("error parsing AIM TX Data User");
            }
        };
        this.notificationHandlerAIMRemoteControlStatus = (ev) => {
            try {
                if (!(ev.target.value)) {
                    return;
                }
                const dataView = ev.target.value;
                //log3.debug(dataView);
                let status = VEXAimBleStatus.fromData(dataView);
                //log3.debug("AIM Remote Control Status: ", status);
                EventSystem.fireEvent("VEXBLEBrowser.AIMRemoteControlBotStatus", status);
            }
            catch (ex) {
                log3.error("error parsing AIM Remote Control Status");
            }
        };
        this.notificationHandlerAIMRemoteControlCommand = (ev) => {
            try {
                if (!(ev.target.value)) {
                    return;
                }
                const dataView = ev.target.value;
                //log3.debug(dataView);
                let status = VEXAimBleRCCmdAck.fromData(dataView);
                //log3.debug("AIM Remote Control Command Ack: ", status);
                EventSystem.fireEvent("VEXBLEBrowser.AIMRemoteControlCommandStatus", status);
            }
            catch (ex) {
                log3.error("error parsing AIM Remote Control Command");
            }
        };
        this.aimAiVisionObjectData = new Uint8Array(0);
        this.aimAiVisionObjectDataStr = ""; //only for debugging purpose
        this.notificationHandlerAIMRemoteControlAIStatus = (ev) => {
            try {
                if (!(ev.target.value)) {
                    return;
                }
                const dataView = ev.target.value;
                //log3.debug(dataView);
                let status = VEXAimBleAiStatus.fromData(dataView);
                const lastPacket = (status.flags & VEXAimBleAiStatusFlags.lastPacket) !== 0;
                if (!lastPacket || status.object_count < 12) {
                    this.aimAiVisionObjectDataStr = Array.from(status.object_data).map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(" ");
                    //append status.object_data to objectDataRaw
                    this.aimAiVisionObjectData = new Uint8Array([...this.aimAiVisionObjectData, ...status.object_data]);
                }
                else {
                    this.aimAiVisionObjectDataStr += Array.from(status.object_data).map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(" ");
                    this.aimAiVisionObjectData = new Uint8Array([...this.aimAiVisionObjectData, ...status.object_data]);
                }
                if (lastPacket) {
                    // let objectData: VEXAimBleAiVisionObject = VEXAimBleAiVisionObject.fromData(new DataView(this.aimAiVisionObjectData.buffer));
                    const objectsDetected = [];
                    for (let i = 0; i < this.aimAiVisionObjectData.length; i += 18) {
                        const slice = new DataView(this.aimAiVisionObjectData.buffer, i, 18);
                        const objectData = VEXAimBleAiVisionObject.fromData(slice);
                        if (objectData) {
                            objectsDetected.push(objectData);
                        }
                    }
                    let aimAiVisionStatus = new VEXAimBleAiVisionStatus();
                    aimAiVisionStatus.settings = {
                        isAiObjEnabled: (status.flags & VEXAimBleAiStatusFlags.aiObjEnabled) !== 0,
                        isColorEnabled: (status.flags & VEXAimBleAiStatusFlags.colorEnabled) !== 0,
                        isTagEnabled: (status.flags & VEXAimBleAiStatusFlags.tagsEnabled) !== 0,
                        isMergeEnabled: (status.flags & VEXAimBleAiStatusFlags.mergeEnabled) !== 0,
                        isStatOvlEnabled: (status.flags & VEXAimBleAiStatusFlags.statOvlEnabled) !== 0,
                        isDispOvlEnabled: (status.flags & VEXAimBleAiStatusFlags.dispOvlEnabled) !== 0,
                        isUsbOvlEnabled: (status.flags & VEXAimBleAiStatusFlags.usbOvlEnabled) !== 0,
                    };
                    aimAiVisionStatus.objectCount = status.object_count;
                    aimAiVisionStatus.ObjectsDetected = objectsDetected;
                    // log3.debug(`AIM Remote Control AI Status:`);
                    // log3.debug(`  Object Count: ${status.object_count}`);
                    // log3.debug(`  Flags: 0x${status.flags.toString(16).toUpperCase()}`);
                    // log3.debug(`  Object Data Hex: ${this.aimAiVisionObjectDataStr}`);
                    // log3.debug("  Object Data: ",objects);
                    EventSystem.fireEvent("VEXBLEBrowser.AIMRemoteControlAIVisionStatus", aimAiVisionStatus);
                    this.aimAiVisionObjectData = new Uint8Array(0);
                    this.aimAiVisionObjectDataStr = "";
                }
            }
            catch (ex) {
                log3.error("error parsing AIM Remote Control AI Status");
            }
        };
        this.getConnectedDeviceInfo = () => __awaiter(this, void 0, void 0, function* () {
            // We can use the below code to get the device info to get the Model of the device instead of using `ex: this.productType == VEXProductTypes.VEXAIM` 
            // if (this.characteristics[BLECharacteristicsID.DevInfoModelNumber]) {
            //     const data = await readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoModelNumber]);
            //     const decoder = new TextDecoder("utf-8");
            //     const modelNumberStr = decoder.decode(data);
            //     if (modelNumberStr) {
            //         if (modelNumberStr.includes("VEX Coder")) {
            //             this.deviceInfo.productType = VEXProductTypes.VEXCoder;
            //         } else if (modelNumberStr.includes("VEX 123")) {
            //             this.deviceInfo.productType = VEXProductTypes.VEX123Puck;
            //         } else if (modelNumberStr.includes("VEX Go")) {
            //             this.deviceInfo.productType = VEXProductTypes.VEXGO;
            //         } else if (modelNumberStr.includes("AIM")) {
            //             this.deviceInfo.productType = VEXProductTypes.VEXAIM;
            //         }
            //         if (modelNumberStr.includes("Bootload")) {
            //             this.deviceInfo.deviceMode = VEXDeviceMode.Update;
            //         } else {
            //             this.deviceInfo.deviceMode = VEXDeviceMode.Connect;
            //         }
            //         this.deviceInfo.productTypeString = modelNumberStr;
            //     } else {
            //         log3.error("Model Number is not a valid UTF-8 sequence");
            //         this.deviceInfo.productTypeString = "";
            //         this.deviceInfo.productType = VEXProductTypes.Unknown;
            //     }
            if (this.productType == VEXProductTypes.VEXAIM) {
                yield this.getConnectedDeviceInfoAIM();
            }
            else if (this.productType == VEXProductTypes.VEXIQ2Brain) {
                yield this.getConnectedDeviceInfoIQ2();
            }
            else if (this.productType == VEXProductTypes.VEXEXPBrain) {
                yield this.getConnectedDeviceInfoEXP();
            }
            else if (this.productType == VEXProductTypes.OneStickController) {
                yield this.getConnectedDeviceInfoOneStick();
            }
            else {
                yield this.getConnectedDeviceInfo123GO();
            }
        });
        this.getConnectedDeviceInfoOneStick = () => __awaiter(this, void 0, void 0, function* () {
            const decoder = new TextDecoder("utf-8");
            //firmware version (bootloader) One stick reports software and firmware version the same
            if (this.characteristics[BLECharacteristicsID.DevInfoFirmware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoFirmware]);
                const firmwareVersion = decoder.decode(data);
                this.deviceInfo.bootVersion = VEXFirmwareVersion.fromString(firmwareVersion);
                log3.debug("firmwareVersion: ", firmwareVersion);
                // We support firmware update for OneStickController but Not bootloaded update
                this.deviceInfo.supportFWUpdate = true;
            }
            //software version
            if (this.characteristics[BLECharacteristicsID.DevInfoSoftware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSoftware]);
                const softwareVersion = decoder.decode(data);
                this.deviceInfo.appVersion = VEXFirmwareVersion.fromString(softwareVersion);
                log3.debug("softwareVersion: ", softwareVersion);
            }
            //product type and model number
            if (this.characteristics[BLECharacteristicsID.DevInfoModelNumber]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoModelNumber]);
                const decoder = new TextDecoder("utf-8");
                const modelNumberStr = decoder.decode(data);
                if (modelNumberStr) {
                    if (modelNumberStr.includes("VEX Coder")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXCoder;
                    }
                    else if (modelNumberStr.includes("VEX 123")) {
                        this.deviceInfo.productType = VEXProductTypes.VEX123Puck;
                    }
                    else if (modelNumberStr.includes("VEX Go")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXGO;
                    }
                    else if (modelNumberStr.includes("VEX_1S")) {
                        this.deviceInfo.productType = VEXProductTypes.OneStickController;
                    }
                    if (modelNumberStr.includes("_BL")) {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Update;
                    }
                    else {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Connect;
                    }
                    this.deviceInfo.productTypeString = modelNumberStr;
                }
                else {
                    log3.error("Model Number is not a valid UTF-8 sequence");
                    this.deviceInfo.productTypeString = "";
                    this.deviceInfo.productType = VEXProductTypes.Unknown;
                }
            }
            //TODO figureout the format of the deviceID ( may be needed in future)
            if (this.characteristics[BLECharacteristicsID.DevInfoSystemID]) {
                // const data = await readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSystemID]);
                // const systemID = decoder.decode(data)
                // this.deviceInfo.deviceIDString = systemID;
                // this.deviceInfo.deviceIDValue = parseInt(systemID, 16);
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSystemID]);
                this.deviceInfo.deviceID = new Uint8Array([data.getUint8(0), data.getUint8(1), data.getUint8(2), data.getUint8(5)]);
                this.deviceInfo.deviceIDValue = (0,byteArrayToInt32)(this.deviceInfo.deviceID);
            }
            // name of the device
            if (this.device) {
                this.deviceInfo.name = this.device.name;
            }
            // version check
            this.deviceInfo.updateNeeded = false;
            if (this.firmwareVersionRemote && (!this.firmwareVersionRemote.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionRemote);
            }
            else if (this.firmwareVersionLocal && (!this.firmwareVersionLocal.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionLocal);
            }
            //can not update bootloader for OneStickController 
            this.deviceInfo.bootloaderUpdateNeeded = false;
        });
        this.getConnectedDeviceInfo123GO = () => __awaiter(this, void 0, void 0, function* () {
            if (this.characteristics[BLECharacteristicsID.DevInfoFirmware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoFirmware]);
                // This data comes across as a string but we can parse it
                // format is "#.#.#.B#"
                if (data.byteLength > 7) {
                    this.deviceInfo.bootVersion = new VEXFirmwareVersion(data.getUint8(0) - 0x30, data.getUint8(2) - 0x30, data.getUint8(4) - 0x30, data.getUint8(7) - 0x30);
                }
                if (!this.deviceInfo.bootVersion.isEmpty()) {
                    this.deviceInfo.supportFWUpdate = this.deviceInfo.checkFWUpdateSupported();
                }
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoSoftware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSoftware]);
                // This data comes across as a string but we can parse it
                // format is "#.#.#.B#"
                if (data.byteLength > 7) {
                    this.deviceInfo.appVersion = new VEXFirmwareVersion(data.getUint8(0) - 0x30, data.getUint8(2) - 0x30, data.getUint8(4) - 0x30, data.getUint8(7) - 0x30);
                }
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoModelNumber]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoModelNumber]);
                const decoder = new TextDecoder("utf-8");
                const modelNumberStr = decoder.decode(data);
                if (modelNumberStr) {
                    if (modelNumberStr.includes("VEX Coder")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXCoder;
                    }
                    else if (modelNumberStr.includes("VEX 123")) {
                        this.deviceInfo.productType = VEXProductTypes.VEX123Puck;
                    }
                    else if (modelNumberStr.includes("VEX Go")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXGO;
                    }
                    if (modelNumberStr.includes("Bootload")) {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Update;
                    }
                    else {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Connect;
                    }
                    this.deviceInfo.productTypeString = modelNumberStr;
                }
                else {
                    log3.error("Model Number is not a valid UTF-8 sequence");
                    this.deviceInfo.productTypeString = "";
                    this.deviceInfo.productType = VEXProductTypes.Unknown;
                }
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoSystemID]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSystemID]);
                this.deviceInfo.deviceID = new Uint8Array([data.getUint8(0), data.getUint8(1), data.getUint8(2), data.getUint8(5)]);
                this.deviceInfo.deviceIDValue = (0,byteArrayToInt32)(this.deviceInfo.deviceID);
            }
            // TODO:  Current this characteristic is blocked by WebBluetooth
            if (this.characteristics[BLECharacteristicsID.DevInfoSerialNumber]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSerialNumber]);
                const decoder = new TextDecoder("utf-8");
                let deviceName = "";
                try {
                    deviceName = decoder.decode(data);
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
                this.deviceInfo.name = deviceName;
            }
            else if (this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]);
                const decoder = new TextDecoder("utf-8");
                let deviceName = "";
                try {
                    deviceName = decoder.decode(data);
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
                this.deviceInfo.name = deviceName;
            }
            else {
                if (this.device) {
                    this.deviceInfo.name = this.device.name;
                }
            }
            // version check
            this.deviceInfo.updateNeeded = false;
            if (this.firmwareVersionRemote && (!this.firmwareVersionRemote.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionRemote);
            }
            else if (this.firmwareVersionLocal && (!this.firmwareVersionLocal.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionLocal);
            }
            this.deviceInfo.bootloaderUpdateNeeded = false;
            if (this.bootLoaderVersionRemote && (!this.bootLoaderVersionRemote.isEmpty())) {
                this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionRemote);
            }
            else if (this.bootLoaderVersionLocal && (!this.bootLoaderVersionLocal.isEmpty())) {
                this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionLocal);
            }
        });
        this.getConnectedDeviceInfoAIM = () => __awaiter(this, void 0, void 0, function* () {
            const decoder = new TextDecoder("utf-8");
            if (this.characteristics[BLECharacteristicsID.DevInfoSystemID]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSystemID]);
                const systemID = decoder.decode(data);
                this.deviceInfo.deviceIDValue = parseInt(systemID, 16);
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoModelNumber]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoModelNumber]);
                const modelNumberStr = decoder.decode(data);
                if (modelNumberStr) {
                    if (modelNumberStr.includes("VEX Coder")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXCoder;
                    }
                    else if (modelNumberStr.includes("VEX 123")) {
                        this.deviceInfo.productType = VEXProductTypes.VEX123Puck;
                    }
                    else if (modelNumberStr.includes("VEX Go")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXGO;
                    }
                    else if (modelNumberStr.includes("AIM")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXAIM;
                    }
                    if (modelNumberStr.includes("Bootload")) {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Update;
                    }
                    else {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Connect;
                    }
                    this.deviceInfo.productTypeString = modelNumberStr;
                }
                else {
                    log3.error("Model Number is not a valid UTF-8 sequence");
                    this.deviceInfo.productTypeString = "";
                    this.deviceInfo.productType = VEXProductTypes.Unknown;
                }
            }
            // Currently this characteristic is blocked by WebBluetooth. It should work on iOS and Android
            if (this.characteristics[BLECharacteristicsID.DevInfoSerialNumber]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSerialNumber]);
                let serialNumber = "";
                try {
                    serialNumber = decoder.decode(data);
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
            }
            //read firmware version for ESP32
            if (this.characteristics[BLECharacteristicsID.DevInfoFirmware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoFirmware]);
                const firmwareVersion = decoder.decode(data);
                this.deviceInfo.appVersion2 = VEXFirmwareVersion.fromString(firmwareVersion);
                log3.debug("firmwareVersion: ", firmwareVersion);
            }
            //read hardware revision 
            if (this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]);
                let hardwareRev = "";
                try {
                    hardwareRev = decoder.decode(data);
                    this.deviceInfo.hardwareRev = hardwareRev;
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
            }
            //read firmware version for GP 
            if (this.characteristics[BLECharacteristicsID.DevInfoSoftware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSoftware]);
                const appVersion = decoder.decode(data);
                this.deviceInfo.appVersion = VEXFirmwareVersion.fromString(appVersion);
            }
            if (this.characteristics[BLECharacteristicsID.DeviceInfoManufacturerName]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DeviceInfoManufacturerName]);
                let manufacturerName = "";
                try {
                    manufacturerName = decoder.decode(data);
                    log3.debug("manufacturerName: ", manufacturerName);
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
            }
            // name is available from selected device advertisement data
            if (this.device) {
                this.deviceInfo.name = this.device.name;
            }
            let nameFromAdmin = yield this.GetBrainNameAdmin();
            //if for some reason thats not available in webbletooth, then fetch the name from the device using admin chars through CDC2
            if (this.deviceInfo.name !== nameFromAdmin) {
                this.deviceInfo.name = nameFromAdmin;
            }
            // firmware version check & update needed
            this.deviceInfo.supportFWUpdate = this.deviceInfo.checkFWUpdateSupported();
            this.deviceInfo.updateNeeded = false;
            if (this.firmwareVersionRemote && (!this.firmwareVersionRemote.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionRemote);
            }
            else if (this.firmwareVersionLocal && (!this.firmwareVersionLocal.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionLocal);
            }
            this.deviceInfo.bootloaderUpdateNeeded = false;
            if (this.bootLoaderVersionRemote && (!this.bootLoaderVersionRemote.isEmpty())) {
                this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionRemote);
            }
            else if (this.bootLoaderVersionLocal && (!this.bootLoaderVersionLocal.isEmpty())) {
                this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionLocal);
            }
            // below code is to get the device info from the brain using admin chars through CDC2
            // we dont need this since the deviceInfo is availble through device service characteristics
            // leaving the code here for reference
            // let version = await this.BrainGetSystemVersion();
            // if (version) {
            //     this.deviceInfo.appVersion = new VEXFirmwareVersion(version[0], version[1], version[2], version[3]);
            // }
            // this.deviceInfo.name = await this.GetBrainNameAdmin();
            // let systemStatus = await this.BrainGetSystemStatus();
            // if (systemStatus) {
            //     log3.debug("deviceID from Admin: ", systemStatus.deviceID);
            //     this.deviceInfo.deviceIDValue = systemStatus.deviceID;
            // }
        });
        this.getConnectedDeviceInfoIQ2 = () => __awaiter(this, void 0, void 0, function* () {
            const decoder = new TextDecoder("utf-8");
            if (this.characteristics[BLECharacteristicsID.DevInfoSystemID]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSystemID]);
                const dataView = new DataView(data.buffer);
                // Convert first 4 bytes to hex in reverse order
                let hexValue = '';
                for (let i = 3; i >= 0; i--) { // Start from 4th byte (index 3) and go backwards
                    hexValue += dataView.getUint8(i).toString(16).padStart(2, '0').toUpperCase();
                }
                this.deviceInfo.deviceIDValue = parseInt(hexValue, 16);
                this.deviceInfo.deviceIDString = hexValue;
                this.deviceInfo.deviceID = new Uint8Array([dataView.getUint8(0), dataView.getUint8(1), dataView.getUint8(2), dataView.getUint8(3)]);
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoModelNumber]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoModelNumber]);
                const modelNumberStr = decoder.decode(data);
                if (modelNumberStr) {
                    if (modelNumberStr.includes("VEX Coder")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXCoder;
                    }
                    else if (modelNumberStr.includes("VEX 123")) {
                        this.deviceInfo.productType = VEXProductTypes.VEX123Puck;
                    }
                    else if (modelNumberStr.includes("VEX Go")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXGO;
                    }
                    else if (modelNumberStr.includes("AIM")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXAIM;
                    }
                    else if (modelNumberStr.includes("VEX IQ")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXIQ2Brain;
                    }
                    if (modelNumberStr.includes("Bootload")) {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Update;
                    }
                    else {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Connect;
                    }
                    this.deviceInfo.productTypeString = modelNumberStr;
                }
                else {
                    log3.error("Model Number is not a valid UTF-8 sequence");
                    this.deviceInfo.productTypeString = "";
                    this.deviceInfo.productType = VEXProductTypes.Unknown;
                }
            }
            // Currently this characteristic is blocked by WebBluetooth. It should work on iOS and Android
            if (this.characteristics[BLECharacteristicsID.DevInfoSerialNumber]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSerialNumber]);
                let serialNumber = "";
                try {
                    serialNumber = decoder.decode(data);
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoFirmware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoFirmware]);
                const firmwareVersion = decoder.decode(data);
                this.deviceInfo.appVersion2 = VEXFirmwareVersion.fromString(firmwareVersion);
                log3.debug("firmwareVersion: ", firmwareVersion);
            }
            //read hardware revision 
            if (this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]);
                let hardwareRev = "";
                try {
                    hardwareRev = decoder.decode(data);
                    this.deviceInfo.hardwareRev = hardwareRev;
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoSoftware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSoftware]);
                const appVersion = decoder.decode(data);
                this.deviceInfo.appVersion = VEXFirmwareVersion.fromString(appVersion);
            }
            if (this.characteristics[BLECharacteristicsID.DeviceInfoManufacturerName]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DeviceInfoManufacturerName]);
                let manufacturerName = "";
                try {
                    manufacturerName = decoder.decode(data);
                    log3.debug("manufacturerName: ", manufacturerName);
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
            }
            // name is available from selected device advertisement data
            if (this.device) {
                this.deviceInfo.name = this.device.name;
            }
            // below code is to get the device info from the brain using admin chars through CDC2
            // we dont need this since the deviceInfo is availble through device service characteristics
            // leaving the code here for reference
            //await this.delay(1000); // wait for the device to be ready
            if (this.deviceInfo.unlocked) {
                let version = yield this.BrainGetSystemVersion();
                if (version) {
                    this.deviceInfo.appVersion = new VEXFirmwareVersion(version[0], version[1], version[2], version[3]);
                }
                let nameFromAdmin = yield this.GetBrainNameAdmin();
                //if for some reason thats not available in webbletooth, then fetch the name from the device using admin chars through CDC2
                if (this.deviceInfo.name !== nameFromAdmin) {
                    this.deviceInfo.name = nameFromAdmin;
                }
            }
            // firmware version check & update needed
            this.deviceInfo.supportFWUpdate = this.deviceInfo.checkFWUpdateSupported();
            this.deviceInfo.updateNeeded = false;
            if (this.firmwareVersionRemote && (!this.firmwareVersionRemote.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionRemote);
            }
            else if (this.firmwareVersionLocal && (!this.firmwareVersionLocal.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionLocal);
            }
            this.deviceInfo.bootloaderUpdateNeeded = false;
            if (this.bootLoaderVersionRemote && (!this.bootLoaderVersionRemote.isEmpty())) {
                this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionRemote);
            }
            else if (this.bootLoaderVersionLocal && (!this.bootLoaderVersionLocal.isEmpty())) {
                this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionLocal);
            }
            // this.deviceInfo.name = await this.GetBrainNameAdmin();
            // let systemStatus = await this.BrainGetSystemStatus();
            // if (systemStatus) {
            //     log3.debug("deviceID from Admin: ", systemStatus.deviceID);
            //     this.deviceInfo.deviceIDValue = systemStatus.deviceID;
            // }
        });
        this.getConnectedDeviceInfoEXP = () => __awaiter(this, void 0, void 0, function* () {
            const decoder = new TextDecoder("utf-8");
            if (this.characteristics[BLECharacteristicsID.DevInfoSystemID]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSystemID]);
                const dataView = new DataView(data.buffer);
                // Convert first 4 bytes to hex in reverse order
                let hexValue = '';
                for (let i = 3; i >= 0; i--) { // Start from 4th byte (index 3) and go backwards
                    hexValue += dataView.getUint8(i).toString(16).padStart(2, '0').toUpperCase();
                }
                this.deviceInfo.deviceIDValue = parseInt(hexValue, 16);
                this.deviceInfo.deviceIDString = hexValue;
                this.deviceInfo.deviceID = new Uint8Array([dataView.getUint8(0), dataView.getUint8(1), dataView.getUint8(2), dataView.getUint8(3)]);
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoModelNumber]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoModelNumber]);
                const modelNumberStr = decoder.decode(data);
                if (modelNumberStr) {
                    if (modelNumberStr.includes("VEX Coder")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXCoder;
                    }
                    else if (modelNumberStr.includes("VEX 123")) {
                        this.deviceInfo.productType = VEXProductTypes.VEX123Puck;
                    }
                    else if (modelNumberStr.includes("VEX Go")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXGO;
                    }
                    else if (modelNumberStr.includes("AIM")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXAIM;
                    }
                    else if (modelNumberStr.includes("VEX IQ")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXIQ2Brain;
                    }
                    else if (modelNumberStr.includes("VEX EXP")) {
                        this.deviceInfo.productType = VEXProductTypes.VEXEXPBrain;
                    }
                    if (modelNumberStr.includes("Bootload")) {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Update;
                    }
                    else {
                        this.deviceInfo.deviceMode = VEXDeviceMode.Connect;
                    }
                    this.deviceInfo.productTypeString = modelNumberStr;
                }
                else {
                    log3.error("Model Number is not a valid UTF-8 sequence");
                    this.deviceInfo.productTypeString = "";
                    this.deviceInfo.productType = VEXProductTypes.Unknown;
                }
            }
            // Currently this characteristic is blocked by WebBluetooth. It should work on iOS and Android
            if (this.characteristics[BLECharacteristicsID.DevInfoSerialNumber]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSerialNumber]);
                let serialNumber = "";
                try {
                    serialNumber = decoder.decode(data);
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoFirmware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoFirmware]);
                const firmwareVersion = decoder.decode(data);
                this.deviceInfo.appVersion2 = VEXFirmwareVersion.fromString(firmwareVersion);
                log3.debug("firmwareVersion: ", firmwareVersion);
            }
            //read hardware revision 
            if (this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]);
                let hardwareRev = "";
                try {
                    hardwareRev = decoder.decode(data);
                    this.deviceInfo.hardwareRev = hardwareRev;
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
            }
            if (this.characteristics[BLECharacteristicsID.DevInfoSoftware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoSoftware]);
                const appVersion = decoder.decode(data);
                this.deviceInfo.appVersion = VEXFirmwareVersion.fromString(appVersion);
            }
            if (this.characteristics[BLECharacteristicsID.DeviceInfoManufacturerName]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DeviceInfoManufacturerName]);
                let manufacturerName = "";
                try {
                    manufacturerName = decoder.decode(data);
                    log3.debug("manufacturerName: ", manufacturerName);
                }
                catch (e) {
                    log3.error("device Name is not a valid UTF-8 sequence");
                }
            }
            // name is available from selected device advertisement data
            if (this.device) {
                this.deviceInfo.name = this.device.name;
            }
            // below code is to get the device info from the brain using admin chars through CDC2
            // we dont need this since the deviceInfo is availble through device service characteristics
            // leaving the code here for reference
            //await this.delay(1000); // wait for the device to be ready
            if (this.deviceInfo.unlocked) {
                let version = yield this.BrainGetSystemVersion();
                if (version) {
                    this.deviceInfo.appVersion = new VEXFirmwareVersion(version[0], version[1], version[2], version[3]);
                }
                let nameFromAdmin = yield this.GetBrainNameAdmin();
                //if for some reason thats not available in webbletooth, then fetch the name from the device using admin chars through CDC2
                if (this.deviceInfo.name !== nameFromAdmin) {
                    this.deviceInfo.name = nameFromAdmin;
                }
            }
            // firmware version check & update needed
            this.deviceInfo.supportFWUpdate = this.deviceInfo.checkFWUpdateSupported();
            this.deviceInfo.updateNeeded = false;
            if (this.firmwareVersionRemote && (!this.firmwareVersionRemote.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionRemote);
            }
            else if (this.firmwareVersionLocal && (!this.firmwareVersionLocal.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionLocal);
            }
            this.deviceInfo.bootloaderUpdateNeeded = false;
            if (this.bootLoaderVersionRemote && (!this.bootLoaderVersionRemote.isEmpty())) {
                this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionRemote);
            }
            else if (this.bootLoaderVersionLocal && (!this.bootLoaderVersionLocal.isEmpty())) {
                this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionLocal);
            }
        });
        this.notificationHandlerDeviceLog = (ev) => __awaiter(this, void 0, void 0, function* () {
            if (!(ev.target.value)) {
                return;
            }
            const dataView = ev.target.value;
            yield this.processDevLog(dataView.buffer);
        });
        if (!navigator || !navigator.bluetooth) {
            log3.error("navigator.bluetooth not available");
            return;
        }
        // TODO: product should be based on the connected device
        this.productType = VEXProductTypes.VEXGO;
        if (target === "GO") {
            this.productType = VEXProductTypes.VEXGO;
        }
        if (target === "123") {
            this.productType = VEXProductTypes.VEX123Puck;
        }
        if (target === "AIM") {
            this.productType = VEXProductTypes.VEXAIM;
        }
        if (target === "ONESTICK") {
            this.productType = VEXProductTypes.OneStickController;
        }
        if (target === "IQ2") {
            this.productType = VEXProductTypes.VEXIQ2Brain;
        }
        if (target === "EXP") {
            this.productType = VEXProductTypes.VEXEXPBrain;
        }
        // TODO add support for IQ/EXP/V5
        if (target == "AIM" || target == "IQ2" || target == "EXP" || target == "V5") {
            this.vexCDCDevice = new VEXCDCDevice(target, this.WriteDataAsync);
        }
        this.servicesFilter = [
            { services: getServicesFilter(this.productType) },
        ];
        this.optionalServices = getOptionalServicesFilter(this.productType);
        this.enableAutoConnect = false;
        this.firmware = new VEXBLEFirmware(this.productType);
        this.init();
        this.currentControlValues = new ControlValues();
    }
    //#region Public
    getMachineBleHardwareInfo(platform) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                try {
                    // for chrome app
                    if (platform === "ChromeApp") {
                        if (chrome && chrome.bluetooth) {
                            let reqTimeout;
                            try {
                                reqTimeout = setTimeout(() => {
                                    log3.error("getMachineBleHardwareInfo: timeout");
                                    reject(undefined);
                                }, 1000);
                                chrome.bluetooth.getAdapterState((adapterInfo) => {
                                    const adapterDetails = {
                                        address: adapterInfo.address,
                                        name: adapterInfo.name,
                                        available: adapterInfo.available,
                                        discovering: adapterInfo.discovering,
                                        powered: adapterInfo.powered,
                                    };
                                    clearTimeout(reqTimeout);
                                    resolve(adapterDetails);
                                });
                            }
                            catch (ex) {
                                log3.error("getMachineBleHardwareInfo: could not get BLE adapter info");
                                clearTimeout(reqTimeout);
                                resolve(undefined);
                            }
                        }
                        else {
                            log3.error("getMachineBleHardwareInfo: chrome.bluetooth not available. check passed platform arg?");
                            reject(undefined);
                        }
                    }
                    else { // browser
                        reject(undefined);
                    }
                }
                catch (ex) {
                    log3.error("getMachineBleHardwareInfo: could not get BLE adapter info");
                    reject(undefined);
                }
            }));
        });
    }
    /**
     * Development and debugging purpose only
     * Shows all the nearby BLE devices in scan
     */
    showAllBLEDevices(enable) {
        this.showAllBLEDevicesNear = enable;
    }
    isConnected() {
        return (this.connectionState === BrainConnectionState.Connected);
    }
    getConnectionState() {
        return this.connectionState;
    }
    getDeviceInfo() {
        return this.deviceInfo;
    }
    async scanAndConnect() {
        await this.scan();
        await this.connect();
    }
    disconnect(force) {
        if (!this.device) {
            log3.info("no device to disconnect!");
            return;
        }
        this.enableAutoConnect = false;
        if (this.device.gatt.connected) {
            this.device.gatt.disconnect();
            this.device = undefined;
            this.updateConnectionState(BrainConnectionState.Disconnected);
            log3.info("disconnected");
        }
        else {
            if (force) {
                this.device = undefined;
                this.updateConnectionState(BrainConnectionState.Disconnected);
                log3.info("forcing disconnection & cleanup");
            }
            log3.info("already disconnected");
        }
    }
    async powerOff() {
        const state = Uint8Array.of(PowerState.Off);
        await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.Reset], state);
    }
    async reboot() {
        const state = Uint8Array.of(PowerState.Reboot);
        // set to false if Full Scan required
        this.enableAutoConnect = true;
        await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.Reset], state);
    }
    async setFirmwareToBeta(firmwareType) {
        this.firmwareType = firmwareType;
        await this.pullLatestFirmwareVersion(this.firmwareType);
    }
    async bootload() {
        const state = Uint8Array.of(PowerState.Bootload);
        // set to false if Full Scan required
        this.enableAutoConnect = true;
        await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.Reset], state);
        this.isWaitingToBootload = true;
        // uncomment if Full scan required
        // but in bootload mode , the web bluetooth is showing the brain in the scan list
        // this.device = undefined;
        // await this.scanAndConnect();
    }
    async bootloadOneStick() {
        const state = Uint8Array.of(PowerState.Bootload);
        this.enableAutoConnect = true;
        await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.OneStickReset], state);
        this.isWaitingToBootload = true;
    }
    async SendProgramStateCommand(cmd) {
        if (this.connectionState === BrainConnectionState.Connected && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
            const value = new Uint8Array(1);
            switch (cmd) {
                case VEXProgramState.Play:
                    value[0] = ProgramConst.PROG_CMD_PLAY;
                    break;
                case VEXProgramState.Play:
                    value[0] = ProgramConst.PROG_CMD_PAUSE;
                    break;
                case VEXProgramState.Step:
                    value[0] = ProgramConst.PROG_CMD_STEP;
                    break;
                default:
                    value[0] = ProgramConst.PROG_CMD_STOP;
                    break;
            }
            try {
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
            }
            catch (ex) {
                this.delay(500);
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
            }
        }
    }
    checkIfUpdateNeeded() {
        return this.deviceInfo && this.deviceInfo.updateNeeded;
    }
    checkIfBootloaderUpdateNeeded() {
        return this.deviceInfo && this.deviceInfo.bootloaderUpdateNeeded;
    }
    /**
     * update firmware of the device
     * @param firmwareType Release/Beta/Dev/Bootloader
     * @returns
     */
    updateFirmware(firmwareType) {
        return __awaiter(this, void 0, void 0, function* () {
            if (firmwareType === undefined) {
                firmwareType = this.firmwareType;
            }
            else {
                this.firmwareType = firmwareType;
            }
            if (this.productType == VEXProductTypes.VEXAIM) {
                log3.error("updateFirmware: AIM device does not support firmware update over BLE");
                return;
            }
            if (this.productType == VEXProductTypes.VEXIQ2Brain) {
                log3.error("updateFirmware: WebBle lib does not support updating firmware for IQ2 Brain yet");
                return;
            }
            if (this.productType == VEXProductTypes.VEXEXPBrain) {
                log3.error("updateFirmware: WebBle lib does not support updating firmware for EXP Brain yet");
                return;
            }
            if (this.productType == VEXProductTypes.OneStickController) {
                return this.updateFirmwareOneStick(firmwareType);
            }
            try {
                // check for bootload mode if fwtype is not bootloader
                if (this.firmwareType != VEXFirmwareType.Bootloader) {
                    if (this.deviceInfo.deviceMode !== VEXDeviceMode.Update) {
                        // bootload otherwise
                        if (this.deviceInfo.deviceMode === VEXDeviceMode.Connect) {
                            this.autoUpdateOnBootLoad = true;
                            yield this.bootload();
                            return;
                        }
                    }
                    else {
                        this.enableAutoConnect = true;
                    }
                }
                if (!this.characteristics[BLECharacteristicsID.OADImageCtrl] ||
                    !this.characteristics[BLECharacteristicsID.OADImageID] ||
                    !this.characteristics[BLECharacteristicsID.OADImageBlock]) {
                    log3.error("device does not support updating from browser or communication failure!");
                    this.updateFWUpdateState(VEXFWUpdateStatus.CommunicationFailure);
                    return;
                }
                // safe delay to consider reconnection
                // fetch the latest version one more time from server or local
                yield this.pullLatestFirmwareVersion(this.firmwareType);
                if (this.productType == VEXProductTypes.VEXGO) {
                    yield this.pullLatestFirmwareVersion(VEXFirmwareType.Bootloader);
                }
                // double check device and image version and update the deviceinfo
                if (this.firmwareVersionRemote && (!this.firmwareVersionRemote.isEmpty())) {
                    this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionRemote);
                }
                else if (this.firmwareVersionLocal && (!this.firmwareVersionLocal.isEmpty())) {
                    this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionLocal);
                }
                if (this.bootLoaderVersionRemote && (!this.bootLoaderVersionRemote.isEmpty())) {
                    this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionRemote);
                }
                else if (this.bootLoaderVersionLocal && (!this.bootLoaderVersionLocal.isEmpty())) {
                    this.deviceInfo.bootloaderUpdateNeeded = this.deviceInfo.bootVersion.isLessThan(this.bootLoaderVersionLocal);
                }
                // we ignore updateNeeded check above and proceed to update the firmware when this function is called by Front end
                // Front end decides whether to update firmware or not depending on deviceInfo.updateNeeded flag
                this.updateConnectionState(BrainConnectionState.UpdatingFirmware);
                yield this.delay(3000);
                let image = undefined;
                image = yield this.firmware.getImageFromServer(firmwareType);
                log3.debug("downloaded vexos hex string from server:", image);
                if (!image) {
                    image = yield this.firmware.getImageFromLocalFile(firmwareType);
                    log3.debug("loaded vexos hex string from local file:", image);
                }
                if (!image) {
                    log3.info("could not get latest image from server and local");
                    this.updateFWUpdateState(VEXFWUpdateStatus.FileNotFound);
                    return;
                }
                this.oadLastStatus = 0;
                this.firmwareImage = yield this.firmware.getImageFromHex(image);
                // double checking still the service characteristics are still available
                // as the steps above did some intense file processing in a single threaded setup
                if (!this.characteristics[BLECharacteristicsID.OADImageCtrl] ||
                    !this.characteristics[BLECharacteristicsID.OADImageID] ||
                    !this.characteristics[BLECharacteristicsID.OADImageBlock]) {
                    log3.error("device does not support updating from browser or communication failure!");
                    this.updateFWUpdateState(VEXFWUpdateStatus.CommunicationFailure);
                    return;
                }
                // start the update
                this.downloadState = FWDownloadState.PaySize;
                yield this.doDownload();
            }
            catch (ex) {
                log3.error("updateFirmware: error during update:", ex);
                yield this.updateFWUpdateState(VEXFWUpdateStatus.CommunicationFailure);
            }
        });
    }
    updateFirmwareOneStick(firmwareType) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.debug("updateFirmwareOneStick");
            //detect if device is in Bootload
            let isServiceAvailableOAD = false;
            let isServiceAvailableReset = false;
            if (this.services) {
                for (let i = 0; i < this.services.length; i++) {
                    if (this.services[i].uuid == BLEServiceID.OAD) {
                        isServiceAvailableOAD = true;
                    }
                    if (this.services[i].uuid == BLEServiceID.OneStickReset) {
                        isServiceAvailableReset = true;
                    }
                }
            }
            log3.debug("isServiceAvailableOAD: ", isServiceAvailableOAD);
            log3.debug("isServiceAvailableReset: ", isServiceAvailableReset);
            if ((this.deviceInfo.deviceMode == VEXDeviceMode.Update) || (!isServiceAvailableReset && isServiceAvailableOAD)) {
                log3.debug("Device is in bootload. Continue with update...");
                this.enableAutoConnect = true;
            }
            else {
                log3.debug("Device is not in bootload");
                log3.debug("entering bootload...");
                this.autoUpdateOnBootLoad = true;
                yield this.bootloadOneStick();
                return;
            }
            if (!this.characteristics[BLECharacteristicsID.OADImageCtrl] ||
                !this.characteristics[BLECharacteristicsID.OADImageID] ||
                !this.characteristics[BLECharacteristicsID.OADImageBlock]) {
                log3.error("device does not support updating from browser or communication failure!");
                this.updateFWUpdateState(VEXFWUpdateStatus.CommunicationFailure);
                return;
            }
            // fetch the latest version one more time from server or local
            yield this.pullLatestFirmwareVersion(this.firmwareType);
            // double check device and image version and update the deviceinfo
            if (this.firmwareVersionRemote && (!this.firmwareVersionRemote.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionRemote);
            }
            else if (this.firmwareVersionLocal && (!this.firmwareVersionLocal.isEmpty())) {
                this.deviceInfo.updateNeeded = this.deviceInfo.appVersion.isLessThan(this.firmwareVersionLocal);
            }
            //continue with update
            this.updateConnectionState(BrainConnectionState.UpdatingFirmware);
            yield this.delay(3000);
            let image = undefined;
            image = yield this.firmware.getImageFromServer(firmwareType);
            log3.debug("downloaded vexosfrom server:", image);
            if (!image) {
                image = yield this.firmware.getImageFromLocalFile(firmwareType, "Binary");
                log3.debug("loaded vexos from local file:", image);
            }
            if (!image) {
                log3.info("could not get latest image from server and local");
                this.updateFWUpdateState(VEXFWUpdateStatus.FileNotFound);
                return;
            }
            log3.debug("image: ", image);
            let imageData = new Uint8Array(image);
            log3.debug("image len: ", imageData.length);
            let datalen = imageData.byteLength;
            let datarem = datalen;
            let dataoff = 0;
            // local functions
            let bleSendCtlData = (data) => __awaiter(this, void 0, void 0, function* () {
                if (this.characteristics[BLECharacteristicsID.OADImageCtrl] === undefined)
                    return;
                this.OneStickNotify = false;
                yield this.writeVlaueToCharacteristic(this.characteristics[BLECharacteristicsID.OADImageCtrl], data);
            });
            let bleSendIdentData = (data) => __awaiter(this, void 0, void 0, function* () {
                if (this.characteristics[BLECharacteristicsID.OADImageID] === undefined)
                    return;
                this.OneStickNotify = false;
                yield this.writeVlaueToCharacteristic(this.characteristics[BLECharacteristicsID.OADImageID], data);
            });
            let bleSendWriteData = (data) => __awaiter(this, void 0, void 0, function* () {
                if (this.characteristics[BLECharacteristicsID.OADImageBlock] === undefined)
                    return;
                this.OneStickNotify = false;
                yield this.writeVlaueToCharacteristic(this.characteristics[BLECharacteristicsID.OADImageBlock], data);
            });
            // send one block of data to onestick
            let send_block = (blknum) => __awaiter(this, void 0, void 0, function* () {
                let dvb = new DataView(datablock.buffer, 0);
                dvb.setUint32(0, blknum, true);
                let len = (datarem >= (datablock.byteLength - OneStickOADState.OAD_WRITE_BLOCK_HEAD_SZ)) ? (datablock.byteLength - OneStickOADState.OAD_WRITE_BLOCK_HEAD_SZ) : datarem;
                let block = imageData.slice(dataoff, dataoff + len);
                datablock.set(block, OneStickOADState.OAD_WRITE_BLOCK_HEAD_SZ);
                //ble.printBuffer(datablock, 12);
                datarem -= len;
                dataoff += len;
                return yield this.bleSendDataAsync(bleSendWriteData, (len == (OneStickOADState.OAD_WRITE_BLOCK_SZ - OneStickOADState.OAD_WRITE_BLOCK_HEAD_SZ) ? datablock : datablock.slice(0, len + OneStickOADState.OAD_WRITE_BLOCK_HEAD_SZ)));
            });
            // starting update
            let get_sw = new Uint8Array([OneStickOADState.OAD_REQ_GET_SW_VER]);
            let get_bs = new Uint8Array([OneStickOADState.OAD_REQ_GET_BLK_SZ]);
            let start_oad = new Uint8Array([OneStickOADState.OAD_EVT_START_OAD]);
            let datablock = new Uint8Array(OneStickOADState.OAD_WRITE_BLOCK_SZ);
            let end_oad = new Uint8Array([OneStickOADState.OAD_EVT_ENABLE_IMG]);
            let ident = new Uint8Array([0x3d, 0xb8, 0xf3, 0x96, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0xa0, 0x04, 0x00, 0x00, 0x00]);
            let ret = undefined;
            log3.debug("Initialize transfer: " + datalen + " bytes");
            // software version
            ret = yield this.bleSendDataAsync(bleSendCtlData, get_sw);
            // dont really care about sw version
            if (ret.getUint8(0) === OneStickOADState.OAD_REQ_GET_SW_VER) {
                // version is probably all 0xFF as main app erased it's header
                this.printBuffer(new Uint8Array(ret.buffer), undefined, "SW Version");
            }
            // get blocksize
            ret = yield this.bleSendDataAsync(bleSendCtlData, get_bs);
            // blocksize check, should really use this but it's fixed in the code
            if (ret.getUint8(0) === OneStickOADState.OAD_REQ_GET_BLK_SZ) {
                if (ret.getUint16(1, true) != OneStickOADState.OAD_WRITE_BLOCK_SZ) {
                    log3.error("unexpected write block size");
                    return;
                }
            }
            // send the identify data
            ret = yield this.bleSendDataAsync(bleSendIdentData, ident);
            // all good ?
            if (ret.getUint8(0) != OneStickOADState.OAD_PROFILE_SUCCESS) {
                log3.error("identify error");
                return;
            }
            // send start oad
            ret = yield this.bleSendDataAsync(bleSendCtlData, start_oad);
            // first block request ok ?
            if ((ret.getUint8(0) == OneStickOADState.OAD_RSP_BLK_RSP_NOTIF) && (ret.getUint8(1) == OneStickOADState.OAD_PROFILE_SUCCESS)) {
                // keep sending data
                while (ret.getUint8(0) == OneStickOADState.OAD_RSP_BLK_RSP_NOTIF) {
                    if (datarem == 0) {
                        this.updateFWUpdateProgress(100);
                        ret = yield this.bleSendDataAsync(bleSendCtlData, end_oad);
                        break;
                    }
                    // requested blocknum
                    let blknum = ret.getUint32(2, true);
                    //log3.debug('Sending Block: ' + blknum)
                    //log3.debug('dataOff: ', dataoff, '  dataRem: ', datarem);
                    //round and calculate the percentage
                    let progress = Math.round((dataoff / imageData.length) * 100);
                    log3.debug(`Sending Block: ${blknum}  Done %: ${progress}`);
                    this.updateFWUpdateProgress(progress);
                    ret = yield send_block(blknum);
                    // no retries in this version
                    if ((ret.getUint8(1) != OneStickOADState.OAD_PROFILE_SUCCESS) && (ret.getUint8(1) != OneStickOADState.OAD_PROFILE_DL_COMPLETE)) {
                        log3.error('write block error');
                        return;
                    }
                }
            }
        });
    }
    writeVlaueToCharacteristic(characteristic, value) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield writeCharacteristicValue(characteristic, value);
            }
            catch (ex) {
                log3.error("writeVlaueToCharacteristic: ", ex);
                this.delay(500);
                yield writeCharacteristicValue(characteristic, value);
            }
        });
    }
    bleSendDataAsync(fun, data) {
        return __awaiter(this, void 0, void 0, function* () {
            fun(data);
            for (let i = 0; i < 100; i++) {
                yield this.delay(20);
                if (this.OneStickNotify === true) {
                    return (this.OneStickNotifiedData);
                }
            }
            return (undefined);
        });
    }
    executeSingleCommand(cmd) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.debug("executeSingleCommand: ", cmd);
            if (cmd.length > 0) {
                let byteCommand = 0;
                try {
                    byteCommand = scriptLineToCommand(cmd);
                }
                catch (ex) {
                    byteCommand = 0;
                    log3.error("invalid command: ", ex);
                }
                if (byteCommand !== 0) {
                    yield this.sendExecuteSingleCommand(byteCommand);
                }
            }
        });
    }
    executeSingleCommandAIM(cmd, uuid) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.debug("executeSingleCommandAIM: ", cmd, "uuid: ", uuid);
            try {
                if (cmd) {
                    let cmdToSend = scriptLineToCommandAIM(cmd, uuid);
                    let result = yield this.sendExecuteSingleCommandAIM(cmdToSend);
                }
            }
            catch (ex) {
                log3.error("invalid command: ", ex);
            }
        });
    }
    executeMutlipleCommands(commands) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.debug("executeMutlipleCommands: ", commands);
            const byteCmdArr = [];
            for (let i = 0; i < commands.length; i++) {
                if (commands[i].length > 0) {
                    let byteCommand = 0;
                    try {
                        byteCommand = scriptLineToCommand(commands[i]);
                    }
                    catch (ex) {
                        byteCommand = 0;
                        log3.error("invalid command: ", ex);
                    }
                    if (byteCommand !== 0) {
                        byteCmdArr.push(byteCommand);
                    }
                }
            }
            if (byteCmdArr.length > 0) {
                yield this.sendExecuteMultiCommand(byteCmdArr);
            }
        });
    }
    // Controller functions
    /**
     * Sends command to save the current controll settings for button commands and robot config
     * When the the robot reboots it will remember these settings once commanded into the "Control" config preset
     */
    saveControlSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected() && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                const value = new Uint8Array([ProgramConst.PROG_CMD_SAVE_CONTROL_CONFIG_CMD]);
                try {
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
                }
                catch (ex) {
                    yield this.delay(200);
                    log3.debug("saveControlSettings: ", ex);
                    log3.debug("saveControlSettingss: ", "Retry...");
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
                }
            }
        });
    }
    /**
     * Starts/Stops timer to send controller updates to the robot.
     * @param enable true to start the game timer. false to stop it.
     * @param updateRate Controls update interval in seconds. Default = 0.050
     */
    controllerEnable(enable, updateRate = 0.050) {
        this.controllerUpdateInterval = updateRate < 0.020 ? 0.050 : updateRate;
        if (enable) {
            //TODO:
            if (!this.isControllerUpdateRunning) {
                //restart the update loop
                this.controllerLoopRun();
            }
        }
        else {
            this.controllerLoopStop();
        }
    }
    controllerIsEnabled() {
        return this.isControllerUpdateRunning;
    }
    /**
     * Sets the stick values to be sent on the next controls udpate
     * @param leftX Left Stick X value (0 to 255). 127 == stop
     * @param leftY Left Stick Y value (0 to 255). 127 == stop
     * @param rightX Right Stick X value (0 to 255). 127 == stop
     * @param rightY Right Stick Y value (0 to 255). 127 == stop
     */
    controllerSetStickValues(leftX = 127, leftY = 127, rightX = 127, rightY = 127) {
        this.currentControlValues.leftX = leftX;
        this.currentControlValues.leftY = leftY;
        this.currentControlValues.rightX = rightX;
        this.currentControlValues.rightY = rightY;
    }
    /**
     * Sets the button values to be sent on the next controls udpate
     * @param buttonID button id to update
     * @param pressed button state
     */
    controllerSetButonValue(buttonID, pressed) {
        if (buttonID < 8) {
            if (pressed) {
                this.currentControlValues.Buttons1 |= (1 << buttonID);
            }
            else {
                this.currentControlValues.Buttons1 &= ~(1 << buttonID);
            }
        }
        else if (buttonID < 16) {
            if (pressed) {
                this.currentControlValues.Buttons2 |= (1 << (buttonID - 8));
            }
            else {
                this.currentControlValues.Buttons2 &= ~(1 << (buttonID - 8));
            }
        }
    }
    /**
    * Sets all controll values to their default value (sticks are neutral and buttons are released)
    */
    controllerClearValues() {
        this.currentControlValues.Buttons1 = 0;
        this.currentControlValues.Buttons2 = 0;
        this.currentControlValues.leftX = 127;
        this.currentControlValues.leftY = 127;
        this.currentControlValues.rightX = 127;
        this.currentControlValues.rightY = 127;
    }
    /**
     * Convieniance method for setting up button commands. This method will attempt to parse the string for the command and pass the 4 byte value to the base class to send to the robot.
     * @param command Command string
     * @param buttonID Button ID
     * @param pressed Buttons state that this command is connected to
     */
    controllerAddButtonCommand(command, buttonID, pressed) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected()) {
                try {
                    let cmd = scriptLineToCommand(command);
                    yield this.setControlButtonCommand(buttonID, pressed, cmd);
                    return true;
                }
                catch (error) {
                    log3.debug("controllerAddButtonCommand: ", error);
                    return false;
                }
            }
            return false;
        });
    }
    /**
     * Send Controller updates
     */
    async controllerUpdate() {
        if (this.isConnected()) {
            await this.setControlControlValues(this.currentControlValues.leftX, this.currentControlValues.leftY, this.currentControlValues.rightX, this.currentControlValues.rightY, this.currentControlValues.Buttons1, this.currentControlValues.Buttons2);
        }
    }
    /**
     * In Go firmware app1.0.3 BL1.1.3 and newer the device ID changed in the advertisement data.
     * This may cause issues when updating older versions of firmware with new BLs.
     * This function will compare two ids for both the old ID format and the new.
     * Once a brain is fully up to date this function is not really needed.
     */
    CheckAlternateID(deviceID, searchID) {
        return (deviceID == (searchID & 0xFF00FFFF));
    }
    async setRobotConfigPreset(config) {
        log3.debug("setRobotConfigPreset: ", config);
        if (this.isConnected() && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
            const value = new Uint8Array([ProgramConst.PROG_CMD_SET_BOT_CONFIG_PRESET, config]);
            await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
        }
    }
    async setPortConfig(portNum, devType, flags = VEXPortConfigFlags.FLAG_ENABLED, iLimitPct = 50, iLimitMax = 1000, Accel_value = 1, Dft_Vel = 50) {
        if (this.connectionState === BrainConnectionState.Connected && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
            let value = new Uint8Array();
            try {
                const settings = uint16ToByteArray(iLimitMax);
                value = new Uint8Array([ProgramConst.PROG_CMD_SET_PORT_CONFIG, portNum, devType, flags, settings[0], settings[1], iLimitPct, Accel_value, Dft_Vel]);
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
            }
            catch (ex) {
                this.delay(500);
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
            }
        }
    }
    async requestRobotConfig() {
        if (this.isConnected() && this.characteristics[BLECharacteristicsID.ProgramBotConfig]) {
            const value = await readCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramBotConfig]);
            // TODO: The config will be received through notification - needs callback
        }
    }
    // public showBrainsInBootloadOnly(show: boolean) {
    //     this.showBrainsInBootload = show;
    // }
    /**
     * Returns the version of the latest firmware available on the cloud
     * If server not reachable, returns the local version packed with the application
     * return 0.0.0.b0 on failure to get both.
     */
    getLatestFirmwareVersion(firmwareType = VEXFirmwareType.Release) {
        return __awaiter(this, void 0, void 0, function* () {
            if (firmwareType === undefined) {
                firmwareType = this.firmwareType;
            }
            else {
                this.firmwareType = firmwareType;
            }
            // pull the catelog from server or local depending on the connectivity
            yield this.pullLatestFirmwareVersion(firmwareType);
            if (!this.firmwareVersionRemote.isEmpty()) {
                return this.firmwareVersionRemote;
            }
            else if (this.firmwareVersionLocal && !this.firmwareVersionLocal.isEmpty()) {
                return this.firmwareVersionLocal;
            }
            return VEXFirmwareVersion.getEmpty();
        });
    }
    /**
     * Returns the version of the latest bootloader available on the cloud
     * If server not reachable, returns the local version packed with the application
     * return 0.0.0.b0 on failure to get both.
     */
    getLatestBootLoaderVersion() {
        return __awaiter(this, void 0, void 0, function* () {
            // pull the catelog from server or local depending on the connectivity
            yield this.pullLatestFirmwareVersion(VEXFirmwareType.Bootloader);
            if (!this.bootLoaderVersionRemote.isEmpty()) {
                return this.bootLoaderVersionRemote;
            }
            else if (!this.bootLoaderVersionLocal.isEmpty()) {
                return this.bootLoaderVersionLocal;
            }
            return VEXFirmwareVersion.getEmpty();
        });
    }
    /**
     * Returns the version of firmware on the device
     */
    getDeviceFirmwareVersion() {
        if (this.isConnected()) {
            return this.deviceInfo.appVersion;
        }
        return VEXFirmwareVersion.getEmpty();
    }
    /**
     * Returns the version of firmware on the device
     */
    // public getDeviceBootloaderVersion() {
    //     if (this.isConnected()) {
    //         return this.deviceInfo.bootVersion;
    //     }
    //     return VEXFirmwareVersion.getEmpty();
    // }
    /**
     * Return bootloader version from device
     */
    // not used
    getDeviceBootloaderVersion() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected() && this.characteristics[BLECharacteristicsID.DevInfoFirmware]) {
                const data = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.DevInfoFirmware]);
                // This data comes across as a string but we can parse it
                // format is "#.#.#.B#"
                if (data.byteLength > 7) {
                    this.deviceInfo.bootVersion = new VEXFirmwareVersion(data.getUint8(0) - 0x30, data.getUint8(2) - 0x30, data.getUint8(4) - 0x30, data.getUint8(7) - 0x30);
                }
                if (!this.deviceInfo.bootVersion.isEmpty()) {
                    this.deviceInfo.supportFWUpdate = this.deviceInfo.checkFWUpdateSupported();
                }
                return this.deviceInfo.bootVersion;
            }
            return VEXFirmwareVersion.getEmpty();
        });
    }
    IsFWUpdateSupported() {
        return __awaiter(this, void 0, void 0, function* () {
            //pull the bootloader version from brain
            yield this.getDeviceBootloaderVersion();
            if (this.productType == VEXProductTypes.VEXAIM) {
                this.deviceInfo.supportFWUpdate = false;
            }
            if (this.productType == VEXProductTypes.VEXIQ2Brain) {
                this.deviceInfo.supportFWUpdate = false;
            }
            if (this.productType == VEXProductTypes.VEXEXPBrain) {
                this.deviceInfo.supportFWUpdate = false;
            }
            //TODO: check for the bootloader version and decide if the device supports FW update
            //TODO: if there is no way to read BL version, check for reset service availability, if not available dnt allow update
            // for now allowing fw update with any bootloader version
            if (this.productType == VEXProductTypes.OneStickController) {
                this.deviceInfo.supportFWUpdate = true;
            }
            return this.deviceInfo.supportFWUpdate;
        });
    }
    CanUpdateBootloader() {
        if (this.isConnected() &&
            this.characteristics[BLECharacteristicsID.OADImageCtrl] &&
            this.deviceInfo.deviceMode !== VEXDeviceMode.Update) {
            return true;
        }
        return false;
    }
    /**
     * Have the robot perform an action to help locate it.
     * @param durationSec how long the brain led blinks in 123 or GO. In AIM duration is not used.
     */
    LocateRobot(durationSec = 2) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.connectionState === BrainConnectionState.Connected) {
                if (this.productType == VEXProductTypes.VEXIQ2Brain) {
                    log3.error("LocateRobot: VEX IQ 2 Brain does not support locate robot command");
                    return;
                }
                if (this.productType == VEXProductTypes.VEXEXPBrain) {
                    log3.error("LocateRobot: VEX EXP Brain does not support locate robot command");
                    return;
                }
                if (this.productType == VEXProductTypes.VEXAIM) {
                    if (this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand]) {
                        const value = new Uint8Array(2);
                        value[0] = ProgramConst.PROG_CMD_LOCATE;
                        value[1] = durationSec;
                        yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand], value);
                    }
                }
                else {
                    if (this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                        const value = new Uint8Array(2);
                        value[0] = ProgramConst.PROG_CMD_LOCATE;
                        value[1] = durationSec;
                        yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
                    }
                }
            }
        });
    }
    /**
     * This will request the devices current connection interval. Value will be returned in the ack data callback.
     */
    RequestConnectionInterval() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.connectionState === BrainConnectionState.Connected && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                const value = new Uint8Array(1);
                value[0] = ProgramConst.PROG_CMD_GET_CONN_INT;
                yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
            }
        });
    }
    /**
     * Send new user settings to 123 robot device. Status is returned in the didUpdateUserSettings callback
     * @param idleTimeout Coder will sleep after this many ms if not connected and no buttons have been pressed
     * @param soundVolume
     * @param persist If true these settings will be saved in flash else these settings will only persist until reboot. (In th case of the encoder this means batteries are removed.)
     */
    Set123RobotUserSettings(idleTimeout, soundVolume, persist) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.connectionState === BrainConnectionState.Connected && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                const timeoutBytes = uint32ToByteArray(idleTimeout);
                const commandBuffer = new Uint8Array(10);
                commandBuffer[0] = ProgramConst.PROG_CMD_SET_USER_SETTINGS;
                commandBuffer[1] = new UInt8(persist ? 1 : 0).Get();
                commandBuffer[2] = new UInt8(1).Get();
                commandBuffer[3] = soundVolume;
                commandBuffer[4] = new UInt8(0).Get();
                commandBuffer[5] = new UInt8(0).Get();
                commandBuffer[6] = timeoutBytes[0];
                commandBuffer[7] = timeoutBytes[1];
                commandBuffer[8] = timeoutBytes[2];
                commandBuffer[9] = timeoutBytes[3];
                if (this.Current123RobotUserSettings == undefined) {
                    this.Current123RobotUserSettings = new VEX123RobotUserSettings();
                }
                this.Current123RobotUserSettings.IdleTimeout = idleTimeout;
                this.Current123RobotUserSettings.SoundVolume = soundVolume;
                try {
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
                }
                catch (ex) {
                    yield this.delay(200);
                    log3.debug("Set123RobotUserSettings: ", ex);
                    log3.debug("Set123RobotUserSettings: ", "Retry...");
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
                }
            }
        });
    }
    /**
     * Send a command to read the current user setting from the 123 Robot
     *  Status is returned in the didUpdateUserSettings callback
     */
    Get123RobotUserSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.connectionState === BrainConnectionState.Connected && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                const value = new Uint8Array(1);
                value[0] = ProgramConst.PROG_CMD_GET_USER_SETTINGS;
                try {
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
                }
                catch (ex) {
                    yield this.delay(200);
                    log3.debug("Get123UserSettings: ", ex);
                    log3.debug("Get123UserSettings: ", "Retry...");
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
                }
            }
        });
    }
    /**
     * Returns program command status subscription state.
     * Returns true if we have subscribed to this status.
     */
    isProgramCommandStatusEnabled() {
        return this.subscribeProgramCommandStatus;
    }
    /**
     * Returns program sensor status subscription state.
     * Returns true if we have subscribed to this status.
     */
    isProgramSensorStatusEnabled() {
        return this.subscribeProgramSensorStatus;
    }
    /**
     * Returns program port command status subscription state
     * Returns true if we have subscribed to this status.
     */
    isProgramPortCommandStatusEnabled() {
        return this.subscribeProgramPortCommandStatus;
    }
    /**
     * Returns device log subscription state
     * Returns true if we have subscribed to this status.
     */
    isDeviceLogServiceEnabled() {
        return this.subscribeDeviceLogService;
    }
    /**
     * Subscribe/Unsubscribe to Program status
     * @param enable true to start robot status update. false, to stop them
     */
    enableProgramCommandStatus(enable) {
        try {
            this.subscribeProgramCommandStatus = enable;
            if (this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                if (this.subscribeProgramCommandStatus) {
                    startCharacteristicNotifications(this.characteristics[BLECharacteristicsID.ProgramCommand]);
                }
                else {
                    stopCharacteristicNotifications(this.characteristics[BLECharacteristicsID.ProgramCommand]);
                }
            }
        }
        catch (ex) {
            log3.error("enableProgramCommandStatus: ", ex);
        }
    }
    /**
     * Subscribe/Unsubscribe to sensor status
     * @param enable true to start robot status update. false, to stop them
     */
    enableProgramSensorStatus(enable) {
        try {
            this.subscribeProgramSensorStatus = enable;
            if (this.characteristics[BLECharacteristicsID.ProgramSensorStatus]) {
                if (this.subscribeProgramSensorStatus) {
                    startCharacteristicNotifications(this.characteristics[BLECharacteristicsID.ProgramSensorStatus]);
                }
                else {
                    stopCharacteristicNotifications(this.characteristics[BLECharacteristicsID.ProgramSensorStatus]);
                }
            }
        }
        catch (ex) {
            log3.error("enableProgramSensorStatus: ", ex);
        }
    }
    /**
     * Subscribe/Unsubscribe to port command status
     * @param enable true to start robot status update. false, to stop them
     */
    enableProgramPortCmdStatus(enable) {
        try {
            this.subscribeProgramPortCommandStatus = enable;
            if (this.characteristics[BLECharacteristicsID.ProgramPortCmdStatus]) {
                if (this.subscribeProgramPortCommandStatus) {
                    startCharacteristicNotifications(this.characteristics[BLECharacteristicsID.ProgramPortCmdStatus]);
                }
                else {
                    stopCharacteristicNotifications(this.characteristics[BLECharacteristicsID.ProgramPortCmdStatus]);
                }
            }
        }
        catch (ex) {
            log3.error("enableProgramPortCmdStatus : ", ex);
        }
    }
    /**
     * Subscribe/Unsubscribe to log from brain
     * @param enable true to start log feed. false, to stop them
     */
    enableDeviceInfoLogService(enable) {
        try {
            this.subscribeDeviceLogService = enable;
            if (this.characteristics[BLECharacteristicsID.DevInfoLog]) {
                if (this.subscribeDeviceLogService) {
                    startCharacteristicNotifications(this.characteristics[BLECharacteristicsID.DevInfoLog]);
                }
                else {
                    stopCharacteristicNotifications(this.characteristics[BLECharacteristicsID.DevInfoLog]);
                }
            }
        }
        catch (ex) {
            log3.error("enableDeviceInfoLogService : ", ex);
        }
    }
    /**
     * Subscribe/Unsubscribe to firmware update services
     * @param enable true to start robot status update. false, to stop them
     */
    enableFirmwareUpdateService(enable) {
        try {
            this.subscribeFirmwareUpodateService = enable;
            if (this.characteristics[BLECharacteristicsID.OADImageID]) {
                if (this.subscribeFirmwareUpodateService) {
                    startCharacteristicNotifications(this.characteristics[BLECharacteristicsID.OADImageID]);
                }
                else {
                    stopCharacteristicNotifications(this.characteristics[BLECharacteristicsID.OADImageID]);
                }
            }
            if (this.characteristics[BLECharacteristicsID.OADImageBlock]) {
                if (this.subscribeFirmwareUpodateService) {
                    startCharacteristicNotifications(this.characteristics[BLECharacteristicsID.OADImageBlock]);
                }
                else {
                    stopCharacteristicNotifications(this.characteristics[BLECharacteristicsID.OADImageBlock]);
                }
            }
            if (this.characteristics[BLECharacteristicsID.OADImageCtrl]) {
                if (this.subscribeFirmwareUpodateService) {
                    startCharacteristicNotifications(this.characteristics[BLECharacteristicsID.OADImageCtrl]);
                }
                else {
                    stopCharacteristicNotifications(this.characteristics[BLECharacteristicsID.OADImageCtrl]);
                }
            }
        }
        catch (ex) {
            log3.error("enableFirmwareUpdateService : ", ex);
        }
    }
    //This is AIM/IQ/V5/EXP admin channel services
    enableAdminService(enable) {
        try {
            this.subscribeAdminService = enable;
            const characteristics = [
                this.characteristics[BLECharacteristicsID.AIMTXData],
                this.characteristics[BLECharacteristicsID.AIMTXUser]
            ];
            for (const characteristic of characteristics) {
                if (characteristic) {
                    if (this.subscribeAdminService) {
                        startCharacteristicNotifications(characteristic);
                    }
                    else {
                        stopCharacteristicNotifications(characteristic);
                    }
                }
            }
        }
        catch (ex) {
            log3.error("enableAdminService : ", ex);
        }
    }
    enableAIMRemoteControlService(enable) {
        try {
            this.subscribeRemoteControlService = enable;
            const characteristics = [
                this.characteristics[BLECharacteristicsID.AIMRemoteControlStatus],
                this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand],
                this.characteristics[BLECharacteristicsID.AIMRemoteControlAIStatus]
            ];
            for (const characteristic of characteristics) {
                if (characteristic) {
                    if (this.subscribeRemoteControlService) {
                        startCharacteristicNotifications(characteristic);
                    }
                    else {
                        stopCharacteristicNotifications(characteristic);
                    }
                }
            }
        }
        catch (ex) {
            log3.error("enableRemoteControlService : ", ex);
        }
    }
    getCommandNameFromID(command) {
        return getStringForCommandID(command);
    }
    /**
     * This will will clear all events for the passed in port
     * @param portID Port to clear events on.
     */
    clearPortEvents(portID) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected() && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                const value = new Uint8Array(2);
                value[0] = ProgramConst.PROG_CMD_CLEAR_PORT_EVENTS;
                value[1] = portID;
                try {
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
                }
                catch (ex) {
                    yield this.delay(200);
                    log3.debug("clearPortEvents: ", ex);
                    log3.debug("clearPortEvents: ", "Retry...");
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
                }
            }
        });
    }
    SetRobotName(newName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected()) {
                const uin8ArrayOfName = new TextEncoder().encode(newName);
                const byteArray = new Uint8Array([ProgramConst.PROG_CMD_SET_BOT_NAME, uin8ArrayOfName.byteLength]);
                const arraybuff = this.appendArrayBuffer(byteArray.buffer, uin8ArrayOfName);
                const value = new Uint8Array(arraybuff);
                if (this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
                }
            }
        });
    }
    SetSensorMode(newMode) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected() && this.characteristics[BLECharacteristicsID.SensorGryoCMD]) {
                let value = new Uint8Array();
                try {
                    value = new Uint8Array([SensorConst.CMD_SET_SENSOR_MODE, newMode]);
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.SensorGryoCMD], value);
                }
                catch (ex) {
                    this.delay(500);
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.SensorGryoCMD], value);
                }
            }
        });
    }
    /**
     *  Reads the firmware version from the brain through the CDC2 service using admin channel
     * @returns
     */
    BrainGetSystemVersion() {
        return __awaiter(this, void 0, void 0, function* () {
            log3.info("brainGetSystemVersion");
            try {
                const reply = yield this.WriteDataAsync(this.cdc.systemVersion());
                let version = this.decodeSystemVersion(reply);
                log3.debug(version);
                return version;
            }
            catch (err) {
                if (err instanceof ErrorGATT) {
                    throw err;
                }
                return undefined;
            }
        });
    }
    /**
    * Get the robot system status
    */
    BrainGetSystemStatus() {
        return __awaiter(this, void 0, void 0, function* () {
            log3.debug("brainGetSystemStatus");
            let uniqueId = 0;
            return new Promise((resolve, reject) => {
                this.WriteDataAsync(this.cdc.V5_Cdc2SystemStatus())
                    .then((reply) => {
                    let status = this.decodeSysStatusRead(reply);
                    resolve(status);
                })
                    .catch((err) => {
                    if (err instanceof ErrorGATT) {
                        reject(err);
                        return;
                    }
                    // perhaps we don't support this yet
                    resolve(undefined);
                });
            });
        });
    }
    /**
     * Sends the lock code to the device
     * @param code
     * @returns true if the device is unlocked
     */
    SendLockCode(code) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.debug("SendLockCode", code);
            //convert radio id to hex
            let radioIdHex = ((code / 1000) << 24) +
                (((code / 100) % 10) << 16) +
                (((code / 10) % 10) << 8) +
                (((code) % 10)) >>> 0;
            let buf = new ArrayBuffer(4);
            let dvb = new DataView(buf);
            dvb.setUint32(0, radioIdHex);
            yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMCode], buf);
            yield this.delay(500);
            let dv = yield readCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMCode]);
            let codevalue = dv.getUint32(0);
            log3.debug('received code is ' + this.cdc.hex8(codevalue));
            let unlocked = codevalue == radioIdHex;
            if (unlocked) {
                this.deviceInfo.unlocked = true;
                yield this.delay(200);
                yield this.updateDeviceInfoOnConnect();
            }
            log3.debug("device unlocked: ", unlocked);
            return unlocked;
        });
    }
    ShowLockCodeOnBrain(show) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.debug("ShowLockCodeOnBrain", show);
            let buf = new ArrayBuffer(4);
            let dvb = new DataView(buf);
            if (show) {
                dvb.setUint32(0, 0xffffffff);
            }
            else {
                dvb.setUint32(0, 0x00000000);
            }
            yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMCode], buf);
        });
    }
    /**
    *  Downloads the program to the device
    * @param slot  The slot number of the project to run. 0 indexed.
    * @param projectName  The name of the project
    * @param language (only "python" is supported)
    * @param data  The program data to download
    * @param progressCallback  The callback to receive download progress updates
    * @param ide  "Blocks" or "Python"
    * @returns
    */
    downloadProgram(slot, projectName, language, data, progressCallback, ide) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.info("downloadProgram", slot, projectName, language);
            const icon = ide == "Blocks" ? VEXcodeIcons.VEXcodeBlocks : (language == "cpp" ? VEXcodeIcons.VEXcodeCPP : VEXcodeIcons.VEXcodePython);
            const programInfo = {
                slot,
                name: projectName,
                description: "",
                icon,
                ide,
                ports: [],
                triports: [],
                controller1: null,
                controller2: null,
                language,
            };
            log3.debug("stopping current project on the brain");
            yield this.Stop();
            return this.vexCDCDevice.downloadProgram(data, programInfo, (downloadData) => {
                const { progress, state } = downloadData;
                progressCallback({ progress, step: state });
            });
        });
    }
    checkAndInstallPythonVm(crc, version, progressCallback, force = false) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.info("checkAndInstallPythonVm", crc, version);
            return this.vexCDCDevice.checkAndInstallPythonVm(crc, version, progressCallback, force);
        });
    }
    /**
     * Returns a list of all the image file info on the robot
     * @returns  array of image file meta data in IFileMetadata[]
     */
    listImageFilesAIM() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                log3.info("listImageFilesAIM");
                const files = yield this.vexCDCDevice.getDirectory(VEXCDCDevice.VID.AIM_IMAGE);
                return files.map((file) => {
                    return {
                        name: file.name,
                        size: file.size,
                    };
                });
            }
            catch (err) {
                log3.error("error listImageFilesAIM: ", err);
            }
        });
    }
    /***
     * Downloads the image file to the AIM
     * @param filename the name of the file to download
     * @param data the image data to download
     * @param progress the progress callback
     * @returns true if the download was successful
     */
    downloadImageFileAIM(filename, data, progress) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.info("downloadImageFileAIM", filename);
            try {
                const fileData = (data instanceof ArrayBuffer) ? new Uint8Array(data) : data;
                return this.vexCDCDevice.saveFileToRobot(filename, fileData, progress, VEXCDCDevice.VID.AIM_IMAGE);
            }
            catch (ex) {
                log3.error("downloadImageFileAIM: ", ex);
                return false;
            }
        });
    }
    /**
     * Deletes the image file from the AIM
     * @param filename to be deleted from AIM
     * @returns
     */
    deleteImageFileAIM(filename) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                log3.info("deleteImageFileAIM", filename);
                return this.vexCDCDevice.deleteFile(filename, VEXCDCDevice.VID.AIM_IMAGE);
            }
            catch (ex) {
                log3.error("deleteImageFileAIM: ", ex);
                return false;
            }
        });
    }
    /**
     * Reads the image file from the AIM
     * @param filename to be read from AIM
     * @param progressCallback to receive progress updates 0-1
     * @returns
     */
    readImageFileAIM(filename, progressCallback) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                log3.info("readImageFileAIM", filename);
                return this.vexCDCDevice.readFileFromRobot(filename, progressCallback, VEXCDCDevice.VID.AIM_IMAGE);
            }
            catch (ex) {
                log3.error("readImageFileAIM: ", ex);
                return undefined;
            }
        });
    }
    /**
    * Lists all the sound files on the AIM
    * @returns list of sound files meta data
    */
    listSoundFilesAIM() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                log3.info("listSoundFilesAIM");
                const files = yield this.vexCDCDevice.getDirectory(VEXCDCDevice.VID.AIM_SOUND);
                return files.map((file) => {
                    return {
                        name: file.name,
                        size: file.size,
                    };
                });
            }
            catch (err) {
                log3.error("error listSoundFilesAIM: ", err);
            }
        });
    }
    /***
     * Downloads the sound file to the AIM
     * @param filename the name of the file to download
     * @param data  sound data to download
     * @param progress the progress callback
     * @returns true if the download was successful
     */
    downloadSoundFileAIM(filename, data, progress) {
        return __awaiter(this, void 0, void 0, function* () {
            log3.info("downloadSoundFileAIM", filename);
            try {
                const fileData = (data instanceof ArrayBuffer) ? new Uint8Array(data) : data;
                return this.vexCDCDevice.saveFileToRobot(filename, fileData, progress, VEXCDCDevice.VID.AIM_SOUND);
            }
            catch (ex) {
                log3.error("downloadSoundFileAIM: ", ex);
                return false;
            }
        });
    }
    /**
     * Deletes the sound file from the AIM
     * @param filename to be deleted from AIM
     * @returns
     */
    deleteSoundFileAIM(filename) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                log3.info("deleteSoundFile", filename);
                return this.vexCDCDevice.deleteFile(filename, VEXCDCDevice.VID.AIM_SOUND);
            }
            catch (ex) {
                log3.error("deleteSoundFile: ", ex);
                return false;
            }
        });
    }
    /**
     * Reads the sound file from the AIM
     * @param filename to be read from AIM
     * @param progressCallback to receive progress updates 0-1
     * @returns
     */
    readSoundFileAIM(filename, progressCallback) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                log3.info("readSoundFileAIM", filename);
                return this.vexCDCDevice.readFileFromRobot(filename, progressCallback, VEXCDCDevice.VID.AIM_SOUND);
            }
            catch (ex) {
                log3.error("readSoundFileAIM: ", ex);
                return undefined;
            }
        });
    }
    /**
     * capture the screen from the AIM
     * @param progressCallback
     * @returns image in RGB565 format as dataUrl string
     */
    async captureBrainScreenAIM(progressCallback) {
        //screen capture options for AIM
        // this may probable need to be passed from the caller(VEXcode) for different products
        const options = {
            width: 240,
            height: 240,
            bytesPerPixel: 2,
            littleEndian: true,
            // not really sure about the layer. could be -2 or 2
            layer: -2,
            isYUV: false,
        };
        const width = options.width;
        const height = options.height;
        const bytesPerPixel = options.bytesPerPixel;
        try {
            log3.debug("captureBrainScreen");
            let screenData = undefined;
            if (this.isConnected()) {
                screenData = await this.vexCDCDevice.captureScreenData(width * height * bytesPerPixel, progressCallback);
            }
            else {
                log3.error("captureBrainScreen: not connected");
                return undefined;
            }
            // AIM uses RGB565 encoding of the image data
            return (0,convertImageDataRGB565)(screenData, width, height, options.littleEndian);
        }
        catch (err) {
            log3.error("captureBrainScreen: ", err);
        }
    }
    /**
    * this will tell the brain to play the program loaded in the specified slot.
    * @param slot the slot to play. 0 indexed
    * @returns true if the process was a success
    */
    async Play(slot) {
        // 0 index based on brain
        slot = slot < 0 ? 0 : slot;
        slot = slot > 7 ? 7 : slot;
        // We can play a slot using special file name "___s_00.bin" etc.
        let name = '___s_' + ('00' + slot.toString(10)).substr(-2, 2) + '.bin';
        return this.runProgram(name, VEXCDCDevice.VID.USER);
    }
    /**
     * this will tell the brain to run the specified system program slot.
     * @param slot the slot to play. 0 indexed
     * @returns true if the process was a success
     */
    async runSystemProgram(slot) {
        const programName = '___v_' + ('00' + slot.toString(10)).substr(-2, 2);
        return this.runProgram(programName, VEXCDCDevice.VID.SYS);
    }
    /**
     * this will tell the brain to run the specified program.
     * @param program the project name to run. This does not include the .bin extension
     * @param vid the VID to use. This is either VEXCDCDevice.VID.SYS or VEXCDCDevice.VID.USER
     * @returns true if the process was a success
     */
    async runProgram(program, vid) {
        const name = program + '.bin';
        try {
            await this.WriteDataAsync(this.cdc.V5_Cdc2FileLoadAndRun(vid, 0, name));
            return true;
        } catch (err) {
            if (err instanceof ErrorGATT) {
                throw err;
            }
        }
    }
    isProjectRunning() {
        return new Promise((resolve, reject) => {
            this.vexCDCDevice.brainGetSystemFlags()
                .then((flags) => {
                log3.debug("current program:", this.vexCDCDevice.currentProgram.toString(16));
                // 0 - is no project running
                // 1-8 is user projects
                // 145 (0x91) - drive program
                // 10 - button coding
                // 11 - REPL Mode program
                resolve(this.vexCDCDevice.currentProgram);// !== 0);
            })
                .catch(() => {
                reject();
            });
        });
    }
    /**
    * this will tell the brain to stop a running program
    * @returns true if the process was a success
    */
    Stop() {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                this.WriteDataAsync(this.cdc.V5_Cdc2FileLoadAndRun(VEXCDCDevice.VID.USER, VEXCDCDevice.OPTIONS.LOAD_STOP, 'null'))
                    .then(() => {
                    resolve(true);
                })
                    .catch((err) => {
                    if (err instanceof ErrorGATT) {
                        reject(err);
                        return;
                    }
                    reject();
                });
            });
        });
    }
    /**
     *
     * @param buttons the buttons and axis to simulate on the controller
     * This will simulate the controller buttons through CDC service.
     *
     * The buttons state are converted to a bitmask of the buttons pressed.
     * The joystick values are in the range of -1 to 1.  Converted internally to -127 to 127.
     * @returns
     */
    SimulateControllerThroughCDC(buttons) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.isConnected()) {
                    let buttonsAsInt = 0;
                    let lx, ly, rx, ry = 0;
                    if (this.productType == VEXProductTypes.VEXIQ2Brain) {
                        //check if buttons is ControllerButtonStateIQ2
                        buttons = buttons;
                        if (buttons.LU === undefined) {
                            log3.error("SimulateControllerThroughCDC: buttons is not of type ControllerButtonStateIQ2");
                            return;
                        }
                        //set the bits of 16-bit integer to map each button
                        // __ __ __ __ __ SEL R3 L3 RU RD LU LD EU FU ED FD
                        // convert buttons to 16-bit integer using bitwise  operators
                        if (buttons.FD) {
                            buttonsAsInt |= (1 << 0);
                        }
                        if (buttons.ED) {
                            buttonsAsInt |= (1 << 1);
                        }
                        if (buttons.FU) {
                            buttonsAsInt |= (1 << 2);
                        }
                        if (buttons.EU) {
                            buttonsAsInt |= (1 << 3);
                        }
                        if (buttons.LD) {
                            buttonsAsInt |= (1 << 4);
                        }
                        if (buttons.LU) {
                            buttonsAsInt |= (1 << 5);
                        }
                        if (buttons.RD) {
                            buttonsAsInt |= (1 << 6);
                        }
                        if (buttons.RU) {
                            buttonsAsInt |= (1 << 7);
                        }
                        if (buttons.L3) {
                            buttonsAsInt |= (1 << 8);
                        }
                        if (buttons.R3) {
                            buttonsAsInt |= (1 << 9);
                        }
                        // update the range of the joystick values 
                        lx = Math.floor(buttons.leftAxisX * 127);
                        ly = -Math.floor(buttons.leftAxisY * 127);
                        rx = Math.floor(buttons.rightAxisX * 127);
                        ry = -Math.floor(buttons.rightAxisY * 127);
                    }
                    else if (this.productType == VEXProductTypes.VEXAIM) {
                        // Check if buttons is ControllerButtonStateAIMOneStick
                        buttons = buttons;
                        if (buttons.AxisX === undefined) {
                            log3.error("SimulateControllerThroughCDC: buttons is not of type ControllerButtonStateAIMOneStick");
                            return;
                        }
                        if (buttons.UP) {
                            buttonsAsInt |= (1 << 2);
                        }
                        if (buttons.DN) {
                            buttonsAsInt |= (1 << 1);
                        }
                        if (buttons.L) {
                            buttonsAsInt |= (1 << 3);
                        }
                        if (buttons.R) {
                            buttonsAsInt |= (1 << 0);
                        }
                        // Update the range of the joystick values
                        lx = Math.floor(buttons.AxisX * 127);
                        ly = -Math.floor(buttons.AxisY * 127);
                    }
                    else if (this.productType == VEXProductTypes.VEXEXPBrain) {
                        //check if buttons is ControllerButtonStateEXP
                        buttons = buttons;
                        if (buttons.R3 === undefined) {
                            log3.error("SimulateControllerThroughCDC: buttons is not of type ControllerButtonStateEXP");
                            return;
                        }
                        //set the bits of 16-bit integer to map each button
                        // __ __ __ __ __ SEL R3 L3 RU RD LU LD EU FU ED FD
                        // convert buttons to 16-bit integer using bitwise  operators
                        if (buttons.B) {
                            buttonsAsInt |= (1 << 0);
                        }
                        if (buttons.DN) {
                            buttonsAsInt |= (1 << 1);
                        }
                        if (buttons.A) {
                            buttonsAsInt |= (1 << 2);
                        }
                        if (buttons.UP) {
                            buttonsAsInt |= (1 << 3);
                        }
                        if (buttons.L2) {
                            buttonsAsInt |= (1 << 4);
                        }
                        if (buttons.L1) {
                            buttonsAsInt |= (1 << 5);
                        }
                        if (buttons.R2) {
                            buttonsAsInt |= (1 << 6);
                        }
                        if (buttons.R1) {
                            buttonsAsInt |= (1 << 7);
                        }
                        if (buttons.L3) {
                            buttonsAsInt |= (1 << 8);
                        }
                        if (buttons.R3) {
                            buttonsAsInt |= (1 << 9);
                        }
                        // update the range of the joystick values 
                        lx = Math.floor(buttons.leftAxisX * 127);
                        ly = -Math.floor(buttons.leftAxisY * 127);
                        rx = Math.floor(buttons.rightAxisX * 127);
                        ry = -Math.floor(buttons.rightAxisY * 127);
                    }
                    //log3.debug("SimulateControllerThroughCDC: buttonsAsInt:", buttonsAsInt, "lx:", lx, "ly:", ly, "rx:", rx, "ry:", ry);
                    //TODO: add support for VEX EXP and VEX V5
                    let result = yield this.vexCDCDevice.SimulateControllerThroughCDC(buttonsAsInt, lx, ly, rx, ry);
                }
                else {
                    //log3.error("SimulateControllerThroughCDC: not connected");
                    return;
                }
            }
            catch (ex) {
                log3.error("SimulateControllerThroughCDC: ", ex);
            }
        });
    }
    //#endregion
    //#region Private
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.pullLatestFirmwareVersion(this.firmwareType);
            if (this.productType == VEXProductTypes.VEXGO) {
                yield this.pullLatestFirmwareVersion(VEXFirmwareType.Bootloader);
            }
        });
    }
    pullLatestFirmwareVersion(firmwareType) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                let latestVersion = yield this.firmware.getVersionFromServer(firmwareType, this.productType);
                if (firmwareType != VEXFirmwareType.Bootloader) {
                    this.firmwareVersionRemote = latestVersion;
                    log3.info("App firmware version from Server", this.firmwareVersionRemote.getString());
                }
                else {
                    this.bootLoaderVersionRemote = latestVersion;
                    log3.info("bootloader firmware version from Server", this.bootLoaderVersionRemote.getString());
                }
            }
            catch (ex) {
                log3.info("error getting fw version from remote server: ", ex);
            }
            try {
                let latestVersion = yield this.firmware.getVersionFromLocalFile(firmwareType, this.productType);
                if (firmwareType != VEXFirmwareType.Bootloader) {
                    this.firmwareVersionLocal = latestVersion;
                    log3.info("App firmware version from local file", this.firmwareVersionLocal.getString());
                }
                else {
                    this.bootLoaderVersionLocal = latestVersion;
                    log3.info("bootloader firmware version from local file", this.bootLoaderVersionLocal.getString());
                }
            }
            catch (ex) {
                log3.info("error getting fw version from local resources: ", ex);
            }
        });
    }
    updateConnectionState(state) {
        this.connectionState = state;
        EventSystem.fireEvent("VEXBLEBrowser.ConnectionState", this.connectionState);
    }
    updateFWUpdateState(state) {
        return __awaiter(this, void 0, void 0, function* () {
            EventSystem.fireEvent("VEXBLEBrowser.FWUpdateComplete", state);
            if (state !== VEXFWUpdateStatus.Success) {
                if (this.connectionState === BrainConnectionState.UpdatingFirmware || this.connectionState === BrainConnectionState.Connected) {
                    this.updateConnectionState(BrainConnectionState.Connected);
                }
                else {
                    this.updateConnectionState(BrainConnectionState.Disconnected);
                }
            }
            if (state == VEXFWUpdateStatus.Success) {
                if (this.firmwareType === VEXFirmwareType.Bootloader) {
                    this.updateConnectionState(BrainConnectionState.Connected);
                    yield this.getConnectedDeviceInfo();
                    yield this.delay(200);
                    EventSystem.fireEvent("VEXBLEBrowser.DeviceInfo", this.deviceInfo);
                }
            }
            if (state == VEXFWUpdateStatus.CommunicationFailure) {
                this.disconnect(true);
            }
        });
    }
    updateFWUpdateProgress(progress) {
        return __awaiter(this, void 0, void 0, function* () {
            EventSystem.fireEvent("VEXBLEBrowser.FWUpdateProgress", progress);
        });
    }
    autoconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            // this.device = await LocalStorage.load("ble_last_connected_device");
            if (this.device) {
                while (this.enableAutoConnect === true) {
                    try {
                        log3.debug("reconnecting..");
                        yield this.delay(2000);
                        yield this.connect();
                        break;
                    }
                    catch (ex) {
                        log3.error(ex);
                    }
                    yield this.delay(1000);
                }
            }
        });
    }
    scan() {
        return __awaiter(this, void 0, void 0, function* () {
            log3.debug("Scanning..");
            this.updateConnectionState(BrainConnectionState.Scanning);
            let acceptAllDevices = false;
            this.optionalServices = getOptionalServicesFilter(this.productType);
            try {
                if (this.isWaitingToBootload) {
                    this.servicesFilter = [
                        { services: getServicesFilter(this.productType) },
                    ];
                }
                else {
                    this.servicesFilter = [
                        { services: getServicesFilter(this.productType) },
                    ];
                }
                if (this.showAllBLEDevicesNear === true) {
                    this.servicesFilter = undefined;
                    this.optionalServices = undefined;
                    acceptAllDevices = true;
                }
                this.device = yield navigator.bluetooth.requestDevice({
                    filters: this.servicesFilter,
                    optionalServices: this.optionalServices,
                    acceptAllDevices,
                });
                this.device.addEventListener("gattserverdisconnected", this.onDisconnected);
                // await LocalStorage.save("ble_last_connected_device",this.device);
            }
            catch (ex) {
                log3.error(ex);
                this.device = undefined;
                this.updateConnectionState(BrainConnectionState.Disconnected);
                return Promise.reject(ex);
            }
        });
    }
    connect(attempt = 1) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!this.device) {
                    log3.info("device not selected");
                    return;
                }
                log3.debug("*****> connecting to device - webble-gatt-uuid", this.device);
                this.updateConnectionState(BrainConnectionState.Connecting);
                yield this.delay(1000); // needed to reliabliy connect on some chromebooks
                this.server = yield this.device.gatt.connect().catch((e) => {
                    if (e.name === "TimeoutError") {
                        log3.error("device failed to connect - timeout error", e);
                        // e.message = Device failed to connect after X seconds...
                        // Automatically try to reconnect
                        // return this.connect();
                        this.updateConnectionState(BrainConnectionState.Disconnected);
                    }
                    throw e;
                });
                yield this.delay(1000);
                yield this.getServices();
                yield this.getAllCharacteristics();
                yield this.subscribeToCharacteristics();
                if (this.productType == VEXProductTypes.VEXAIM || this.productType == VEXProductTypes.VEXIQ2Brain || this.productType == VEXProductTypes.VEXEXPBrain) {
                    this.deviceInfo.unlocked = false;
                    yield this.getConnectedDeviceInfo();
                    yield this.getLockCode(this.device.id, this.deviceInfo.deviceIDValue);
                }
                else {
                    yield this.updateDeviceInfoOnConnect();
                }
            }
            catch (ex) {
                log3.error("error during connection : ", ex);
                if (attempt && attempt < 6) {
                    log3.info("retrying connection..." + (attempt + 1));
                    yield this.delay(1000); // needed to reliabliy connect on some chromebooks
                    return yield this.connect(attempt + 1);
                }
                else {
                    this.updateConnectionState(BrainConnectionState.Disconnected);
                    if (this.enableAutoConnect === true) {
                        this.enableAutoConnect = false;
                    }
                    return Promise.reject("failed to connect");
                }
            }
        });
    }
    getServices() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.server) {
                log3.info("device not connected");
                return;
            }
            log3.debug("getting services..");
            this.services = yield this.server.getPrimaryServices();
            log3.debug("Available Services:");
            this.printServices(this.services);
        });
    }
    printServices(services) {
        if (services) {
            services.map((service) => {
                const serviceName = Object.keys(BLEServiceID).find((key) => BLEServiceID[key] === service.uuid);
                log3.debug("Service Name: " + serviceName + " / UUID: " + service.uuid);
            });
        }
    }
    printCharacteristics(characteristics) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (characteristics) {
                    yield Promise.all(characteristics.map((characteristic) => __awaiter(this, void 0, void 0, function* () {
                        let charName = Object.keys(BLECharacteristicsID).find((key) => BLECharacteristicsID[key] === characteristic.uuid);
                        if (!charName) {
                            try {
                                let descriptor = yield characteristic.getDescriptor("gatt.characteristic_user_description");
                                if (descriptor) {
                                    let value = yield readCharacteristicValue(descriptor);
                                    charName = (new TextDecoder('utf-8')).decode(value);
                                }
                            }
                            catch (error) {
                                log3.debug("could not get the name of the characteristics. Will not affect anything.just printing..", error);
                            }
                        }
                        log3.debug("Characteristic Name: " + charName + " / UUID: " + characteristic.uuid);
                    })));
                }
            }
            catch (error) {
                log3.error("printCharacteristics", error);
            }
        });
    }
    getService(serviceID) {
        return __awaiter(this, void 0, void 0, function* () {
            let service;
            if (this.services && this.services.length > 0) {
                service = this.services.find((srv) => srv.uuid === serviceID);
            }
            return service;
        });
    }
    getAllCharacteristics() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.services && this.services.length > 0) {
                for (let sIndex = 0; sIndex < this.services.length; sIndex++) {
                    const service = this.services[sIndex];
                    log3.debug(`listing characteristics for service :${service.uuid}`);
                    const characteristics = yield service.getCharacteristics();
                    yield this.printCharacteristics(characteristics);
                    log3.debug("filtering characteristics.... ");
                    const charsFilter = __SERVICE_CHAR_MAP[service.uuid]; // Object.values(BLEUUID_CHAR);
                    if (!characteristics || !charsFilter) {
                        continue;
                    }
                    for (let cIndex = 0; cIndex < characteristics.length; cIndex++) {
                        if (charsFilter.includes(characteristics[cIndex].uuid)) {
                            this.characteristics[characteristics[cIndex].uuid] = characteristics[cIndex];
                        }
                    }
                }
                log3.debug("filtered Characteristics for subscription: ", this.characteristics);
            }
        });
    }
    subscribeToCharacteristics() {
        log3.debug("subscribeToCharacteristics");
        if (this.productType == VEXProductTypes.VEXGO || this.productType == VEXProductTypes.VEX123Puck) {
            //program characteristics
            if (this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                this.characteristics[BLECharacteristicsID.ProgramCommand].addEventListener("characteristicvaluechanged", this.notificationHandlerProgramCommand);
            }
            if (this.characteristics[BLECharacteristicsID.ProgramSensorStatus]) {
                this.characteristics[BLECharacteristicsID.ProgramSensorStatus].addEventListener("characteristicvaluechanged", this.notificationHandlerSensorStatus);
            }
            if (this.characteristics[BLECharacteristicsID.ProgramPortCmdStatus]) {
                this.characteristics[BLECharacteristicsID.ProgramPortCmdStatus].addEventListener("characteristicvaluechanged", this.notificationHandlerPortCommandStatus);
            }
            if (this.characteristics[BLECharacteristicsID.ProgramBotConfig]) {
                this.characteristics[BLECharacteristicsID.ProgramBotConfig].addEventListener("characteristicvaluechanged", this.notificationHandlerProgramBotConfig);
            }
        }
        if (this.productType == VEXProductTypes.VEXGO || this.productType == VEXProductTypes.VEX123Puck || this.productType == VEXProductTypes.OneStickController) {
            //firmware update characteristics
            if (this.characteristics[BLECharacteristicsID.OADImageID]) {
                this.characteristics[BLECharacteristicsID.OADImageID].addEventListener("characteristicvaluechanged", this.notificationHandlerOADImageID);
            }
            if (this.characteristics[BLECharacteristicsID.OADImageCtrl]) {
                this.characteristics[BLECharacteristicsID.OADImageCtrl].addEventListener("characteristicvaluechanged", this.notificationHandlerOADImageCtrl);
            }
            if (this.characteristics[BLECharacteristicsID.OADImageBlock]) {
                this.characteristics[BLECharacteristicsID.OADImageBlock].addEventListener("characteristicvaluechanged", this.notificationHandlerOADImageBlock);
            }
        }
        //common device info characteristics
        if (this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]) {
            this.characteristics[BLECharacteristicsID.DevInfoHardwareRev].addEventListener("characteristicvaluechanged", this.notificationHandlerDevInfoHardwareRev);
        }
        if (this.characteristics[BLECharacteristicsID.DevInfoLog]) {
            this.characteristics[BLECharacteristicsID.DevInfoLog].addEventListener("characteristicvaluechanged", this.notificationHandlerDeviceLog);
        }
        //AIM 
        if (this.productType == VEXProductTypes.VEXAIM) {
            //admin data receive handler
            if (this.characteristics[BLECharacteristicsID.AIMTXData]) {
                this.characteristics[BLECharacteristicsID.AIMTXData].addEventListener("characteristicvaluechanged", this.notificationHandlerAIMTXData);
            }
            //admin data receive handler
            if (this.characteristics[BLECharacteristicsID.AIMTXUser]) {
                this.characteristics[BLECharacteristicsID.AIMTXUser].addEventListener("characteristicvaluechanged", this.notificationHandlerAIMTXUser);
            }
            //remote command status 
            if (this.characteristics[BLECharacteristicsID.AIMRemoteControlStatus]) {
                this.characteristics[BLECharacteristicsID.AIMRemoteControlStatus].addEventListener("characteristicvaluechanged", this.notificationHandlerAIMRemoteControlStatus);
            }
            if (this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand]) {
                this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand].addEventListener("characteristicvaluechanged", this.notificationHandlerAIMRemoteControlCommand);
            }
            if (this.characteristics[BLECharacteristicsID.AIMRemoteControlAIStatus]) {
                this.characteristics[BLECharacteristicsID.AIMRemoteControlAIStatus].addEventListener("characteristicvaluechanged", this.notificationHandlerAIMRemoteControlAIStatus);
            }
        }
        //IQ2 /EXP/ V5
        if (this.productType == VEXProductTypes.VEXIQ2Brain || this.productType == VEXProductTypes.V5_Brain || this.productType == VEXProductTypes.VEXEXPBrain) {
            //admin data receive handler
            if (this.characteristics[BLECharacteristicsID.AIMTXData]) {
                this.characteristics[BLECharacteristicsID.AIMTXData].addEventListener("characteristicvaluechanged", this.notificationHandlerAIMTXData);
            }
            //admin data receive handler
            if (this.characteristics[BLECharacteristicsID.AIMTXUser]) {
                this.characteristics[BLECharacteristicsID.AIMTXUser].addEventListener("characteristicvaluechanged", this.notificationHandlerAIMTXUser);
            }
        }
    }
    startNotifications() {
        log3.debug("startNotifications");
        // TODO: - This should be modified to consider only the characteristics subscribed /used by the app
        if (this.productType == VEXProductTypes.VEXGO || this.productType == VEXProductTypes.VEX123Puck) {
            this.enableProgramCommandStatus(true);
            this.enableProgramSensorStatus(true);
            this.enableProgramPortCmdStatus(true);
            //this.enableDeviceInfoLogService(true);
        }
        if (this.productType == VEXProductTypes.VEXGO || this.productType == VEXProductTypes.VEX123Puck || this.productType == VEXProductTypes.OneStickController) {
            this.enableFirmwareUpdateService(true);
        }
        if (this.productType == VEXProductTypes.VEXAIM || this.productType == VEXProductTypes.VEXIQ2Brain || this.productType == VEXProductTypes.VEXEXPBrain || this.productType == VEXProductTypes.V5_Brain) {
            //TODO: - checkk characterstics UUID for v5/ iq and subscribe to chars when adding support 
            this.enableAdminService(true);
        }
        if (this.productType == VEXProductTypes.VEXAIM) {
            this.enableAIMRemoteControlService(true);
        }
    }
    unSubscribeToCharacteristics() {
        log3.debug("unSubscribeToCharacteristics");
        // unregister events
        if (this.productType == VEXProductTypes.VEXGO || this.productType == VEXProductTypes.VEX123Puck) {
            if (this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                this.characteristics[BLECharacteristicsID.ProgramCommand].removeEventListener("characteristicvaluechanged", this.notificationHandlerProgramCommand);
            }
            if (this.characteristics[BLECharacteristicsID.ProgramSensorStatus]) {
                this.characteristics[BLECharacteristicsID.ProgramSensorStatus].removeEventListener("characteristicvaluechanged", this.notificationHandlerSensorStatus);
            }
            if (this.characteristics[BLECharacteristicsID.ProgramPortCmdStatus]) {
                this.characteristics[BLECharacteristicsID.ProgramPortCmdStatus].removeEventListener("characteristicvaluechanged", this.notificationHandlerPortCommandStatus);
            }
            if (this.characteristics[BLECharacteristicsID.ProgramBotConfig]) {
                this.characteristics[BLECharacteristicsID.ProgramBotConfig].removeEventListener("characteristicvaluechanged", this.notificationHandlerProgramBotConfig);
            }
        }
        if (this.productType == VEXProductTypes.VEXGO || this.productType == VEXProductTypes.VEX123Puck || this.productType == VEXProductTypes.OneStickController) {
            if (this.characteristics[BLECharacteristicsID.OADImageID]) {
                this.characteristics[BLECharacteristicsID.OADImageID].removeEventListener("characteristicvaluechanged", this.notificationHandlerOADImageID);
            }
            if (this.characteristics[BLECharacteristicsID.OADImageCtrl]) {
                this.characteristics[BLECharacteristicsID.OADImageCtrl].removeEventListener("characteristicvaluechanged", this.notificationHandlerOADImageCtrl);
            }
            if (this.characteristics[BLECharacteristicsID.OADImageBlock]) {
                this.characteristics[BLECharacteristicsID.OADImageBlock].removeEventListener("characteristicvaluechanged", this.notificationHandlerOADImageBlock);
            }
        }
        //common device info characteristics
        if (this.characteristics[BLECharacteristicsID.DevInfoHardwareRev]) {
            this.characteristics[BLECharacteristicsID.DevInfoHardwareRev].removeEventListener("characteristicvaluechanged", this.notificationHandlerDevInfoHardwareRev);
        }
        if (this.characteristics[BLECharacteristicsID.DevInfoLog]) {
            this.characteristics[BLECharacteristicsID.DevInfoLog].removeEventListener("characteristicvaluechanged", this.notificationHandlerDeviceLog);
        }
        if (this.productType == VEXProductTypes.VEXAIM) {
            if (this.characteristics[BLECharacteristicsID.AIMTXData]) {
                this.characteristics[BLECharacteristicsID.AIMTXData].removeEventListener("characteristicvaluechanged", this.notificationHandlerAIMTXData);
            }
            if (this.characteristics[BLECharacteristicsID.AIMTXUser]) {
                this.characteristics[BLECharacteristicsID.AIMTXUser].removeEventListener("characteristicvaluechanged", this.notificationHandlerAIMTXUser);
            }
            if (this.characteristics[BLECharacteristicsID.AIMRemoteControlStatus]) {
                this.characteristics[BLECharacteristicsID.AIMRemoteControlStatus].removeEventListener("characteristicvaluechanged", this.notificationHandlerAIMRemoteControlStatus);
            }
            if (this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand]) {
                this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand].removeEventListener("characteristicvaluechanged", this.notificationHandlerAIMRemoteControlCommand);
            }
            if (this.characteristics[BLECharacteristicsID.AIMRemoteControlAIStatus]) {
                this.characteristics[BLECharacteristicsID.AIMRemoteControlAIStatus].removeEventListener("characteristicvaluechanged", this.notificationHandlerAIMRemoteControlAIStatus);
            }
        }
        //IQ2 /EXP/ V5
        if (this.productType == VEXProductTypes.VEXIQ2Brain || this.productType == VEXProductTypes.VEXEXPBrain || this.productType == VEXProductTypes.V5_Brain) {
            if (this.characteristics[BLECharacteristicsID.AIMTXData]) {
                this.characteristics[BLECharacteristicsID.AIMTXData].removeEventListener("characteristicvaluechanged", this.notificationHandlerAIMTXData);
            }
            if (this.characteristics[BLECharacteristicsID.AIMTXUser]) {
                this.characteristics[BLECharacteristicsID.AIMTXUser].removeEventListener("characteristicvaluechanged", this.notificationHandlerAIMTXUser);
            }
        }
        this.characteristics[BLECharacteristicsID.ProgramCommand] = undefined;
        this.characteristics[BLECharacteristicsID.ProgramSensorStatus] = undefined;
        this.characteristics[BLECharacteristicsID.ProgramPortCmdStatus] = undefined;
        this.characteristics[BLECharacteristicsID.ProgramBotConfig] = undefined;
        this.characteristics[BLECharacteristicsID.OADImageID] = undefined;
        this.characteristics[BLECharacteristicsID.OADImageCtrl] = undefined;
        this.characteristics[BLECharacteristicsID.OADImageBlock] = undefined;
        this.characteristics[BLECharacteristicsID.DevInfoHardwareRev] = undefined;
        this.characteristics[BLECharacteristicsID.DevInfoLog] = undefined;
        this.characteristics[BLECharacteristicsID.AIMTXData] = undefined;
        this.characteristics[BLECharacteristicsID.AIMRXData] = undefined;
        this.characteristics[BLECharacteristicsID.AIMRemoteControlStatus] = undefined;
        this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand] = undefined;
        this.characteristics[BLECharacteristicsID.AIMRemoteControlAIStatus] = undefined;
        this.lastPortCommandStatus = undefined;
        this.lastProgramSensorStatus = undefined;
    }
    async doDownload() {
            log3.debug("download statemachine..");
            try {
                switch (this.downloadState) {
                    case FWDownloadState.PaySize:
                        await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.OADImageCtrl], Uint8Array.of(1));
                        break;
                    case FWDownloadState.ImgVerify:
                        this.firmwareImage.printHdr();
                        // generate header data
                        const headerData = this.firmwareImage.imgIdRequestData();
                        log3.debug(headerData);
                        await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.OADImageID], headerData);
                        break;
                    case FWDownloadState.SendBlock:
                        if (this.oadLastStatus !== 0 && this.oadLastStatus !== VEXFWUpdateStatus.OAD_DL_COMPLETE) {
                            // Notifiy UI
                            // Error abort
                            this.updateFWUpdateState(VEXFWUpdateStatus.CommunicationFailure);
                            return;
                        }
                        const blockData = this.firmwareImage.block(this.oadNextAddress, this.payloadSize);
                        if (blockData !== undefined) {
                            const percentDone = (this.oadNextAddress * this.payloadSize) / this.firmwareImage.data.length;
                            let done = percentDone * 100;
                            if (done > 99) {
                                done = 99;
                            }
                            done = Math.round(done);
                            log3.debug(`Sending Block: ${this.oadNextAddress} Size: ${blockData.length} Done %: ${percentDone}`);
                            // Progress callback to UI
                            this.updateFWUpdateProgress(done);
                            await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.OADImageBlock], blockData);
                        }
                        else {
                            // sent all the data. send image enable
                            await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.OADImageCtrl], Uint8Array.of(4));
                            // Progress callback to UI
                            this.updateFWUpdateProgress(100);
                        }
                        break;
                    default:
                        log3.error("unknown download state");
                        break;
                }
            }
            catch (ex) {
                log3.error("doDownload: error during update:", ex);
                throw ex;
            }
    }
    clearRXTimeout() {
        if (this.ble_rxTimeout) {
            clearTimeout(this.ble_rxTimeout);
            this.ble_rxTimeout = undefined;
        }
    }
    async sendExecuteSingleCommand(command) {
        if (this.isConnected() && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
            const raw = uint32ToByteArray(command);
            const commandBuffer = new Uint8Array(5);
            commandBuffer[0] = ProgramConst.PROG_CMD_EXE_SINGLE;
            commandBuffer[1] = raw[0];
            commandBuffer[2] = raw[1];
            commandBuffer[3] = raw[2];
            commandBuffer[4] = raw[3];
            try {
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
            }
            catch (ex) {
                await this.delay(200);
                log3.debug("sendExecuteSingleCommand: ", ex);
                log3.debug("sendExecuteSingleCommand: ", "Retry...");
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
            }
        }
    }
    async sendExecuteSingleCommandAIM(command) {
        if (!command) {
            log3.debug("AimSendCommand received nil command, meaning command is invalid");
            return;
        }
        const value = command.toUin8Array();
        if (this.isConnected() && this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand]) {
            try {
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand], value);
            }
            catch (ex) {
                await this.delay(200);
                log3.debug("sendExecuteSingleCommandAIM: ", ex);
                log3.debug("sendExecuteSingleCommandAIM: ", "Retry...");
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.AIMRemoteControlCommand], value);
            }
        }
    }
    async sendExecuteMultiCommand(commands) {
        if (this.isConnected() && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
            const commandBuffer = new Uint8Array(commands.length * 5);
            for (let i = 0; i < commands.length; i++) {
                const raw = uint32ToByteArray(commands[i]);
                if (i < 4) {
                    const offset = i * 5;
                    commandBuffer[offset + 0] = ProgramConst.PROG_CMD_EXE_SINGLE;
                    commandBuffer[offset + 1] = raw[0];
                    commandBuffer[offset + 2] = raw[1];
                    commandBuffer[offset + 3] = raw[2];
                    commandBuffer[offset + 4] = raw[3];
                }
            }
            try {
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
            }
            catch (ex) {
                await this.delay(200);
                log3.debug("sendExecuteMultiCommand: ", ex);
                log3.debug("sendExecuteMultiCommand: ", "Retry...");
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
            }
        }
    }
    processDevLog(value) {
        if (!value)
            return;
        //const dataUint8Arr = new Uint8Array(value);
        let logStr = new TextDecoder("utf-8").decode(value);
        let parts = logStr.split("\r");
        parts.forEach(element => {
            log3.debug(`Brain Log: ${element})`);
        });
    }
    //controller
    /**
 * Assigns a program command to a button press/release
 * @param buttonID Button ID to assign this command to. Values are 0 -> 15. Any value above 15 will clear all button commands
 * @param pressed If true this command will execute when the button value transitions from 0 to 1 else it will execute when the button value transitions from 1 to 0
 * @param buttonCommand 4 Byte command to execute when the button is pressed or released
 */
    setControlButtonCommand(buttonID, pressed, buttonCommand) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected() && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                const raw = uint32ToByteArray(buttonCommand);
                const commandBuffer = new Uint8Array(7);
                commandBuffer[0] = ProgramConst.PROG_CMD_SET_BUTTON_CMD;
                commandBuffer[1] = buttonID;
                commandBuffer[2] = pressed ? (new UInt8(1)).Get() : (new UInt8(0)).Get();
                commandBuffer[3] = raw[0];
                commandBuffer[4] = raw[1];
                commandBuffer[5] = raw[2];
                commandBuffer[6] = raw[3];
                try {
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
                }
                catch (ex) {
                    yield this.delay(200);
                    log3.debug("setControlButtonCommand: ", ex);
                    log3.debug("setControlButtonCommand: ", "Retry...");
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
                }
            }
        });
    }
    /**
     * Sends control values to robot
     * @param leftX Left Stick X value (0 to 255). 127 == stop
     * @param leftY Left Stick Y value (0 to 255). 127 == stop
     * @param rightX Right Stick X value (0 to 255). 127 == stop
     * @param rightY Right Stick Y value (0 to 255). 127 == stop
     * @param Buttons1 First 8 button bit map
     * @param Buttons2 Second 8 button bit map
     */
    setControlControlValues(leftX = 127, leftY = 127, rightX = 127, rightY = 127, Buttons1 = 0, Buttons2 = 0) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isConnected() && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
                const commandBuffer = new Uint8Array(7);
                commandBuffer[0] = ProgramConst.PROG_CMD_SET_CONTROLL_VALUES;
                commandBuffer[1] = (new UInt8(leftX)).Get();
                commandBuffer[2] = (new UInt8(leftY)).Get();
                commandBuffer[3] = (new UInt8(rightX)).Get();
                commandBuffer[4] = (new UInt8(rightY)).Get();
                commandBuffer[5] = (new UInt8(Buttons1)).Get();
                commandBuffer[6] = (new UInt8(Buttons2)).Get();
                try {
                    yield writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
                }
                catch (ex) {
                    //await this.delay(200);
                    log3.debug("SetControlControlValues: ", ex);
                    log3.debug("SetControlControlValues: ", "Retry...");
                    //await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], commandBuffer);
                }
            }
        });
    }
    /**
     * Sends a command to set the stick type for control values
     * @param newType
     * @param driveSensi
     * @param turnSensi
     */
    async setControlDriveStickType(newType, driveSensi = 50, turnSensi = 25) {
        if (this.isConnected() && this.characteristics[BLECharacteristicsID.ProgramCommand]) {
            const value = new Uint8Array([ProgramConst.PROG_CMD_SET_STICK_MODE_CMD, newType, driveSensi, turnSensi]);
            try {
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
            }
            catch (ex) {
                await this.delay(200);
                log3.debug("setControlDriveStickType: ", ex);
                log3.debug("setControlDriveStickType: ", "Retry...");
                await writeCharacteristicValue(this.characteristics[BLECharacteristicsID.ProgramCommand], value);
            }
        }
    }
    async controllerLoopRun() {
        this.isControllerUpdateRunning = true;
        try {
            while (this.isControllerUpdateRunning) {
                try {
                    await this.controllerUpdate();
                    await this.delay(this.controllerUpdateInterval * 1000);
                    //log3.debug("controller update loop running..")
                }
                catch (error) {
                    log3.debug("controllerLoopRun: ", error);
                }
            }
        }
        catch (error) {
            log3.debug("controllerLoopRun: ", error);
        }
    }
    controllerLoopStop() {
        this.isControllerUpdateRunning = false;
    }
    // helpers
    delay(ms, payload) {
        return new Promise((resolve) => {
            setTimeout(() => { resolve(payload); }, ms);
        });
    }
    async exponentialBackoff(max, delay, toTry, success, fail) {
        try {
            const result = await toTry();
            success(result);
        }
        catch (error) {
            if (max === 0) {
                return fail();
            }
            this.time("Retrying in " + delay + "s... (" + max + " tries left)");
            setTimeout(() => {
                this.exponentialBackoff(--max, delay * 2, toTry, success, fail);
            }, delay * 1000);
        }
    }
    appendArrayBuffer(buffer1, buffer2) {
        const length1 = buffer1 ? buffer1.byteLength : 0;
        const length2 = buffer2 ? buffer2.byteLength : 0;
        const tmp = new Uint8Array(length1 + length2);
        if (tmp.length === 0) {
            return null;
        }
        if (buffer1) {
            tmp.set(new Uint8Array(buffer1), 0);
        }
        if (buffer2) {
            tmp.set(new Uint8Array(buffer2), length1);
        }
        return tmp.buffer;
    }
    printBuffer(buf, maxLength, prefix) {
        if (!maxLength) {
            maxLength = buf.length;
        }
        let str = "";
        for (let i = 0; i < buf.length && i < maxLength; i++) {
            str += ("00" + buf[i].toString(16)).substr(-2, 2) + " ";
        }
        if (maxLength < buf.length) {
            str += " ... ";
        }
        if (prefix) {
            log3.debug(prefix + " : " + str);
        }
        else {
            log3.debug(str);
        }
    }
    time(text) {
        log3.debug("[" + new Date().toJSON().substr(11, 8) + "] " + text);
    }
    decodeSystemVersion(msg) {
        /*
          byte 0 = 0xAA
          byte 1 = 0x55
          byte 2 = 0xA4 // CDC_GET_SYS_VERSION
          byte 3 = 8 // size of the data ... at least for now
          bytes 4-11 = the version structure
            byte 0 = major
            byte 1 = minor
            byte 2 = build
            byte 3 = hardware version
            byte 4 = beta version
            byte 5 = product id // not used?
            byte 6 = product flags
              bit0 = ?
              bit1 = battery low
              bit2 = ?
              bit3 = ?
              bit4 = ?
              bit5 = ?
              bit6 = ?
              bit7 = ?
            byte 7 = reserved
        */
        const buf = (msg instanceof ArrayBuffer) ? new Uint8Array(msg) : msg;
        if (this.cdc.cdcValidateIQMessage(buf)) {
            const dvb = new DataView(buf.buffer, buf.byteOffset);
            let extcmd = 4;
            var length = this.cdc.cdc2MessageGetLength(buf);
            if (length > 128) {
                extcmd = 5;
            }
            let versionSystem = [0, 0, 0, 0];
            versionSystem[0] = dvb.getUint8(extcmd + 0);
            versionSystem[1] = dvb.getUint8(extcmd + 1);
            versionSystem[2] = dvb.getUint8(extcmd + 2);
            versionSystem[3] = dvb.getUint8(extcmd + 4);
            return versionSystem;
        }
    }
    /**
    * Decode a cdc2 system status command
    * Most of the data is not used by the AIM.Including it here for supporting V5,IQ and EXP later
    * @param msg
    */
    decodeSysStatusRead(msg) {
        let buf = (msg instanceof ArrayBuffer) ? new Uint8Array(msg) : msg;
        if (this.cdc.cdc2ValidateMessage(buf)) {
            let dvb = new DataView(buf.buffer, buf.byteOffset);
            let extcmd = 4;
            var length = this.cdc.cdc2MessageGetLength(buf);
            if (length > 128) {
                extcmd = 5;
            }
            let versionUser = [0, 0, 0, 0];
            let versionSystem = [0, 0, 0, 0];
            let eventBrain = false;
            let assetInvalid = false;
            let uniqueId = 0;
            let sysFlags = [0, 0, 0, 0, 0, 0, 0, 0];
            let romBootloaderActive = false;
            let ramBootloaderActive = false;
            let versionGolden = 0;
            let versionNxp = 0;
            if (buf[extcmd] == VexCDC.ECMDS.SYS_STATUS.cmd) {
                if (buf[extcmd + 1] == VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                    versionUser[0] = dvb.getUint32(extcmd + 3 + 0, false);
                    versionUser[1] = dvb.getUint32(extcmd + 3 + 4, false);
                    versionUser[2] = dvb.getUint32(extcmd + 3 + 8, false);
                    versionUser[3] = dvb.getUint32(extcmd + 3 + 12, true);
                    // controller does not report system version in the
                    // A4 message so update here
                    let sysOk = false;
                    for (let i = 0; i < versionSystem.length; i++) {
                        if (versionSystem[i] !== 0) {
                            sysOk = true;
                        }
                    }
                    if (sysOk === false) {
                        versionSystem[0] = dvb.getUint8(extcmd + 3 + 0);
                        versionSystem[1] = dvb.getUint8(extcmd + 3 + 1);
                        versionSystem[2] = dvb.getUint8(extcmd + 3 + 2);
                        versionSystem[3] = dvb.getUint8(extcmd + 3 + 3);
                    }
                    if (length > 25) {
                        uniqueId = dvb.getUint32(extcmd + 3 + 16, true);
                        sysFlags[0] = dvb.getUint8(extcmd + 3 + 20);
                        sysFlags[1] = dvb.getUint8(extcmd + 3 + 21);
                        sysFlags[2] = dvb.getUint8(extcmd + 3 + 22);
                        sysFlags[3] = dvb.getUint8(extcmd + 3 + 23);
                        sysFlags[4] = dvb.getUint8(extcmd + 3 + 24);
                        sysFlags[6] = dvb.getUint8(extcmd + 3 + 26);
                        if (sysFlags[6] & 0x01) {
                            eventBrain = true;
                        }
                        romBootloaderActive = false;
                        if (sysFlags[6] & 0x02) {
                            romBootloaderActive = true;
                        }
                        ramBootloaderActive = false;
                        if (sysFlags[6] & 0x04) {
                            ramBootloaderActive = true;
                        }
                        if ((sysFlags[2] & 0x01)) {
                            assetInvalid = true;
                        }
                        // final 4 bytes are now golden image version as read from QSPI
                        // so in slightly different format
                        // major.minor.beta.(build:6 cpu:2) (big endian)
                        // build is top 6 bits of LSB, cpu is lower 2 bits
                        versionGolden = dvb.getUint32(extcmd + 3 + 28, false);
                        let dbgLen = 34;
                        if (length > 37) {
                            versionNxp = dvb.getUint32(extcmd + 3 + 32, false);
                            dbgLen += 4;
                        }
                        else {
                            versionNxp = 0;
                        }
                    }
                    else {
                        // dummy data
                        uniqueId = 1234;
                        sysFlags[0] = 0;
                        sysFlags[1] = 0;
                        sysFlags[2] = 0;
                        sysFlags[3] = 0;
                        sysFlags[4] = 0;
                        sysFlags[6] = 0;
                        versionGolden = 0;
                        versionNxp = 0;
                        eventBrain = false;
                        romBootloaderActive = false;
                        ramBootloaderActive = false;
                        assetInvalid = false;
                    }
                }
                let sysStatus = {
                    versionUser: versionUser,
                    versionSystem: versionSystem,
                    eventBrain: eventBrain,
                    assetInvalid: assetInvalid,
                    deviceID: uniqueId,
                    sysFlags: sysFlags,
                    romBootloaderActive: romBootloaderActive,
                    ramBootloaderActive: ramBootloaderActive,
                    versionGolden: versionGolden,
                    versionNxp: versionNxp
                };
                log3.debug("sysStatus: ", sysStatus);
                return sysStatus;
            }
        }
        return undefined;
    }
    /**
   * Decode a cdc2 KV read command
   * @param msg
   */
    decodeSysKVRead(msg) {
        let buf = (msg instanceof ArrayBuffer) ? new Uint8Array(msg) : msg;
        if (this.cdc.cdc2ValidateMessage(buf)) {
            let extcmd = 4;
            var length = this.cdc.cdc2MessageGetLength(buf);
            if (length > 128) {
                extcmd = 5;
            }
            if (buf[extcmd] == VexCDC.ECMDS.SYS_KV_LOAD.cmd) {
                if (buf[extcmd + 1] == VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                    let value = new TextDecoder("UTF-8").decode(buf.slice(extcmd + 2, extcmd + length - 2));
                    // remove trailing null if present
                    var c = value.indexOf('\0');
                    if (c > -1) {
                        value = value.substr(0, c);
                    }
                    return value;
                }
            }
        }
        return undefined;
    }
}
VEXBLEDeviceManager.STATUS_GOOD = 0x76;



const log4 = logger.getLogger("vex-web-ble-device-manager-firmware");
log4.setLevel(LoggerLevels.WARN);
log4.setHistoryLogger("vex-web-ble-device-manager");

// Type of firmware to load from server
var VEXFirmwareType;
(function (VEXFirmwareType) {
    VEXFirmwareType[VEXFirmwareType["Release"] = 1] = "Release";
    VEXFirmwareType[VEXFirmwareType["Beta"] = 2] = "Beta";
    VEXFirmwareType[VEXFirmwareType["Development"] = 3] = "Development";
    VEXFirmwareType[VEXFirmwareType["Bootloader"] = 4] = "Bootloader";
})(VEXFirmwareType || (VEXFirmwareType = {}));
class VEXFirmwareVersion {
    constructor(major, minor, build, beta) {
        this.major = 0;
        this.minor = 0;
        this.build = 0;
        this.beta = 0;
        this.major = major;
        this.minor = minor;
        this.build = build;
        this.beta = beta;
    }
    static getEmpty() {
        return new VEXFirmwareVersion(0, 0, 0, 0);
    }
    getString() {
        return `${this.major}.${this.minor}.${this.build}.B${this.beta}`;
    }
    /**
    * Take a a string of MAJOR.MINOR.BUILD.bBETA and converts it to a
    * VEXFirmwareVersion instance
    * @param version the string to process
    * @returns a VEXFirmwareVersion representing the provided string
    */
    static fromString(version) {
        const parts = version
            .toLowerCase()
            .replace(/b/g, "")
            .split(".")
            .map((x) => parseInt(x, 10));
        while (parts.length < 4) {
            parts.push(0);
        }
        return new VEXFirmwareVersion(parts[0], parts[1], parts[2], parts[3]);
    }
    isLessThan(targetVersion) {
        if (this.major < targetVersion.major) {
            return true;
        }
        if (this.major > targetVersion.major) {
            return false;
        }
        // if it gets here, the major matches, now check minor
        if (this.minor < targetVersion.minor) {
            return true;
        }
        if (this.minor > targetVersion.minor) {
            return false;
        }
        // if it gets here, the major & minor matches, check build
        if (this.build < targetVersion.build) {
            return true;
        }
        if (this.build > targetVersion.build) {
            return false;
        }
        // now check beta
        // beta 0 is a release version. so we ignore upgrade from beta 0 to say beta 1
        if ((this.beta !== 0) && (this.beta < targetVersion.beta)) {
            return true;
        }
        // allow upgrade from beta 10 to beta 0 (public release) of the same major.minor
        if ((targetVersion.beta === 0) && this.beta !== targetVersion.beta) {
            return true;
        }
        return false;
    }
    isEmpty() {
        return (this.major === 0 && this.minor === 0 && this.build === 0 && this.beta === 0);
    }
}
var ImgType;
(function (ImgType) {
    ImgType[ImgType["EFL_OAD_IMG_TYPE_PERIST"] = 0] = "EFL_OAD_IMG_TYPE_PERIST";
    ImgType[ImgType["EFL_OAD_IMG_TYPE_APP"] = 1] = "EFL_OAD_IMG_TYPE_APP";
    ImgType[ImgType["EFL_OAD_IMG_TYPE_NONE"] = 255] = "EFL_OAD_IMG_TYPE_NONE";
})(ImgType || (ImgType = {}));
// source: https://en.wikipedia.org/wiki/Intel_HEX
var RecordType;
(function (RecordType) {
    RecordType[RecordType["DATA"] = 0] = "DATA";
    RecordType[RecordType["EOF"] = 1] = "EOF";
    RecordType[RecordType["EXT_SEG_ADDR"] = 2] = "EXT_SEG_ADDR";
    RecordType[RecordType["START_SEG_ADDR"] = 3] = "START_SEG_ADDR";
    RecordType[RecordType["EXT_LIN_ADDR"] = 4] = "EXT_LIN_ADDR";
    RecordType[RecordType["START_LIN_ADDR"] = 5] = "START_LIN_ADDR";
})(RecordType || (RecordType = {}));
class VEXBLEFirmware {
    constructor(productType = VEXProductTypes.Unknown) {
        // public
        this.AllGood = false;
        if (productType === VEXProductTypes.Unknown) {
            console.error("Firmware : Product Type missing in constructor");
        }
        this.productType = productType;
    }
    setProductType(productType) {
        this.productType = productType;
    }
    // public
    async getVersionFromServer(firmwareType = VEXFirmwareType.Release, productType = VEXProductTypes.Unknown) {
        const versionFileNameFromServer = await this.getFirmwareFileNameFromServer(firmwareType, productType);
        const versionParts = versionFileNameFromServer.split("_");
        if (versionParts.length > 5) {
            return new VEXFirmwareVersion(parseInt(versionParts[versionParts.length - 4], 10), parseInt(versionParts[versionParts.length - 3], 10), parseInt(versionParts[versionParts.length - 2], 10), parseInt(versionParts[versionParts.length - 1], 10));
        }
        return new VEXFirmwareVersion(0, 0, 0, 0);
    }
    async getImageFromServer(firmwareType = VEXFirmwareType.Release) {
        try {
            const fileName = await this.getFirmwareFileNameFromServer(firmwareType, this.productType);
            const productName = this.getProductName();
            if (fileName && productName) {
                let vexosUrl = `https://content.vexrobotics.com/vexos/public${(firmwareType !== VEXFirmwareType.Release) ? "_beta" : ""}/${productName}/${fileName}.vexos`;
                if (firmwareType === VEXFirmwareType.Bootloader && productName == "Go") {
                    vexosUrl = `https://content.vexrobotics.com/vexos/public_beta/Go/Bootloader/${fileName}.vexos`;
                }
                const serverImage = await this.getFileFromServer(vexosUrl, "text", undefined, undefined, (percent) => {
                    log4.debug("dowloading vexos from server (%) : ", percent * 100);
                });
                return (serverImage) ? serverImage : "";
            }
            else {
                return "";
            }
        }
        catch (ex) {
            console.error("error downloading vexos from server: ", ex);
            return "";
        }
    }
    async getVersionFromLocalFile(firmwareType = VEXFirmwareType.Release, productType = VEXProductTypes.Unknown) {
        const versionFileNameFromLocal = await this.getFirmwareFileNameFromLocal(firmwareType, productType);
        if (!versionFileNameFromLocal) {
            log4.debug("firmware not available.");
            return new VEXFirmwareVersion(0, 0, 0, 0);
        }
        const versionParts = versionFileNameFromLocal.split("_");
        if (versionParts.length < 5) {
            // TODO load from local resources
        }
        if (versionParts.length > 5) {
            return new VEXFirmwareVersion(parseInt(versionParts[versionParts.length - 4], 10), parseInt(versionParts[versionParts.length - 3], 10), parseInt(versionParts[versionParts.length - 2], 10), parseInt(versionParts[versionParts.length - 1], 10));
        }
        return new VEXFirmwareVersion(0, 0, 0, 0);
    }
    async getImageFromLocalFile(firmwareType = VEXFirmwareType.Release, contentType = "Hex") {
        try {
            const resourcePath = getResourceFolder(); // LocalStorage module?
            const productName = this.getProductName();
            if (!productName) {
                return undefined;
            }
            const localImageName = await this.getFirmwareFileNameFromLocal(firmwareType);
            if (!localImageName) {
                return undefined;
            }
            // get the image from local resources folder
            let localVEXOSURL = `${resourcePath}/vexos/public${firmwareType !== VEXFirmwareType.Release ? "_beta" : ""}/${productName}/${localImageName}.vexos`;
            if (firmwareType === VEXFirmwareType.Bootloader && productName == "Go") {
                localVEXOSURL = `${resourcePath}/vexos/public_beta/Go/Bootloader/${localImageName}.vexos`;
            }
            let responseType = (contentType === "Hex") ? "text" : "arraybuffer";
            const localImage = await this.getFileFromServer(localVEXOSURL, responseType, undefined, undefined).catch((reason) => { throw reason; });
            return (localImage) ? localImage : "";
        }
        catch (ex) {
            console.error("Error getting vexos from local file:", ex);
            return "";
        }
    }
    getImageFromHex(hex) {
        try {
            const image = new VEXBLEFirmwareImage(hex);
            return image;
        }
        catch (ex) {
            console.error("error during processing hex:", ex);
        }
    }
    // helpers
    getProductName(productType) {
        if (productType === undefined || productType === VEXProductTypes.Unknown) {
            productType = this.productType;
        }
        switch (productType) {
            case VEXProductTypes.VEXCoder:
                return "Coder";
            case VEXProductTypes.VEX123Puck:
                return "123";
            case VEXProductTypes.VEXGO:
                return "Go";
            case VEXProductTypes.VEXAIM:
                return "AIM";
            case VEXProductTypes.OneStickController:
                return "OneStick";
            default:
                return "";
        }
        return "";
    }
    async getFirmwareFileNameFromServer(firmwareType = VEXFirmwareType.Release, productType = VEXProductTypes.Unknown) {
        let catalogURL = "";
        let imageFileName;
        if (productType === VEXProductTypes.Unknown) {
            if (this.productType === VEXProductTypes.Unknown) {
                return "";
            }
            productType = this.productType;
        }
        try {
            if (firmwareType === VEXFirmwareType.Beta) {
                if (productType === VEXProductTypes.VEXGO) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/Go/catalog.txt`;
                }
                else if (productType === VEXProductTypes.VEX123Puck) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/123/catalog.txt`;
                }
                else if (productType === VEXProductTypes.VEXCoder) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/Coder/catalog.txt`;
                }
                else if (productType === VEXProductTypes.VEXAIM) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/AIM/catalog.txt`;
                }
                else if (productType === VEXProductTypes.OneStickController) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/OneStick/catalog.txt`;
                }
                else {
                    // This board is not recognized. Alert the user.
                    return "";
                }
            }
            else if (firmwareType === VEXFirmwareType.Development) {
                if (productType === VEXProductTypes.VEXGO) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/Go/catalog_dev.txt`;
                }
                else if (productType === VEXProductTypes.VEX123Puck) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/123/catalog_dev.txt`;
                }
                else if (productType === VEXProductTypes.VEXCoder) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/Coder/catalog_dev.txt`;
                }
                else if (productType === VEXProductTypes.VEXAIM) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/AIM/catalog.txt`;
                }
                else if (productType === VEXProductTypes.OneStickController) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/OneStick/catalog.txt`;
                }
                else {
                    // This board is not recognized. Alert the user.
                    return "";
                }
            }
            else if (firmwareType === VEXFirmwareType.Bootloader) {
                if (productType === VEXProductTypes.VEXGO) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public_beta/Go/Bootloader/catalog.txt`;
                }
                else {
                    // This board is not recognized. Alert the user.
                    return "";
                }
            }
            else {
                if (productType === VEXProductTypes.VEXGO) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public/Go/catalog.txt`;
                }
                else if (productType === VEXProductTypes.VEX123Puck) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public/123/catalog.txt`;
                }
                else if (productType === VEXProductTypes.VEXCoder) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public/Coder/catalog.txt`;
                }
                else if (productType === VEXProductTypes.VEXAIM) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public/AIM/catalog.txt`;
                }
                else if (productType === VEXProductTypes.OneStickController) {
                    catalogURL = `https://content.vexrobotics.com/vexos/public/OneStick/catalog.txt`;
                }
                else {
                    // This board is not recognized. Alert the user.
                    return "";
                }
            }
            imageFileName = await this.getFileFromServer(catalogURL, "text", undefined, undefined, (percent) => {
                log4.debug("dowloading catalog (%) : ", percent * 100);
            }).catch((reason) => { throw reason; });
            return (imageFileName) ? imageFileName : "";
        }
        catch (error) {
            console.info("Error when fetching firmware catalog contents: ", error);
            return "";
        }
    }
    async getFirmwareFileNameFromLocal(firmwareType = VEXFirmwareType.Release, productType = VEXProductTypes.Unknown) {
        if (productType === VEXProductTypes.Unknown) {
            if (this.productType === VEXProductTypes.Unknown) {
                return "";
            }
            productType = this.productType;
        }
        try {
            const resourcePath = getResourceFolder(); // LocalStorage module?
            const productName = this.getProductName(productType);
            if (!productName) {
                return undefined;
            }
            // get the image name from local catalog
            let localVEXOSCatalogURL = `${resourcePath}/vexos/public${(firmwareType !== VEXFirmwareType.Release) ? "_beta" : ""}/${productName}/catalog${(firmwareType === VEXFirmwareType.Development) ? "_dev" : ""}.txt`;
            if (firmwareType === VEXFirmwareType.Bootloader && productType == VEXProductTypes.VEXGO) {
                localVEXOSCatalogURL = `${resourcePath}/vexos/public_beta/Go/Bootloader/catalog.txt`;
            }
            const localImageName = await this.getFileFromServer(localVEXOSCatalogURL, "text", undefined, undefined).catch((reason) => { throw reason; });
            return (localImageName) ? localImageName : "";
        }
        catch (error) {
            console.error("Error when fetching firmware catalog contents: ", error);
            return "";
        }
    }
    getFileFromServer(url, responseType, user, pass, progress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            // xhr.setRequestHeader("Cache-Control", "no-cache,max-age=0");
            xhr.responseType = responseType;
            // yea, this is bad, but for now we hard code some stuff
            // if (user !== undefined && pass !== undefined) {
            //     xhr.withCredentials = true;
            //     xhr.setRequestHeader("Authorization", "Basic " + btoa(user + ":" + pass));
            // } else if (user !== undefined) {
            //     xhr.withCredentials = true;
            //     xhr.setRequestHeader("Authorization", "Basic " + user);
            // }
            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve(xhr.response);
                }
                if (xhr.status === 401) {
                    // auth error
                    resolve(undefined);
                }
                else {
                    reject(Error(`failed to get file from url: ${url}; error code: ` + xhr.statusText));
                }
            };
            xhr.onerror = () => {
                reject(Error("There was a network error."));
            };
            if (progress !== undefined) {
                // progress on transfers from the server to the client (downloads)
                xhr.onprogress = (oEvent) => {
                    if (oEvent.lengthComputable) {
                        const percentComplete = oEvent.loaded / oEvent.total;
                        if (progress !== undefined) {
                            progress(percentComplete);
                        }
                    }
                    else {
                        // Unable to compute progress information since the total size is unknown
                    }
                };
            }
            xhr.send();
        });
    }
}
class VEXBLEFirmwareImage {
    constructor(hex) {
        // image header
        this.crc0 = 0;
        this.crc1 = 0;
        this.ver = 0;
        this.len = 0;
        this.addr = 0;
        this.imgBaseAddr = 0;
        this.uid = new Uint8Array([0x45, 0x45, 0x45, 0x45]);
        this.imgType = ImgType.EFL_OAD_IMG_TYPE_NONE;
        this.lastBlock = false;
        this.data = new Uint8Array();
        // fixed assumptions made, using intel hex from hexmerge.py
        this.OAD_BLOCK_SIZE = 16;
        this.HAL_FLASH_WORD_SIZE = 4;
        // programming counters used duing bulk block transfer
        this.iBlocks = 0; // Number of blocks programmed
        this.nBlocks = 0; // Total number of blocks
        const img = [];
        const lines = this.generateLines(hex);
        let allGood = this.parseLines(lines);
        if (this.data.length === 0) {
            allGood = false;
        }
        // update header fields (start address was updated during the parse)
        this.len = this.data.length / (16 / 4);
        this.crc1 = 0xFFFF;
        this.crc0 = this.calcImageCRC(0, this.data);
        // reset all counters
        this.resetProgress();
    }
    block(blockNum, blockSize) {
        if (!this.lastBlock) {
            // iBlocks = blockNum;
            let blockCount = blockSize;
            let endVal = blockNum * (blockSize - 4) + (blockSize - 4);
            if (endVal > this.data.length) {
                endVal = this.data.length;
                this.lastBlock = true;
                // blockCount = data.length + 4;
            }
            const range = this.range((blockNum * (blockSize - 4)), endVal, false);
            blockCount = range.length + 4;
            const blockHead = new Uint8Array(4).fill(0);
            let block = new Uint8Array(blockCount).fill(0);
            blockHead[0] = (blockNum & 0xFF);
            blockHead[1] = ((blockNum >> 8) & 0xFF);
            blockHead[2] = ((blockNum >> 16) & 0xFF);
            blockHead[3] = ((blockNum >> 24) & 0xFF);
            const subdata = this.data.subarray(range[0], range[range.length - 1] + 1); // end is excluded so adding 1 here
            block = this.concat([blockHead, subdata]);
            return block;
        }
        return undefined;
    }
    // print image header for debugging
    printHdr() {
        log4.debug("FwUpdateActivity :");
        log4.debug("-----------------------------------------------");
        log4.debug("ImgHdr.len = ", this.len);
        log4.debug("ImgHdr.ver = ", this.ver);
        log4.debug(`ImgHdr.uid = 0x${this.uid[0]}${this.uid[1]}${this.uid[2]}${this.uid[3]}`);
        log4.debug(`ImgHdr.addr = 0x ${new UInt32(this.addr & 0xFFFFFFFF).Get()}`);
        log4.debug("ImgHdr.imgType = ", this.imgType);
        log4.debug(`ImgHdr.crc0 = 0x${new UInt16(this.crc0 & 0xFFFF).Get()}`);
        log4.debug(this.bytesToHex(this.imgIdentifyRequestData()));
        log4.debug("-----------------------------------------------");
    }
    // generate the image header data to identify with the OAD target
    imgIdRequestData() {
        let block = new Uint8Array(22).fill(0);
        // Note: end is excluded
        const block0 = this.data.subarray(0, 8); // length : 8
        const block8 = this.data.subarray(12, 14); // length : 2
        const block10 = this.data.subarray(16, 20); // length : 4
        const block14 = this.data.subarray(24, 28); // length : 4
        //If we are loading a persist app then we need to put the start address in this section
        if (this.imgType == ImgType.EFL_OAD_IMG_TYPE_PERIST) {
            let baseAddressByteArray = (0,uint32ToByteArray)(this.imgBaseAddr);
            const block18 = new Uint8Array([baseAddressByteArray[0], baseAddressByteArray[1], baseAddressByteArray[2], baseAddressByteArray[3]]);
            block = this.concat([block0, block8, block10, block14, block18]);
        }
        else {
            const block18 = this.data.subarray(32, 36); // length : 4
            block = this.concat([block0, block8, block10, block14, block18]);
        }
        return block;
    }
    // generate the image header data to identify with the OAD target
    imgIdentifyRequestData() {
        const tmp = new Uint8Array(16);
        tmp[0] = new UInt8(this.crc0 & 0xFF).Get();
        tmp[1] = new UInt8((this.crc0 >> 8) & 0xFF).Get();
        tmp[2] = new UInt8(this.crc1 & 0xFF).Get();
        tmp[3] = new UInt8((this.crc1 >> 8) & 0xFF).Get();
        tmp[4] = new UInt8(this.ver & 0xFF).Get();
        tmp[5] = new UInt8((this.ver >> 8) & 0xFF).Get();
        tmp[6] = new UInt8(this.len & 0xFF).Get();
        tmp[7] = new UInt8((this.len >> 8) & 0xFF).Get();
        tmp[8] = new UInt8(this.uid[0]).Get();
        tmp[9] = new UInt8(this.uid[1]).Get();
        tmp[10] = new UInt8(this.uid[2]).Get();
        tmp[11] = new UInt8(this.uid[3]).Get();
        tmp[12] = new UInt8(this.addr & 0xFF).Get();
        tmp[13] = new UInt8((this.addr >> 8) & 0xFF).Get();
        tmp[14] = new UInt8(this.imgType & 0xFF).Get();
        tmp[15] = new UInt8(0xFF).Get();
        return tmp;
    }
    generateLines(hex) {
        if (hex) {
            const lines = hex.split("\n").filter((line) => (line) ? true : false);
            log4.debug("No of lines : ", lines.length);
            return lines;
        }
        return [];
    }
    parseLines(lines) {
        let currentAddressBase = 0;
        let currentAddress;
        for (const line of lines) {
            // log4.debug("parsing : ", line);
            if (!line.startsWith(":")) {
                continue;
            }
            // try to get the number of bytes in this line
            const numBytesStr = line.substr(1, 2);
            if (!numBytesStr) {
                continue;
            }
            const numBytes = parseInt(numBytesStr, 16);
            if (isNaN(numBytes)) {
                continue;
            }
            // try to get record type
            const recordTypeStr = line.substr(7, 2);
            if (!recordTypeStr) {
                continue;
            }
            const recordTypeInt = parseInt(recordTypeStr, 16);
            if (isNaN(recordTypeInt)) {
                continue;
            }
            // log4.debug("numBytesStr: ", numBytesStr);
            // log4.debug("numBytes: ", numBytes);
            // log4.debug("recordTypeStr: ", recordTypeStr);
            // log4.debug("recordTypeInt: ", recordTypeInt);
            try {
                const recordType = recordTypeInt;
                // log4.debug("recordType: ", recordType);
                switch (recordType) {
                    case RecordType.DATA:
                        // try to get 16bit block address
                        const blockAddrStr = line.substr(3, 4);
                        let blockAddr = parseInt(blockAddrStr, 16);
                        if (isNaN(recordTypeInt)) {
                            continue;
                        }
                        // the block address in the line is relative to a previous base address record (if there was one)
                        blockAddr += currentAddressBase;
                        // if this is the very first data block address in the image,
                        // this will be the address we report in the image header
                        // the OAD target will program the image starting at this address, after reboot
                        if (currentAddress === undefined) {
                            this.addr = blockAddr / (16 / 4); // block address is multiple of 4 as per OAD UG
                            this.imgBaseAddr = blockAddr;
                        }
                        // this is not the first address, check if we need to padd
                        if (currentAddress !== undefined && currentAddress < blockAddr) {
                            const numPadBytes = (blockAddr - currentAddress);
                            const padData = new Uint8Array(numPadBytes).fill(0xFF);
                            // Append to data
                            this.data = this.concat([this.data, padData]);
                        }
                        // log4.debug("data: ", this.data);
                        currentAddress = blockAddr;
                        // try to get the bytes as Data
                        const lineDataStr = line.substr(9, (numBytes * 2));
                        if (!lineDataStr) {
                            continue;
                        }
                        const lineData = this.hexToBytes(lineDataStr);
                        // log4.debug("lineData: ", lineData);
                        this.data = this.concat([this.data, lineData]);
                        // log4.debug("data: ", this.data);
                        currentAddress = currentAddress + lineData.length;
                        // log4.debug("currentAddress : ", currentAddress);
                        break;
                    case RecordType.EXT_LIN_ADDR:
                        // try to get ext seg 16bit address
                        const extLinAddrStr = line.substr(9, 4);
                        if (!extLinAddrStr) {
                            continue;
                        }
                        let extLinAddr = parseInt(extLinAddrStr, 16);
                        extLinAddr = extLinAddr << 16;
                        // update current base address. all subsequent addresses are relative to this base address
                        currentAddressBase = extLinAddr;
                        break;
                    case RecordType.EOF:
                        break;
                    default:
                        return false;
                }
            }
            catch (e) {
                log4.error("parsing failed for the line. continuing...", e);
                continue;
            }
        }
        //set image type
        if (this.data.length > 19) {
            //TODO: enum conversion might be not be safe here
            this.imgType = (this.data[18]);
        }
        return true;
    }
    calcImageCRC(startPage, data) {
        try {
            let crc = 0;
            let addr = startPage * 0x1000;
            let page = startPage;
            let pageEnd = new Int32(this.len / (0x1000 / 4)).Get();
            const osetEnd = (this.len - (pageEnd * (0x1000 / 4))) * 4;
            pageEnd += startPage;
            if (data.length === 0) {
                return -1;
            }
            // tslint:disable-next-line: no-constant-condition
            while (true) {
                let oset = 0;
                while (oset < 0x1000) {
                    // log4.debug(`page: ${page}, pageEnd: ${pageEnd}`);
                    if ((page === startPage) && (oset === 0x00)) {
                        // Skip the CRC and shadow.
                        // Note: this increments by 3 because oset is incremented by 1 in each pass
                        // through the loop
                        oset += 3;
                    }
                    else if ((page === pageEnd) && (oset === osetEnd)) {
                        crc = this.crc16(crc, 0x00);
                        crc = this.crc16(crc, 0x00);
                        return crc;
                    }
                    else {
                        crc = this.crc16(crc, this.data[addr + oset]);
                    }
                    oset += 1;
                }
                page += 1;
                addr = page * 0x1000;
            }
        }
        catch (ex) {
            console.error("Error calcuating crc of image: ", ex);
            return -1;
        }
    }
    // calculate a 16bit crc
    crc16(startCrc, startVal) {
        let val = startVal;
        let crc = startCrc;
        const poly = 0x1021;
        let cnt = 0;
        while (cnt < 8) {
            let msb = 0;
            if ((crc & 0x8000) === 0x8000) {
                msb = 1;
            }
            else {
                msb = 0;
            }
            crc <<= 1;
            if ((val & 0x80) === 0x80) {
                crc |= 0x0001;
            }
            if (msb === 1) {
                crc ^= poly;
            }
            cnt += 1;
            val <<= 1;
        }
        return crc;
    }
    resetProgress() {
        this.iBlocks = 0;
        this.nBlocks = new Int32(this.len / (this.OAD_BLOCK_SIZE / this.HAL_FLASH_WORD_SIZE)).Get();
    }
    concat(arrays) {
        // sum of individual array lengths
        const totalLength = arrays.reduce((acc, value) => acc + value.length, 0);
        if (!arrays.length) {
            return undefined;
        }
        const result = new Uint8Array(totalLength);
        // for each array - copy it over result
        // next array is copied right after the previous one
        let length = 0;
        for (const array of arrays) {
            result.set(array, length);
            length += array.length;
        }
        return result;
    }
    appendArrayBuffer(buffer1, buffer2) {
        const length1 = buffer1 ? buffer1.byteLength : 0;
        const length2 = buffer2 ? buffer2.byteLength : 0;
        const tmp = new Uint8Array(length1 + length2);
        if (tmp.length === 0) {
            return null;
        }
        if (buffer1) {
            tmp.set(new Uint8Array(buffer1), 0);
        }
        if (buffer2) {
            tmp.set(new Uint8Array(buffer2), length1);
        }
        return tmp.buffer;
    }
    hexToBytes(hex) {
        hex = hex.replace(" ", "");
        const bytes = [];
        for (let c = 0; c < hex.length; c += 2) {
            const byte = parseInt(hex.substr(c, 2), 16);
            if (isNaN(byte)) {
                throw Error("invalid hex string");
            }
            else {
                bytes.push(byte);
            }
        }
        return Uint8Array.from(bytes);
    }
    // Convert a byte array to a hex string
    bytesToHex(bytes) {
        const hex = [];
        for (let i = 0; i < bytes.length; i++) {
            const current = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
            hex.push((current >>> 4).toString(16));
            hex.push((current & 0xF).toString(16));
        }
        return hex.join("");
    }
    range(start, end, includeEnd = true) {
        const total = [];
        if ((!start && !end)) {
            return [];
        }
        if (end < start) {
            return [];
        }
        if (!includeEnd) {
            end = end - 1;
        }
        for (let i = start; i <= end; i += 1) {
            total.push(i);
        }
        return total;
    }
}






const log5 = logger.getLogger("vex-web-ble-device-manager-cdcdevice");
log5.setLevel(LoggerLevels.WARN);
log5.setHistoryLogger("vex-web-ble-device-manager");
//#region constants
const USER_PROG_CHUNK_SIZE = 4096; // chunk size
const USER_FLASH_START = 0x03000000; // start address of memory
const USER_FLASH_SYS_CODE_START = 0x03400000; // start address of user code
const USER_FLASH_USR_CODE_START = 0x03800000; // start address of user code
const USER_FLASH_END = 0x08000000; // end address of memory
const USER_FLASH_MAX_FILE_SIZE = 0x200000; // Maximum file size for QSPI
const USER_FLASH_START_B = 0x10200000; // special app flash start
const USER_FLASH_END_B = 0x10400000; // special app flash end
const USER_FLASH_START_C = 0x30200000; // special app flash start
const USER_FLASH_END_C = 0x31000000; // special app flash end
const FILE_READ_CHUNK_SIZE_BLE = 232; // chunk size for file read over BLE
const SUCCESS = 0;
const ERROR_BAD_OBJECT = -1;
const ERROR_NOT_CONNECTED = -2;
const ERROR_BAD_CATALOG = -3;
const ERROR_UNSUPPORTED_DEVICE = -4;
const ERROR_DOWNLOAD = -5;
const ERROR_DELETE = -6;
const ERROR_MUTEX = -98;
const ERROR_COMMUNICATION = -99;
;
//#endregion project info types
//#region download progress callback types
var DownloadState;
(function (DownloadState) {
    DownloadState[DownloadState["None"] = 0] = "None";
    DownloadState[DownloadState["DownloadingProgram"] = 1] = "DownloadingProgram";
    DownloadState[DownloadState["CheckingVM"] = 2] = "CheckingVM";
    DownloadState[DownloadState["DownloadingVM"] = 3] = "DownloadingVM";
    DownloadState[DownloadState["DownloadCompleted"] = 4] = "DownloadCompleted";
})(DownloadState || (DownloadState = {}));
class VEXCDCDevice {
    constructor(target, WriteDataAsync) {
        this.downloadAddress = USER_FLASH_USR_CODE_START;
        this.downloadAutoRun = VEXCDCDevice.OPTIONS.EXIT_RUN;
        this.downloadTarget = VEXCDCDevice.FILE_TARGET_QSPI;
        this.lastStatus = VEXCDCDevice.STATUS_GOOD;
        this.linkFile = undefined;
        this.linkFileVID = undefined;
        this.targetIsAIM = true;
        this.targetIsIQ2 = false;
        this.targetIsEXP = false;
        this.cdc = new VexCDC();
        this.target = "AIM";
        this.target = target;
        this.writeDataBLEAsync = WriteDataAsync;
        this.targetIsAIM = (target === "AIM");
        this.targetIsIQ2 = (target === "IQ2");
        this.targetIsEXP = (target === "EXP");
    }
    /**
    * Get the robot system flag status
    */
    brainGetSystemFlags(canBeConnecting = false) {
        log5.debug("brainGetSystemFlags");
        this.lastStatus = VEXCDCDevice.STATUS_GOOD;
        return new Promise((resolve, reject) => {
            this.writeDataAsync(this.cdc.V5_Cdc2FlagsStatus())
                .then((reply) => {
                if (reply !== undefined)
                    resolve(this.decodeSysFlagsRead(reply));
                else
                    resolve(undefined);
            })
                .catch((err) => {
                if (err instanceof ErrorGATT) {
                    reject(err);
                    return;
                }
                // perhaps we don't support this yet
                resolve(undefined);
            });
        });
    }
    /**
    * Set the download address
    */
    downloadAddressSet(addr) {
        log5.debug("downloadAddressSet", addr.toString(16));
        if (addr >= USER_FLASH_START && addr <= USER_FLASH_END) {
            this.downloadAddress = addr;
        }
        // temporary for IQ2
        if (addr >= USER_FLASH_START_B && addr <= USER_FLASH_END_B) {
            this.downloadAddress = addr;
        }
        // temporary for EXP
        if (addr >= USER_FLASH_START_C && addr <= USER_FLASH_END_C) {
            this.downloadAddress = addr;
        }
    }
    linkFileSet(vid, name) {
        this.linkFileVID = vid;
        this.linkFile = name;
    }
    /**
    * set options to send with program exit command after download
    * Not really working on the V5 yet (Mar 5 2018)
    */
    downloadAutoRunSet(state) {
        if (state !== undefined && state === false) {
            this.downloadAutoRun = this.targetIsAIM ? 0 : VEXCDCDevice.OPTIONS.EXIT_HALT;
        }
        else {
            this.downloadAutoRun = VEXCDCDevice.OPTIONS.EXIT_RUN;
        }
    }
    getVMLinkInfo() {
        if (this.targetIsAIM) {
            return {
                extType: 0x61,
                loadAddress: 0,
                linkFile: "",
                linkFileVID: 0,
            };
        }
        else if (this.targetIsIQ2) {
            return {
                extType: 0x61,
                loadAddress: 0x10300000,
                linkFile: "python_vm.bin",
                linkFileVID: VEXCDCDevice.VID.VEXVM,
            };
        }
        else if (this.targetIsEXP) {
            return {
                extType: 0x61,
                loadAddress: 0x30700000,
                linkFile: "python_vm.bin",
                linkFileVID: VEXCDCDevice.VID.VEXVM,
            };
        }
    }
    getPythonVmDownloadInfo() {
        if (this.targetIsIQ2) {
            return {
                address: 0x10300000,
                target: VEXCDCDevice.FILE_TARGET_FLASH,
                vid: 0xFF,
            };
        }
        else if (this.targetIsEXP) {
            return {
                address: 0x30700000,
                target: VEXCDCDevice.FILE_TARGET_FLASH,
                vid: 0xFF,
            };
        }
        else {
            return null;
        }
    }
    /**
   * Decode a cdc2 system flags command
   * @param msg
  */
    decodeSysFlagsRead(msg) {
        let buf = (msg instanceof ArrayBuffer) ? new Uint8Array(msg) : msg;
        let flags = undefined;
        if (this.cdc.cdc2ValidateMessage(buf)) {
            let dvb = new DataView(buf.buffer, buf.byteOffset);
            let extcmd = 4;
            var length = this.cdc.cdc2MessageGetLength(buf);
            if (length > 128) {
                extcmd = 5;
            }
            if (buf[extcmd] == VexCDC.ECMDS.SYS_FLAGS.cmd) {
                if (buf[extcmd + 1] == VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                    flags = dvb.getUint32(extcmd + 2, true);
                    if (length === 11) {
                        // new extended reply from beta 23
                        this.battery = (dvb.getUint8(extcmd + 6) & 0x0F) * 8;
                        if ((flags & 0x0100) != 0 || (flags & 0x0600) === 0x0600) {
                            this.batteryController = ((dvb.getUint8(extcmd + 6) >> 4) & 0x0F) * 8;
                        }
                        else {
                            this.batteryController = undefined;
                        }
                        // this.controllerTethered
                        if ((flags & 0x0600) === 0x0600) {
                            this.radioQuality = (dvb.getUint8(extcmd + 7) & 0x0F) * 8;
                            this.radioSearching = false;
                        }
                        else {
                            this.radioQuality = undefined;
                        }
                        if ((flags & 0x0600) === 0x0200) {
                            this.radioSearching = true;
                        }
                        else {
                            this.radioSearching = false;
                        }
                        if ((flags & 0x2000) != 0) {
                            this.batteryPartner = ((dvb.getUint8(extcmd + 7) >> 4) & 0x0F) * 8;
                        }
                        else {
                            this.batteryPartner = undefined;
                        }
                        // final byte is now running program, 0 for none. vexos 1.0.1 and on.
                        this.currentProgram = dvb.getUint8(extcmd + 8);
                        if (this.targetIsAIM) {
                            this.currentProgram = this.currentProgram & 0x0F;
                        }
                        if (this.battery && this.battery > 100) {
                            this.battery = 100;
                        }
                        if (this.batteryController && this.batteryController > 100) {
                            this.batteryController = 100;
                        }
                        if (this.radioQuality && this.radioQuality > 100) {
                            this.radioQuality = 100;
                        }
                        if (this.batteryPartner && this.batteryPartner > 100) {
                            this.batteryPartner = 100;
                        }
                    }
                }
            }
        }
        return flags;
    }
    /**
    * Decode a received File initialization reply
    * @param  (Uint8Array | ArrayBuffer} msg the CDC2 reply to decode
    */
    decodeFileInitReply(msg) {
        // Decode file init
        let reply = {
            ack: 0xFF,
            packetSize: 0,
            fileSize: 0,
            crc32: 0,
        };
        let buf = (msg instanceof ArrayBuffer) ? new Uint8Array(msg) : msg;
        if (this.cdc.cdc2ValidateMessage(buf)) {
            let dvb = new DataView(buf.buffer, buf.byteOffset);
            if (buf[4] == VexCDC.ECMDS.FILE_INIT.cmd) {
                reply.ack = buf[5];
                reply.packetSize = dvb.getUint16(6, true);
                reply.fileSize = dvb.getUint32(8, true);
                reply.crc32 = dvb.getUint32(12, true);
            }
        }
        return reply;
    }
    /**
    * Decode a get directory entry reply
    * @param  (Uint8Array | ArrayBuffer} msg the CDC2 reply to decode
    */
    decodeFileGetDirectoryEntryReply(msg) {
        // Decode file init
        const reply = {
            ack: 0xFF,
            index: 0,
            size: 0,
            loadAddr: 0,
            crc32: 0,
            type: 0,
            timestamp: 0,
            version: 0,
            name: '',
        };
        const buf = msg instanceof ArrayBuffer ? new Uint8Array(msg) : msg;
        if (this.cdc.cdc2ValidateMessage(buf)) {
            const dvb = new DataView(buf.buffer, buf.byteOffset);
            // get dir entry and get file metadata have same format
            if (buf[4] === VexCDC.ECMDS.FILE_DIR_ENTRY.cmd || buf[4] === VexCDC.ECMDS.FILE_GET_INFO.cmd) {
                reply.ack = buf[5];
                reply.index = buf[6];
                // new, check for ACK, could be no file error
                if (this.cdc.cdc2MessageGetLength(buf) > 4 && reply.ack === VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                    reply.size = dvb.getUint32(7, true);
                    reply.loadAddr = dvb.getUint32(11, true);
                    reply.crc32 = dvb.getUint32(15, true);
                    reply.type = dvb.getUint32(19, true);
                    reply.timestamp = dvb.getUint32(23, true) + VexCDC.J2000_EPOCH;
                    reply.version = dvb.getUint32(27, true);
                    // for development we allow full 32 byte filename to be returned now
                    let nameLen = dvb.byteLength - buf.byteOffset - 31 - 2;
                    if (nameLen > 32) {
                        nameLen = 32;
                    }
                    reply.name = '';
                    for (let offset = 31; offset < 31 + nameLen; offset++) {
                        const c = dvb.getUint8(offset);
                        if (c === 0) {
                            break;
                        }
                        reply.name += String.fromCharCode(c);
                    }
                }
            }
        }
        return reply;
    }
    /**
   * Decode a get metadata reply, same format as dir entry
   * @param msg the CDC2 reply to decode
   */
    decodeFileGetMetadataReply(msg) {
        let rep = undefined;
        const tmp = this.decodeFileGetDirectoryEntryReply(msg);
        if (tmp !== undefined) {
            rep = {
                ack: tmp.ack,
                linkvid: tmp.index,
                size: tmp.size,
                loadAddr: tmp.loadAddr,
                crc32: tmp.crc32,
                type: tmp.type,
                timestamp: tmp.timestamp,
                version: tmp.version,
                linkname: tmp.name
            };
        }
        return rep;
    }
    /**
    * Write data to through Admin Characteristics using CDC2
    * @param {ArrayBuffer} data the bytes to send
    * @param {vexcdc_writeOptions} opt_param2 the write data options
    * @return {Promise}
    */
    writeDataAsync(data, options) {
        return this.writeDataBLEAsync(data, options);
    }
    /**
    * Decode a received ack/mack
    * @param  (number} ack the CDC2 ack to decode
    */
    decodeFileNack(ack) {
        this.lastStatus = ack;
        switch (ack) {
            case VexCDC.CDC2_ACK_TYPES.CDC2_ACK:
                log5.debug('ack received');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK:
                log5.debug('nak received');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_PACKET_CRC:
                log5.debug('bad packet crc');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_CMD_LENGTH:
                log5.debug('payload length error');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_SIZE:
                log5.debug('requested transfer size too large');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_CRC:
                log5.debug('program crc error');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_FILE:
                log5.debug('program file not found error');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_INIT:
                log5.debug('file transfer is not initialized');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_FUNC:
                log5.debug('initialization invalid for this function');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_ALIGN:
                log5.debug('data alignment error (not multiple of 4 bytes)');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_ADDR:
                log5.debug('invalid packet address');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_INCOMPLETE:
                log5.debug('download incomplete');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_DIR_INDEX:
                log5.debug('directory entry at index does not exist');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_MAX_USER_FILES:
                log5.debug('max user files on file system');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_FILE_EXISTS:
                log5.debug('program exists and overwrite flag not set');
                break;
            case VexCDC.CDC2_ACK_TYPES.CDC2_NACK_FILE_SYS_FULL:
                log5.debug('file could not be writtem, file system may be full');
                break;
            default:
                log5.debug('unknown nak received');
                break;
        }
    }
    /**
     * Decode a received File write reply
     * @param  (Uint8Array | ArrayBuffer} msg the CDC2 reply to decode
     */
    decodeFileWriteReply(msg) {
        // Decode file init
        let reply = { ack: 0xFF };
        let buf = (msg instanceof ArrayBuffer) ? new Uint8Array(msg) : msg;
        if (this.cdc.cdc2ValidateMessage(buf)) {
            if (buf[4] == VexCDC.ECMDS.FILE_WRITE.cmd) {
                reply.ack = buf[5];
            }
        }
        return reply;
    }
    /**
    * Decode a factory firmware upgrade status reply
    * @param  (Uint8Array | ArrayBuffer} msg the CDC2 reply to decode
    */
    decodeFactoryStatusReply(msg) {
        const reply = {
            ack: 0xFF,
            status: -1,
            percent: 0
        };
        const buf = msg instanceof ArrayBuffer ? new Uint8Array(msg) : msg;
        reply.ack = buf[5];
        reply.status = buf[6];
        reply.percent = buf[7];
        return reply;
    }
    /**
    * Decode a received File read reply
    * @param msg the CDC2 reply to decode
    */
    decodeFileReadReply(msg) {
        // Decode file init
        const reply = { ack: 0xFF, length: 0, addr: 0, data: undefined };
        const buf = (msg instanceof ArrayBuffer) ? new Uint8Array(msg) : msg;
        if (this.cdc.cdc2ValidateMessage(buf)) {
            const dvb = new DataView(buf.buffer, buf.byteOffset);
            let extcmd = 4;
            const length = this.cdc.cdc2MessageGetLength(buf);
            if (length > 128) {
                extcmd = 5;
            }
            if (buf[extcmd] === VexCDC.ECMDS.FILE_READ.cmd) {
                if (length === 7) {
                    reply.ack = buf[5];
                }
                else {
                    reply.ack = VexCDC.CDC2_ACK_TYPES.CDC2_ACK;
                    reply.addr = dvb.getUint32(extcmd + 1, true);
                    reply.length = length - 7;
                    reply.data = new Uint8Array(buf.buffer, buf.byteOffset + extcmd + 5, reply.length);
                }
            }
        }
        return reply;
    }
    /**
   * Decode a received File Exit reply
   * @param  (Uint8Array | ArrayBuffer} msg the CDC2 reply to decode
   */
    decodeFileExitReply(msg) {
        // Decode file init
        let reply = { ack: 0xFF };
        let buf = (msg instanceof ArrayBuffer) ? new Uint8Array(msg) : msg;
        if (this.cdc.cdc2ValidateMessage(buf)) {
            if (buf[4] == VexCDC.ECMDS.FILE_EXIT.cmd) {
                reply.ack = buf[5];
            }
        }
        return reply;
    }
    /**
    * Decode a get directory reply
    * @param  (Uint8Array | ArrayBuffer} msg the CDC2 reply to decode
    */
    decodeFileGetDirectoryReply(msg) {
        // Decode file init
        const reply = { ack: 0xFF, count: 0 };
        const buf = (msg instanceof ArrayBuffer) ? new Uint8Array(msg) : msg;
        if (this.cdc.cdc2ValidateMessage(buf)) {
            const dvb = new DataView(buf.buffer, buf.byteOffset);
            if (buf[4] == VexCDC.ECMDS.FILE_DIR.cmd) {
                reply.ack = buf[5];
                reply.count = dvb.getUint16(6, true);
            }
        }
        return reply;
    }
    /**
    * Set the download target
    */
    downloadTargetSet(target) {
        if (target === VEXCDCDevice.FILE_TARGET_DDR || target === VEXCDCDevice.FILE_TARGET_QSPI) {
            this.downloadTarget = target;
        }
        else if (target === VEXCDCDevice.FILE_TARGET_A1 || target === VEXCDCDevice.FILE_TARGET_B1 || target === VEXCDCDevice.FILE_TARGET_B2) {
            this.downloadTarget = target;
        }
        else if (target === VEXCDCDevice.FILE_TARGET_CBUF) {
            this.downloadTarget = target;
        }
        else if (target === VEXCDCDevice.FILE_TARGET_VBUF) {
            this.downloadTarget = target;
        }
        else if (target === VEXCDCDevice.FILE_TARGET_DDRC) {
            this.downloadTarget = target;
        }
        else if (target === VEXCDCDevice.FILE_TARGET_DDRE) {
            this.downloadTarget = target;
        }
        else if (target === VEXCDCDevice.FILE_TARGET_FLASH) {
            this.downloadTarget = target;
        }
        else if (target === VEXCDCDevice.FILE_TARGET_RADIO) {
            this.downloadTarget = target;
        }
    }
    /**
    * Download ArrayBuffer (Uint8Array) to the vexv5
    * serial link should be open before calling this function.
    */
    downloadData(name, buf, progressCallback, doneCallback, vid, extType) {
        // We need some data
        // and must be connected
        if (buf === undefined) {
            // error !
            if (doneCallback != undefined) {
                doneCallback(false);
            }
            return;
        }
        // no download to special capture or vision buffers
        if (this.downloadTarget === VEXCDCDevice.FILE_TARGET_CBUF || this.downloadTarget === VEXCDCDevice.FILE_TARGET_VBUF) {
            // error !
            if (doneCallback != undefined) {
                doneCallback(false);
            }
            return;
        }
        /** flag to indicate that this will need to write to QSPI and adjust the progress */
        const hasQSPI = this.downloadTarget === VEXCDCDevice.FILE_TARGET_A1 ||
            this.downloadTarget === VEXCDCDevice.FILE_TARGET_B1 ||
            this.downloadTarget === VEXCDCDevice.FILE_TARGET_B2;
        const mainWriteScale = hasQSPI ? 0.5 : 1;
        // vid can now be passed in
        vid = (vid === undefined) ? VEXCDCDevice.VID.USER : vid;
        // an extended type for files can now be passed in
        extType = (extType === undefined) ? 0 : extType;
        // address to download to
        let nextAddress = this.downloadAddress;
        // clear status
        this.lastStatus = VEXCDCDevice.STATUS_GOOD;
        // and do the download......
        this.writeDataAsync(this.cdc.query1())
            .then((reply) => {
            if (this.downloadTarget === VEXCDCDevice.FILE_TARGET_A1 ||
                this.downloadTarget === VEXCDCDevice.FILE_TARGET_B1 ||
                this.downloadTarget === VEXCDCDevice.FILE_TARGET_B2) {
                return (this.writeDataAsync(this.cdc.V5_Cdc2FactoryEnable()));
            }
        })
            .then((reply) => {
            let target = this.downloadTarget;
            log5.debug('download to', this.cdc.hex8(nextAddress), 'with', buf.length, 'bytes');
            // large buffers always go to DDR
            if (buf.length > USER_FLASH_MAX_FILE_SIZE && this.downloadTarget == VEXCDCDevice.FILE_TARGET_QSPI) {
                target = VEXCDCDevice.FILE_TARGET_DDR;
            }
            log5.debug('download target is ' + (target === VEXCDCDevice.FILE_TARGET_DDR ? 'DDR' :
                target === VEXCDCDevice.FILE_TARGET_DDRC ? 'DDRC' :
                    target === VEXCDCDevice.FILE_TARGET_DDRE ? 'DDRE' :
                        target === VEXCDCDevice.FILE_TARGET_FLASH ? 'FLASH' :
                            target === VEXCDCDevice.FILE_TARGET_RADIO ? 'RADIO' :
                                target === VEXCDCDevice.FILE_TARGET_QSPI ? 'QSPI' : 'SYS'));
            // normal timeout on V5
            let timeout = 1000;
            // Is this an IQ2 or EXP, if so we need long timeout for flash erase
            if (this.target === "IQ2" ||
                this.target === "EXP") {
                // special app flash timeout, erase can be long
                if (target === VEXCDCDevice.FILE_TARGET_FLASH || target === VEXCDCDevice.FILE_TARGET_RADIO)
                    timeout = 15000;
                // vexos update needs long timeout
                if (target === VEXCDCDevice.FILE_TARGET_A1 || target === VEXCDCDevice.FILE_TARGET_B1 || target === VEXCDCDevice.FILE_TARGET_B2) {
                    timeout = 30000;
                }
            }
            return this.writeDataAsync(this.cdc.V5_Cdc2FileInitialize(VEXCDCDevice.FILE_FUNC_SAVE, target, vid, VEXCDCDevice.OPTIONS.FILE_OVERWRITE, buf, nextAddress, name, extType), { timeout });
        })
            .then((reply) => {
            let rep = this.decodeFileInitReply(reply);
            log5.debug("file write resp:", JSON.stringify(rep));
            if (rep.ack !== VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                this.decodeFileNack(rep.ack);
                throw reply;
            }
            let bufferChunkSize = (rep.packetSize > 0 && rep.packetSize <= USER_PROG_CHUNK_SIZE) ? rep.packetSize : USER_PROG_CHUNK_SIZE;
            var bufferOffset = 0;
            log5.debug('download chunk size is', bufferChunkSize);
            return new Promise((resolve, reject) => {
                var lastBlock = false;
                // TODO: change to a loop...
                var sendBlock = () => {
                    var tempBuffer;
                    if (buf.byteLength - bufferOffset > bufferChunkSize) {
                        tempBuffer = buf.subarray(bufferOffset, bufferOffset + bufferChunkSize);
                    }
                    else {
                        // last chunk
                        // word align length
                        let length = (((buf.byteLength - bufferOffset) + 3) / 4) >>> 0;
                        tempBuffer = new Uint8Array(length * 4);
                        tempBuffer.set(buf.subarray(bufferOffset, buf.byteLength));
                        //tempBuffer = buf.subarray( bufferOffset, buf.byteLength );
                        lastBlock = true;
                    }
                    log5.debug("Write addr", this.cdc.hex8(nextAddress), 'Size', tempBuffer.length);
                    // Write the chunk
                    this.writeDataAsync(this.cdc.V5_Cdc2FileDataWrite(nextAddress, tempBuffer), { retryOnTimeout: true })
                        .then((reply) => {
                        // check reply
                        let rep = this.decodeFileWriteReply(reply);
                        if (rep.ack !== VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                            this.decodeFileNack(rep.ack);
                            reject(reply);
                        }
                        // last block sent ?
                        if (lastBlock) {
                            resolve(reply);
                        }
                        else {
                            sendBlock();
                        }
                    })
                        .catch((reply) => {
                        reject(reply);
                    });
                    // update progress
                    if (progressCallback) {
                        progressCallback(bufferOffset / buf.byteLength * mainWriteScale, bufferOffset * mainWriteScale, buf.byteLength);
                    }
                    // next chunk
                    bufferOffset += bufferChunkSize;
                    nextAddress += bufferChunkSize;
                };
                // Send first block
                sendBlock();
            });
        })
            .then((reply) => {
            // see if we need to set link file and vid before sending exit
            // only do this for .bin files
            if (this.linkFile !== undefined && name.match(/.bin/)) {
                let savedExitReply = reply;
                log5.debug("download send link file for", name, "as", this.linkFileVID, ":", this.linkFile);
                return this.writeDataAsync(this.cdc.V5_Cdc2FileLinkFile(this.linkFileVID, 0, this.linkFile))
                    .then(() => {
                    return savedExitReply;
                });
            }
            else
                return reply;
        })
            .then((reply) => {
            log5.debug('download exit');
            return this.writeDataAsync(this.cdc.V5_Cdc2FileExit(this.downloadAutoRun), { timeout: 10000 });
        })
            .then((reply) => {
            // when sending firmware we have to wait for QSPI to be programmed
            //
            if (this.downloadTarget === VEXCDCDevice.FILE_TARGET_A1 ||
                this.downloadTarget === VEXCDCDevice.FILE_TARGET_B1 ||
                this.downloadTarget === VEXCDCDevice.FILE_TARGET_B2) {
                let savedExitReply = reply;
                log5.debug('download - programming flash');
                return new Promise((resolve, reject) => {
                    var pollStatus = () => {
                        this.writeDataAsync(this.cdc.V5_Cdc2FactoryStatus(), { timeout: 5000 })
                            .then((reply) => {
                            // check reply
                            let rep = this.decodeFactoryStatusReply(reply);
                            if (rep.ack !== VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                                this.decodeFileNack(rep.ack);
                                reject(reply);
                            }
                            // percent of 255 indicates error
                            if (rep.percent === 255) {
                                reject(reply);
                            }
                            // Done ?
                            if (rep.status == 0) {
                                resolve(savedExitReply);
                            }
                            else {
                                progressCallback(0.0, buf.byteLength / 200 * (100 + rep.percent), buf.byteLength);
                                setTimeout(() => { pollStatus(); }, 500);
                            }
                        })
                            .catch((err) => {
                            if (err instanceof ErrorGATT) {
                                reject(err);
                                return;
                            }
                            reject(undefined);
                        });
                    };
                    pollStatus();
                    // clear any firmware download target
                    this.downloadTargetSet(VEXCDCDevice.FILE_TARGET_QSPI);
                });
            }
            else
                return (reply);
        })
            .then((reply) => {
            log5.debug('download done', this.cdc.convertBufferToHexString(reply));
            // check final reply from exit command 
            let status = true;
            let rep = this.decodeFileExitReply(reply);
            if (rep.ack !== VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                this.decodeFileNack(rep.ack);
                status = false;
            }
            // update progress
            if (progressCallback) {
                progressCallback(1.0, buf.byteLength, buf.byteLength);
            }
            if (doneCallback) {
                doneCallback(status);
            }
        })
            .catch((reply) => {
            log5.warn('download error');
            // update progress
            if (reply instanceof ErrorGATT) {
                throw reply;
            }
            if (progressCallback) {
                progressCallback(1.0, buf.byteLength, buf.byteLength);
            }
            if (doneCallback) {
                doneCallback(false);
            }
        });
    }
    /**
    * Download ArrayBuffer (Uint8Array) to the vexv5
    * serial link should be open before calling this function.
    * async using promise
    */
    downloadDataAsync(name, buf, callback, vid, extType) {
        return new Promise((resolve, reject) => {
            //start timer to measure the elapsed time
            let st = Date.now();
            this.downloadData(name, buf, callback, (status) => {
                // log the elapsed time in milliseconds
                log5.info(`download stats - size(bytes): ${buf === null || buf === void 0 ? void 0 : buf.byteLength}  elapsed time(ms):", ${Date.now() - st}`);
                // leave resolving status to caller
                resolve(status);
            }, vid, extType);
        });
    }
    /**
    * Upload ArrayBuffer (Uint8Array) from the robot
    * serial link should be open before calling this function.
    * @param name name of the file to upload from the robot
    * @param length length of the file to upload
    * @param progressCallback callback that is passed the current transfer progress with a range of 0-1
    * @param doneCallback callback that is passed the status of the upload
    * @param vid optional vid for the file
    */
    uploadData(name, length, progressCallback, doneCallback, vid) {
        // this should be handled by the caller
        // we must be connected 
        // if (!this.connected) {
        //     // error !
        //     if (doneCallback != undefined)
        //         doneCallback(false, undefined);
        //     return;
        // }
        let st = 0;
        // vid can now be passed in
        vid = (vid === undefined) ? VEXCDCDevice.VID.USER : vid;
        // address to upload from, not important when uploading from QSPI
        var nextAddress = 0;
        if (this.downloadTarget === VEXCDCDevice.FILE_TARGET_DDR || this.downloadTarget === VEXCDCDevice.FILE_TARGET_CBUF || this.downloadTarget === VEXCDCDevice.FILE_TARGET_VBUF)
            nextAddress = this.downloadAddress;
        // receive buffer, yet to be assigned
        let buf = undefined;
        let crchead = undefined;
        // clear status
        this.lastStatus = VEXCDCDevice.STATUS_GOOD;
        // and do the download......
        this.writeDataAsync(this.cdc.query1())
            .then((reply) => {
            let target = this.downloadTarget;
            log5.info("upload start - address", this.cdc.hex8(nextAddress), "vid", this.cdc.hex8(vid));
            st = Date.now();
            return this.writeDataAsync(this.cdc.V5_Cdc2FileInitialize(VEXCDCDevice.FILE_FUNC_READ, target, vid, 0, undefined, nextAddress, name), { timeout: 1000 });
        })
            .then((reply) => {
            let rep = this.decodeFileInitReply(reply);
            let bufferChunkSize = (rep.packetSize > 0 && rep.packetSize <= FILE_READ_CHUNK_SIZE_BLE) ? rep.packetSize : FILE_READ_CHUNK_SIZE_BLE;
            let bufferOffset = 0;
            let dataLength = rep.fileSize;
            let requestChunkSize = 0;
            // uploading from DDR, use requested length
            if (dataLength === 0 && (this.downloadTarget === VEXCDCDevice.FILE_TARGET_DDR || this.downloadTarget === VEXCDCDevice.FILE_TARGET_CBUF || this.downloadTarget === VEXCDCDevice.FILE_TARGET_VBUF))
                dataLength = length;
            // some really weird issues with screen capture when all 0xFF
            if (bufferChunkSize === 512)
                bufferChunkSize = 496;
            log5.debug("upload data len is", dataLength);
            log5.debug("upload chunk size is", bufferChunkSize);
            // resize buffer, sanity check on size
            if (dataLength > 0 && dataLength < USER_FLASH_MAX_FILE_SIZE) {
                buf = new Uint8Array(dataLength);
            }
            // save crc
            crchead = rep.crc32;
            return new Promise((resolve, reject) => {
                var lastBlock = false;
                var readBlock = () => {
                    if (buf.byteLength - bufferOffset > bufferChunkSize) {
                        requestChunkSize = bufferChunkSize;
                    }
                    else {
                        requestChunkSize = buf.byteLength - bufferOffset;
                        lastBlock = true;
                    }
                    log5.debug("Read addr", this.cdc.hex8(nextAddress), "Size", requestChunkSize);
                    // Read the chunk
                    this.writeDataAsync(this.cdc.V5_Cdc2FileDataRead(nextAddress, (requestChunkSize + 3) & 0xFFFFFFFC), { timeout: 5000 })
                        .then((reply) => {
                        // check reply
                        let rep = this.decodeFileReadReply(reply);
                        if (rep.ack !== VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                            this.decodeFileNack(rep.ack);
                            reject(reply);
                        }
                        // copy received data
                        buf.set(rep.data.subarray(0, requestChunkSize), bufferOffset);
                        bufferOffset += requestChunkSize;
                        // last block sent ?
                        if (lastBlock) {
                            // check crc
                            let crc = crc32(buf, 0);
                            // memory upload doesn't have crc
                            if (this.downloadTarget === VEXCDCDevice.FILE_TARGET_DDR ||
                                this.downloadTarget === VEXCDCDevice.FILE_TARGET_CBUF ||
                                this.downloadTarget === VEXCDCDevice.FILE_TARGET_VBUF ||
                                crchead === 0xFFFFFFFF) {
                                crc = crchead;
                            }
                            if (crchead === crc) {
                                log5.debug("upload: good crc", this.cdc.hex8(crc));
                                resolve(reply);
                            }
                            else {
                                reject(reply);
                            }
                        }
                        else {
                            readBlock();
                        }
                    })
                        .catch((reply) => {
                        if (reply instanceof ErrorGATT) {
                            reject(reply);
                            return;
                        }
                        reject(reply);
                    });
                    // update progress
                    if (progressCallback != undefined)
                        progressCallback(bufferOffset / buf.byteLength);
                    // next chunk
                    nextAddress += requestChunkSize;
                };
                // Send first block
                readBlock();
            });
        })
            .then((reply) => {
            log5.info("upload exit");
            // remove run option, has no meaning
            // V5 will just ACK this
            return this.writeDataAsync(this.cdc.V5_Cdc2FileExit(0), { timeout: 100 });
        })
            .then((reply) => {
            var delta = (Date.now() - st) / 1000.0;
            log5.info("upload done elapsed time", delta, "sec");
            // update progress
            if (progressCallback != undefined) {
                progressCallback(1.0);
            }
            if (doneCallback != undefined) {
                doneCallback(true, buf);
            }
        })
            .catch((reply) => {
            if (reply instanceof ArrayBuffer) {
                log5.warn("upload error", this.buf2hex(reply));
            }
            else {
                log5.warn("upload error", reply);
            }
            if (reply instanceof ErrorGATT) {
                throw reply;
            }
            // update progress
            if (progressCallback != undefined) {
                progressCallback(0);
            }
            if (doneCallback != undefined) {
                doneCallback(false, undefined);
            }
        });
    }
    /**
    * writes the file to the connected robot
    * @param filename the name of the file to write to the robot
     * @param data the file contents
    * @param progressCallback progress callback for how the write is going
    * @param vid optional vid for where to write the file
    */
    saveFileToRobot(filename, data, progressCallback, vid) {
        return this.downloadDataAsync(filename, data, (progressValue, current, total) => {
            if (progressCallback) {
                progressCallback(progressValue);
            }
        }, vid);
    }
    /**
    * Generic function for reading file from the robot.
    * @param filename the name of the file to read from the robot
    * @param progressCallback progress callback for how the read is going
    * @param vid optional vid for where to find the file
    * @returns a promise that resolves to the file data as an Uint8Array or null if the file does not exist
    */
    async readFileFromRobot(filename, progressCallback, vid) {
        log5.info("readFileFromRobot called for:", filename, vid);
        const robotFiles = await this.getDirectory(vid);
        log5.debug("readFileFromRobot - file on robot: " + JSON.stringify(robotFiles));
        const targetFile = robotFiles.find((file) => file.name === filename);
        log5.debug("readFileFromRobot - target file: " + JSON.stringify(targetFile));
        if (!targetFile) {
            return null;
        }
        // with the info about the file on the robot, now we just need to read it and return the data.
        return await new Promise((resolve, reject) => {
            this.uploadData(filename, targetFile.size, progressCallback, (success, data) => {
                if (success) {
                    resolve(data);
                }
                else {
                    reject(new Error("error reading file"));
                }
            }, vid);
        });
    }
    /**
    * Delete specified file from the robot.
    * @param filename the name of the file to remove
    * @param vid the VID of the file to remove
    * @returns true if the file was deleted
    */
    deleteFile(filename, vid) {
        return new Promise((resolve, reject) => {
            this.writeDataAsync(this.cdc.query1())
                .then((reply) => {
                return this.writeDataAsync(this.cdc.V5_Cdc2FileErase(vid, 0, filename));
            })
                .then((reply) => {
                return this.writeDataAsync(this.cdc.V5_Cdc2FileExit(0), { timeout: 1000 });
            })
                .then((reply) => {
                resolve(true);
            })
                .catch((reply) => {
                if (reply instanceof ErrorGATT) {
                    reject(reply);
                    return;
                }
                resolve(false);
            });
        });
    }
    /**
    * Download program data to v5
    */
    downloadProgramData(basename, binFile, iniFile, prjFile, progressCallback, doneCallback, extType) {
        // binfile is mandatory
        if (!binFile) {
            doneCallback(false);
        }
        // Create file names.
        // Find basename of file
        const re = /(.+?)(\.[^.]*$|$)/;
        const name = re.exec(basename)[1];
        // create names for the program files, all have same basename
        const binFileName = name + '.bin';
        const iniFileName = name + '.ini';
        const prjFileName = name + '.prj';
        // get total download size
        let totalBytes = binFile.byteLength;
        totalBytes += (iniFile !== undefined ? iniFile.byteLength : 0);
        totalBytes += (prjFile !== undefined ? prjFile.byteLength : 0);
        let totalDone = 0;
        // intermediate progress function, we need to account for multiple files now
        const onProgress = (progress, current, total) => {
            if (progressCallback) {
                progressCallback((totalDone + current) / totalBytes, totalBytes);
            }
            if (progress === 1.0) {
                totalDone += total;
                current = 0;
                log5.info("download complete", totalDone, totalBytes);
            }
        };
        log5.info("download ini file", iniFileName);
        this.downloadDataAsync(iniFileName, iniFile, onProgress)
            .then((status) => {
            if (iniFile === undefined || status === true) {
                log5.info("download src file", prjFileName);
                return this.downloadDataAsync(prjFileName, prjFile, onProgress);
            }
            else {
                throw false;
            }
        })
            .then((status) => {
            if (prjFile === undefined || status === true) {
                log5.info("download bin file", binFileName);
                return this.downloadDataAsync(binFileName, binFile, onProgress, undefined, extType);
            }
            else {
                throw false;
            }
        })
            .then((status) => {
            this.linkFileSet(undefined, undefined);
            if (doneCallback) {
                doneCallback(status);
            }
        })
            .catch((err) => {
            this.linkFileSet(undefined, undefined);
            if (doneCallback) {
                doneCallback(false);
            }
        });
    }
    async downloadProgram(data, info, progressCallback) {
        if (info.slot < 0 || info.slot > 7) {
            log5.warn("slot is out of range");
            return false;
        }
        const buffer = new Uint8Array(data);
        const path = `slot_${info.slot + 1}`;
        // create iniFile
        const ini = new VexINI();
        ini.programSlotSet(info.slot);
        ini.programNameSet(info.name);
        ini.programDescriptionSet(info.description);
        ini.programIconSet(info.icon);
        ini.projectIdeSet(info.ide);
        for (const port of info.ports) {
            if (port && port.port >= 1 && port.port <= 21 && port.label) {
                ini.addPortConfig(port.port, port.label);
            }
        }
        for (const port of info.triports) {
            if (port &&
                port.port >= 1 && port.port <= 21 &&
                port.subport >= 0 && port.subport <= 7 &&
                port.label) {
                ini.addAdiPortConfig(port.port, port.subport, port.label);
            }
        }
        let controllerKey;
        if (info.controller1) {
            for (controllerKey in info.controller1) {
                ini.addControllerConfig(0, controllerKey, info.controller1[controllerKey]);
            }
        }
        if (info.controller2) {
            for (controllerKey in info.controller2) {
                ini.addControllerConfig(1, controllerKey, info.controller2[controllerKey]);
            }
        }
        let vmUpdateNeeded = false;
        let downloadState = DownloadState.None;
        let vmProgress = 0;
        let progProgress = 0;
        const callBackAggregator = (progress) => {
            let finalProgress = 0;
            //error check
            if (progress == -1) {
                finalProgress = -1;
            }
            else if (vmUpdateNeeded) {
                finalProgress = (progProgress + vmProgress) / 2;
            }
            else {
                finalProgress = progProgress;
            }
            if (progressCallback) {
                progressCallback({ "progress": finalProgress, "state": downloadState });
            }
        };
        const callBackProgramDownload = (progress) => {
            downloadState = DownloadState.DownloadingProgram;
            progProgress = progress;
            callBackAggregator(progress);
        };
        const callBackVMDownload = (data) => {
            downloadState = data.state;
            if (data.state == DownloadState.DownloadingVM) {
                vmUpdateNeeded = true;
                vmProgress = data.progress;
                callBackAggregator(data.progress);
            }
        };
        let extType = 0;
        const iniFile = new TextEncoder().encode(ini.createIni());
        log5.debug("program options/ini parameters : ", info);
        if (info.language === "python") {
            log5.debug("skipping vm check for python");
            // configure the download for the 
            const linkInfo = this.getVMLinkInfo();
            this.downloadAddressSet(linkInfo.loadAddress);
            this.linkFileSet(linkInfo.linkFileVID, linkInfo.linkFile);
            extType = linkInfo.extType;
        }
        else {
            // this should not be needed, but it should not hurt
            this.downloadAddressSet(VEXCDCDevice.USR_ADDRESS);
        }
        // download the user program
        log5.info("downloading user project", this.downloadAddress);
        const autorun = info && info.autorun ? info.autorun : false;
        this.downloadAutoRunSet(autorun);
        return await new Promise((resolve) => {
            this.downloadProgramData(path, buffer, iniFile, undefined, callBackProgramDownload, (status) => {
                // put internal autorun back to default
                this.downloadAutoRunSet(true);
                this.downloadAddressSet(VEXCDCDevice.USR_ADDRESS);
                if (status === true)
                    resolve(true); // SUCCESS
                else
                    resolve(false); // ERROR_DOWNLOAD
            }, extType);
        });
    }
    /**
    * Get directory from user folder from brain
    */
    getDirectory(vid) {
        return new Promise((resolve, reject) => {
            const entries = [];
            vid = vid === undefined ? VEXCDCDevice.VID.USER : vid;
            this.lastStatus = VEXCDCDevice.STATUS_GOOD;
            // get whole directory
            this.writeDataAsync(this.cdc.query1())
                .then((reply) => {
                return this.writeDataAsync(this.cdc.V5_Cdc2FileDir(vid, 0));
            })
                .then((reply) => {
                let rep = this.decodeFileGetDirectoryReply(reply);
                if (rep.ack === VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                    const dirCount = rep.count;
                    let dirEntryIndex = 0;
                    // Now iterate to get all entries
                    return new Promise((resolve, reject) => {
                        // Get one dir entry
                        var getDirEntry = () => {
                            // send command
                            this.writeDataAsync(this.cdc.V5_Cdc2FileDirEntry(dirEntryIndex))
                                .then((reply) => {
                                const rep = this.decodeFileGetDirectoryEntryReply(reply);
                                if (rep.ack === VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                                    dirEntryIndex++;
                                    //this.log( rep.name );
                                    entries.push(rep);
                                    if (dirEntryIndex >= dirCount) {
                                        resolve(reply);
                                    }
                                    else {
                                        getDirEntry();
                                    }
                                }
                                else {
                                    reject(reply);
                                }
                            })
                                .catch((reply) => {
                                if (reply instanceof ErrorGATT) {
                                    reject(reply);
                                    return;
                                }
                                reject(reply);
                            });
                        };
                        // Get first entry
                        if (dirCount > 0) {
                            getDirEntry();
                        }
                        else {
                            resolve(undefined);
                        }
                    });
                }
                else {
                    this.decodeFileNack(rep.ack);
                }
            })
                .then((reply) => {
                resolve(entries);
            })
                .catch((reply) => {
                if (reply instanceof ErrorGATT) {
                    reject(reply);
                    return;
                }
                resolve([]);
            });
        });
    }
    /**
   * Get metadata for named file
   * @param name the name of the file
   * @param vid the vid for the file
   * @returns the metadata for the specified file
   */
    async getProgramMetadata(name, vid) {
        // was there any folder at all ?
        if (name.match('^....\/') !== null) {
            name = name.slice(5);
        }
        this.lastStatus = VEXCDCDevice.STATUS_GOOD;
        try {
            await this.writeDataAsync(this.cdc.query1());
            const metadataResp = await this.writeDataAsync(this.cdc.V5_Cdc2FileMetadataGet(vid, 0, name));
            log5.debug("metadataResp:", metadataResp);
            const rep = this.decodeFileGetMetadataReply(metadataResp);
            if (rep.ack === VexCDC.CDC2_ACK_TYPES.CDC2_ACK) {
                return rep;
            }
            else {
                return undefined;
            }
        }
        catch (err) {
            if (err instanceof ErrorGATT) {
                throw err;
            }
            return undefined;
        }
    }
    async checkPythonVm(name, crc, version) {
        try {
            // unofficial way to get access to serial device
            const metadata = await this.getProgramMetadata(name, VEXCDCDevice.VID.VEXVM);
            log5.debug("metadata:", metadata);
            if (metadata === undefined) {
                // no VM
                // serial.reset();
                log5.debug("found no VM");
                return { exists: false, valid: false };
            }
            log5.debug("Python VM metadata: ", JSON.stringify(metadata, null, 2));
            if (metadata.crc32 !== crc || metadata.version !== version) {
                // invalid VM
                log5.debug("found invalid VM");
                return { exists: true, valid: false };
            }
            // Valid VM
            log5.debug("found valid VM");
            return { exists: true, valid: true };
        }
        catch (e) {
            log5.error("error on checking VM ", e);
            throw { err: -1, data: e, msg: "Error on checking VM" };
        }
    }
    getPythonVMResourcePath() {
        if (this.targetIsIQ2) {
            return "resources/iq2/vm/python_vm.bin";
        }
        else if (this.targetIsEXP) {
            return "resources/exp/vm/python_vm.bin";
        }
        else {
            log5.warn("invalid target for Python VM");
        }
        return "";
    }
    async getPythonVMFile() {
        try {
            const vm_bin_path = this.getPythonVMResourcePath();
            const response = await fetch(vm_bin_path);
            if (!response.ok) {
                throw new Error(`Failed to fetch Python VM: ${response.status}`);
            }
            const vm_binary = await response.blob();
            if (vmBinary.size === 0) {
                throw new Error(`Python VM binary at ${vm_bin_path} is empty`);
            }
            const arrayBuffer = await vmBinary.arrayBuffer();
            let binfile = new Uint8Array(arrayBuffer);
            let result = { err: 0, msg: "VM file read successfully!", data: binfile };
            return result;
        }
        catch (e) {
            log5.error("Error when reading Python VM from  Application's /resources");
            let result = { err: -1, msg: "Error when reading Python VM from  Application's /resources", data: "" };
            throw result
        }
    }
    postVMDownloadCleanup() {
        this.downloadTargetSet(VEXCDCDevice.FILE_TARGET_QSPI);
        this.downloadAddressSet(VEXCDCDevice.USR_ADDRESS);
    }
    async checkAndInstallPythonVm(crc, version, progressCallback, force = false) {
        if (progressCallback) {
            progressCallback({ "progress": 0, "state": DownloadState.CheckingVM });
        }
        // There have been issues where we start to request the VM information,
        // but we don't get a response back from the brain. When this happens
        // VEXcode basically gets stuck in a state where it thinks it is downloading
        // a project. This blocks all future downloads until the app is restarted.
        // to prevent that, we have added a simple timeout. We use the native
        // promise.race feature to handle returning either the VM result or the
        // timeout error to force a failed download.
        // this is the normal promise used to get the VM data from the brain
        const VMCheckPromise = this.checkPythonVm("python_vm.bin", crc, version);
        // this is the timeout promise, used to limit the check to a max of 2 seconds
        const timeoutPromise = new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve(null);
            }, 3000); // increased to 3 seconds to allow for slower connections over ble  compared to serial
        });
        // now that we have the promises. use whichever one resolves first.
        const vmCheckResult = await Promise.race([VMCheckPromise, timeoutPromise]);
        log5.info("VM available check : ", vmCheckResult, "force:", force);
        if (vmCheckResult) {
            if (!vmCheckResult.exists || (vmCheckResult.exists && !vmCheckResult.valid) || force) {
                log5.info("downloading Python VM to brain...");
                // download progress
                const onProgress = (value, total) => {
                    if (progressCallback) {
                        progressCallback({ "progress": value, "state": DownloadState.DownloadingVM });
                    }
                };
                const vm_content = await this.getPythonVMFile();
                // log5.debug(vm_content);
                if (vm_content && vm_content.err == 0 && vm_content.data) {
                    // save autorun setting
                    const current_ar_setting = this.downloadAutoRun;
                    this.downloadAutoRun = 0;
                    // V5 configuration as default
                    let vid = VEXCDCDevice.VID.VEXVM;
                    const exttype = 0x61;
                    const downloadInfo = this.getPythonVmDownloadInfo();
                    log5.debug("downloadInfo:", downloadInfo);
                    if (downloadInfo.address) {
                        this.downloadAddressSet(downloadInfo.address);
                    }
                    if (downloadInfo.target) {
                        this.downloadTargetSet(downloadInfo.target);
                    }
                    if (downloadInfo.vid) {
                        vid = downloadInfo.vid;
                    }
                    if (downloadInfo.version) {
                        // we set this here, it will be reset back to 1 after download
                        this.cdc.V5_Cdc2SetFileVersion(downloadInfo.version);
                    }
                    else {
                        this.cdc.V5_Cdc2SetFileVersion(1);
                    }
                    log5.debug("vid:", vid);
                    // TODO: do not try to download the VM over the controller
                    // send data to brain
                    try {
                        const downloadStatus = await this.downloadDataAsync('python_vm.bin', vm_content.data, onProgress, vid, exttype);
                        log5.debug("VM downloadStatus:", downloadStatus);
                        if (!downloadStatus) {
                            throw false;
                        }
                        // restore autorun setting
                        this.downloadAutoRun = current_ar_setting;
                        let result = { err: 0, msg: "VM download successful", data: downloadStatus };
                        log5.info("VM download successful");
                        this.postVMDownloadCleanup();
                        return result;
                    }
                    catch (err) {
                        // restore autorun setting
                        this.downloadAutoRun = current_ar_setting;
                        let result = { err: -1, msg: "VM download error", data: err };
                        log5.error("VM download error");
                        this.postVMDownloadCleanup();
                        return result;
                    }
                }
            }
            else {
                let result = { err: 0, msg: "valid VM already exists on the brain", data: "" };
                log5.info("valid VM already exists on the brain");
                return result;
            }
        }
        else {
            log5.error("VM available check failed");
            return { err: -2, msg: "VM check failed", data: null };
        }
    }
    /**
    * Grab screen layer - debug and test
    * @param layer
    * @param doneCallback
    * @param progressCallback callback that is passed the current transfer progress with a range of 0-1
    * @param imagesize optional image size for for the screen data
    */
    uploadScreenLayer(layer, doneCallback, progressCallback, imagesize) {
        if (layer > 4) {
            log5.warn("invalid layer");
            if (doneCallback != undefined) {
                doneCallback(false, undefined);
                return;
            }
        }
        // Save current target and address
        let currentTarget = this.downloadTarget;
        let currentAddress = this.downloadAddress;
        if (layer === -2) {
            // new, beta 23 and on
            this.downloadTargetSet(VEXCDCDevice.FILE_TARGET_CBUF);
            this.downloadAddress = 0; // no need for address
        }
        else {
            this.downloadTargetSet(VEXCDCDevice.FILE_TARGET_DDR);
            if (layer >= 0)
                this.downloadAddress = 0x100000 + (layer * 0x200000);
            else
                this.downloadAddress = 0xE00000; // use known address screen cap buffer
        }
        // add adjustable image size for IQ2
        imagesize = imagesize === undefined ? 512 * 4 * 272 : imagesize;
        this.uploadData("null", imagesize, progressCallback, (status, data) => {
            this.downloadTargetSet(currentTarget);
            this.downloadAddressSet(currentAddress);
            if (doneCallback != undefined) {
                doneCallback(status, data);
            }
        });
    }
    /**
    * Transfers the screen data from the connected robot.
    * @param imageSize the size of the image data in bytes
    * @param progressCallback a callback to inform about how far along the transfer is
    * @returns the raw image data
    */
    async captureScreenData(imageSize, progressCallback) {
        // start the image capture
        await this.writeDataAsync(this.cdc.V5_Cdc2ScreenCaptureLayer());
        this.uploadScreenLayer(-2, (success, data) => {
            log5.debug("uploadScreenLayer callback:", success);
            if (success) {
                return data;
            }
            else {
                throw undefined;
            }
        }, progressCallback, imageSize);
    }
    async SimulateControllerThroughCDC(buttons, lx, ly, rx, ry) {
        try {
            await this.writeDataAsync(this.cdc.V5_Cdc2ControllerSimSet(buttons, lx, ly, rx, ry), { timeout: 1000 });
        }
        catch (error) {
            if (error instanceof ErrorGATT) {
                throw error;
            }
            log5.error("Error sending controller data through CDC:", error);
        }
    }
    buf2hex(buffer) {
        return [...new Uint8Array(buffer)]
            .map(x => x.toString(16).padStart(2, '0'))
            .join('');
    }
    delay(ms, payload) {
        return new Promise((resolve) => {
            setTimeout(() => { resolve(payload); }, ms);
        });
    }
}
VEXCDCDevice.SYS_ADDRESS = USER_FLASH_SYS_CODE_START;
VEXCDCDevice.USR_ADDRESS = USER_FLASH_USR_CODE_START;
VEXCDCDevice.STATUS_GOOD = 0x76;
VEXCDCDevice.STATUS_WACK = 0xFE;
VEXCDCDevice.STATUS_FAIL = 0xFF;
VEXCDCDevice.STATUS_TIMEOUT = 0x1FF;
VEXCDCDevice.STATUS_DISCONNECT = 0x2FF;
VEXCDCDevice.STATUS_CONNECT_ERR = 0x3FF;
VEXCDCDevice.FILE_FUNC_SAVE = 1;
VEXCDCDevice.FILE_FUNC_READ = 2;
VEXCDCDevice.FILE_TARGET_DDR = 0;
VEXCDCDevice.FILE_TARGET_QSPI = 1;
VEXCDCDevice.FILE_TARGET_CBUF = 2;
VEXCDCDevice.FILE_TARGET_VBUF = 3;
VEXCDCDevice.FILE_TARGET_DDRC = 4;
VEXCDCDevice.FILE_TARGET_DDRE = 5;
VEXCDCDevice.FILE_TARGET_FLASH = 6; // for IQ2
VEXCDCDevice.FILE_TARGET_RADIO = 7; // for IQ2
VEXCDCDevice.FILE_TARGET_A1 = 13;
VEXCDCDevice.FILE_TARGET_B1 = 14;
VEXCDCDevice.FILE_TARGET_B2 = 15;
VEXCDCDevice.VID = {
    USER: 1,
    SYS: 0x0F,
    DEV1: 0x10,
    DEV2: 0x18,
    DEV3: 0x20,
    DEV4: 0x28,
    DEV5: 0x30,
    DEV6: 0x38,
    VEXVM: 0x40,
    AIM_IMAGE: 0x80,
    AIM_SOUND: 0x88,
    VEX: 0xF0,
    ESP32: 0xFC,
    UNDEFINED: 0xF1
};
VEXCDCDevice.OPTIONS = {
    EXIT_RUN: 1,
    EXIT_HALT: 3,
    FILE_OVERWRITE: 1,
    LOAD_STOP: 0x80,
    ERASE_AL_BNAME: 0x80 // erase all files matching basename
};


const log6 = logger.getLogger("vex-web-ble-device-manager-cdc");
log6.setLevel(LoggerLevels.WARN);
log6.setHistoryLogger("vex-web-ble-device-manager");
// for dev only
// log6.enableAll();

class VexCDCMessage {
    constructor(data, replyLength) {
        this.data = data;
        this.replyLength = replyLength;
    }
}
class VexCDC {
    constructor() {
        //#endregion static constants
        this.vex_version = 0;
        this.file_version = 1;
        this.EXP_Cdc2ControllerVersions = this.IQ2_Cdc2ControllerVersions;
    }
    /**
     * Convert an ArrayBuffer to a string for display
     * @param buf the ArrayBuffer or UInt8Array
     * @return the converted string
     */
    convertBufferToHexString(buf) {
        if (!buf) {
            return 'error';
        }
        let str = '';
        const uint8Array = new Uint8Array(buf);
        for (let i = 0; i < uint8Array.length; i++) {
            str = str + ('00' + uint8Array[i].toString(16)).substr(-2, 2) + ' ';
        }
        return str.toUpperCase();
    }
    /**
     * Create the vex CDC header
     * @param buf the bytes to send
     */
    header(buf) {
        // create a buffer if is is not defined
        if (buf === undefined || buf.byteLength < VexCDC.HEADERS_LENGTH) {
            buf = new ArrayBuffer(VexCDC.HEADERS_LENGTH);
        }
        const h = new Uint8Array(buf);
        h.set(VexCDC.HEADERS);
        return (h);
    }
    /**
     * Create the vex CDC simple message
     * @param cmd the CDC command byte
     */
    cdcCommand(cmd) {
        const buf = new ArrayBuffer(VexCDC.HEADERS_LENGTH + 1);
        const h = this.header(buf);
        h.set([cmd], VexCDC.HEADERS_LENGTH);
        return h;
    }
    /**
     * Create the vex CDC simple message
     * @param cmd the CDC command byte
     * @param data the data to send
     */
    cdcCommandWithData(cmd, data) {
        const buf = new ArrayBuffer(VexCDC.HEADERS_LENGTH + 2 + data.length);
        const h = this.header(buf);
        // add command and length bytes
        h.set([cmd, data.length], VexCDC.HEADERS_LENGTH);
        // add the message data
        h.set(data, VexCDC.HEADERS_LENGTH + 2);
        return h;
    }
    /**
     * Create the vex CDC extended message
     * @param cmd the CDC command byte
     * @param ext the CDC extended command byte
     * @return a message
     */
    cdc2Command(cmd, ext) {
        const buf = new ArrayBuffer(VexCDC.HEADERS_LENGTH + 5);
        const h = this.header(buf);
        h.set([cmd, ext, 0], VexCDC.HEADERS_LENGTH);
        // Add CRC
        const crc = crc16(h.subarray(0, buf.byteLength - 2), 0) >>> 0;
        h.set([crc >>> 8, crc & 0xFF], buf.byteLength - 2);
        return h;
    }
    /**
     * Calculate buffer length for new CDC extended command
     * @param data the CDC extended command payload
     * @returns the requried buffer length of the command message
     */
    cdc2CommandBufferLength(data) {
        // New command use header + 1 byte command
        //                        + 1 byte function
        //                        + 1 byte data length
        let length = VexCDC.HEADERS_LENGTH + data.length + 3 + 2;
        // If data length is > 127 bytes then an additional data length byte is added
        if (data.length > 127)
            length += 1;
        return (length);
    }
    /**
     * Create the vex CDC extended message with some data
     * @param cmd the CDC command byte
     * @param ext the CDC extended command byte
     * @param data the CDC extended command payload
     * @return a message
     */
    cdc2CommandWithData(cmd, ext, data) {
        const buf = new ArrayBuffer(this.cdc2CommandBufferLength(data));
        const h = this.header(buf);
        // add command and length bytes
        if (data.length < 128) {
            h.set([cmd, ext, data.length], VexCDC.HEADERS_LENGTH);
            // add the message data
            h.set(data, VexCDC.HEADERS_LENGTH + 3);
        }
        else {
            const length_msb = ((data.length >>> 8) | 0x80) >>> 0;
            const length_lsb = (data.length & 0xFF) >>> 0;
            h.set([cmd, ext, length_msb, length_lsb], VexCDC.HEADERS_LENGTH);
            // add the message data
            h.set(data, VexCDC.HEADERS_LENGTH + 4);
        }
        // Add CRC (little endian)
        const crc = crc16(h.subarray(0, buf.byteLength - 2), 0);
        h.set([crc >>> 8, crc & 0xFF], buf.byteLength - 2);
        return h;
    }
    /**
     * Validate CDC2 message
     * @param msg the message data to validate
     * @returns true if the message is valid
     */
    cdc2ValidateMessage(msg) {
        if (this.validateHeaderAndLength(msg)) {
            // check for extended message
            if (msg[2] !== VexCDC.TYPES.USER_CDC.cmd) {
                return false;
            }
            // check packet crc
            const crc1 = crc16(msg.subarray(0, msg.byteLength - 2), 0);
            const crc2 = (msg[msg.byteLength - 2] << 8) + msg[msg.byteLength - 1];
            return crc1 === crc2;
        }
        return false;
    }
    /**
     * Get CDC2 message length
     * @param msg the message to check
     * @returns length of the message data
     */
    cdc2MessageGetLength(msg) {
        // get message length
        let length_msb = 0;
        let length_lsb = msg[3];
        // see if first byte has msb set
        if (length_lsb & 0x80) {
            // 16 bit length
            length_msb = length_lsb & 0x7F;
            length_lsb = msg[4];
        }
        const length = (length_msb << 8) + length_lsb;
        return length;
    }
    /**
     * Get CDC2 reply total packet length
     */
    cdc2MessageGetReplyPacketLength(msg) {
        let length = this.cdc2MessageGetLength(msg) + 4;
        if (length > 131) {
            length += 1;
        }
        return length;
    }
    /**
     * Create a new query1 command
     * @return {Object} a message
     */
    query1() {
        const msg = VexCDC.TYPES.QUERY1;
        return (new VexCDCMessage(this.cdcCommand(msg.cmd), msg.replyLength));
    }
    /**
     * Create a new system version command
     * @return {Object} a message
     */
    systemVersion() {
        const msg = VexCDC.TYPES.SYSTEM_VERSION;
        return (new VexCDCMessage(this.cdcCommand(msg.cmd), msg.replyLength));
    }
    validateHeaderAndLength(msg) {
        if (msg === undefined) {
            return false;
        }
        // check header
        if (msg[0] !== VexCDC.HEADERR[0] || msg[1] !== VexCDC.HEADERR[1]) {
            return false;
        }
        return true;
    }
    getReplyLengthFromCommand(cmd) {
        for (let prop in VexCDC.TYPES) {
            if (cmd === VexCDC.TYPES[prop].cmd) {
                return VexCDC.TYPES[prop].replyLength;
            }
        }
        return 0;
    }
    /*
     * ----------------------------------------------------------------------
     * IQ  commands
     */
    //#region IQ Commands
    /**
     * read the brain name
     * @return {VexCDCMessage} a message
     */
    brainName() {
        var msg = VexCDC.TYPES.BRAIN_NAME_GET;
        var h = this.cdcCommand(msg.cmd);
        return (new VexCDCMessage(h, msg.replyLength));
    }
    /**
     * Create a new play slot command
     * @return {VexCDCMessage} a message
     */
    playSlot(slot) {
        var msg = VexCDC.TYPES.USER_PLAY;
        var buf = new Uint8Array([slot]);
        var h = this.cdcCommandWithData(msg.cmd, buf);
        return (new VexCDCMessage(h, msg.replyLength));
    }
    /**
     * Create a new stop program
     * @return {VexCDCMessage} a message
     */
    stopProgram() {
        var msg = VexCDC.TYPES.USER_STOP;
        return (new VexCDCMessage(this.cdcCommand(msg.cmd), msg.replyLength));
    }
    /**
     * Create a flash erase command
     * @return {VexCDCMessage} a message
     */
    flashErase(address, blocks) {
        var msg = VexCDC.TYPES.FLASH_ERASE;
        // address is 32 bit start address
        // blocks is 16 bit number of 1k blocks
        var buf = new Uint8Array(6);
        var tmp = new DataView(buf.buffer);
        // set with littleEndian true
        tmp.setUint32(0, address, true);
        tmp.setUint16(4, blocks, true);
        var h = this.cdcCommandWithData(msg.cmd, buf);
        return (new VexCDCMessage(h, msg.replyLength));
    }
    /**
     * Create a flash write command
     * @return {VexCDCMessage} a message
     */
    flashWrite(address, data) {
        var msg = VexCDC.TYPES.FLASH_WRITE;
        var buf = new ArrayBuffer(VexCDC.HEADERS_LENGTH + 7 + data.length);
        var h = this.header(buf);
        var tmp = new DataView(buf);
        // add command byte
        tmp.setUint8(VexCDC.HEADERS_LENGTH, msg.cmd);
        // set length with little endian
        tmp.setUint16(VexCDC.HEADERS_LENGTH + 1, data.length + 4, true);
        // address is 32 bit start address
        // set address ith littleEndian true
        tmp.setUint32(VexCDC.HEADERS_LENGTH + 3, address, true);
        // add the message data
        h.set(data, VexCDC.HEADERS_LENGTH + 7);
        return (new VexCDCMessage(h, msg.replyLength));
    }
    /**
     * Create a new download exit command
     * @return {VexCDCMessage} a message
     */
    downloadExit() {
        var msg = VexCDC.TYPES.USER_EXIT;
        return (new VexCDCMessage(this.cdcCommand(msg.cmd), msg.replyLength));
    }
    /**
     * Create a new styop program
     * @return {VexCDCMessage} a message
     */
    userProgramSlotsGet() {
        var msg = VexCDC.TYPES.USER_SLOT_GET;
        return (new VexCDCMessage(this.cdcCommand(msg.cmd), msg.replyLength));
    }
    /**
     * Create a program slot set command
     * @return {VexCDCMessage} a message
     */
    userProgramSlotsSet(slot, address) {
        var msg = VexCDC.TYPES.USER_SLOT_SET;
        // address is 32 bit start address
        var buf = new Uint8Array(5);
        var tmp = new DataView(buf.buffer);
        // set slot
        buf.set([slot], 0);
        // set address with littleEndian true
        tmp.setUint32(1, address, true);
        var h = this.cdcCommandWithData(msg.cmd, buf);
        return (new VexCDCMessage(h, msg.replyLength));
    }
    /**
     * Create a new dfu enable command
     * @return {VexCDCMessage} a message
     */
    eraseCatalog() {
        var msg = VexCDC.TYPES.EEPROM_ERASE;
        var buf = new Uint8Array([1]);
        var h = this.cdcCommandWithData(msg.cmd, buf);
        return (new VexCDCMessage(h, msg.replyLength));
    }
    /**
     * Validate IQ CDC message
     * @param msg the message data to validata
     * @returns true if the message is valid
     */
    cdcValidateIQMessage(msg) {
        const dvb = new DataView(msg.buffer, msg.byteOffset);
        return dvb.getUint16(0) === 0xAA55;
    }
    //#endregion IQ Commands
    /*
     * ----------------------------------------------------------------------
     * V5 new CDC2 user program commands
     */
    //#region V5 Commands
    /**
     * Create a new controller version request command
     * Only send to controller, not V5 brain
     * for debug and test purposes
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2ControllerCompControl(ctrl, matchtime) {
        const msg = VexCDC.TYPES.CTRL_CDC;
        const cmd = VexCDC.ECMDS_CTRL.CON_COMP_CTRL;
        const buf = new Uint8Array(5);
        const dvb = new DataView(buf.buffer);
        buf[0] = (ctrl & 0x0F) >>> 0;
        dvb.setUint32(1, matchtime, true);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new download exit command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileControl(action, data) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_CTRL;
        const buf = new Uint8Array(2);
        action = (action === undefined) ? 0 : action;
        data = (data === undefined) ? 0 : data;
        buf[0] = action;
        buf[1] = data;
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new file initizlize command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileInitialize(operation, target, vid, options, src, addr, name, exttype = 0) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_INIT;
        const str = new TextEncoder().encode(name);
        const buf = new Uint8Array(52);
        const dvb = new DataView(buf.buffer);
        // Updated for proposed new V5 protocol
        dvb.setUint8(0, operation);
        dvb.setUint8(1, target);
        dvb.setUint8(2, vid);
        dvb.setUint8(3, options);
        // set length, 0 if we have no buffer
        if (src !== undefined) {
            dvb.setUint32(4, src.length, true);
        }
        else {
            dvb.setUint32(4, 0, true);
        }
        // address
        dvb.setUint32(8, addr, true);
        // CRC
        let crc;
        if (src !== undefined) {
            crc = crc32(src, 0);
        }
        else {
            crc = 0;
        }
        dvb.setUint32(12, crc, true);
        // type
        // use file extension
        const re = /(?:\.([^.]+))?$/;
        let ext = re.exec(name)[1];
        ext = (ext === undefined ? '' : ext);
        // files with gz extension are also type bin
        ext = (ext === 'gz' ? 'bin' : ext);
        dvb.setUint8(16, ext.charCodeAt(0));
        dvb.setUint8(17, ext.charCodeAt(1));
        dvb.setUint8(18, ext.charCodeAt(2));
        dvb.setUint8(19, exttype);
        // timestamp, updated for J2000_EPOCH, 9/17/2018
        const timestamp = ((Date.now() / 1000) >>> 0) - VexCDC.J2000_EPOCH;
        dvb.setUint32(20, timestamp, true);
        // version (endianess fixed, Jan 12 2019)
        dvb.setUint32(24, this.file_version, true);
        // reset version
        this.file_version = 1;
        // filename
        // now use final 23 rather than first 23
        let offset = str.length - 23;
        if (offset < 0) {
            offset = 0;
        }
        buf.set(str.subarray(offset, offset + 23), 28);
        dvb.setUint8(51, 0);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * one time setting of file version
     * @param v
     */
    V5_Cdc2SetFileVersion(v) {
        this.file_version = v;
    }
    /**
     * Create a new download exit command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileExit(action) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_EXIT;
        const buf = new Uint8Array(1);
        if (action !== undefined)
            buf[0] = action;
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a program write command
     * @return {ObjVexCDCMessageect} a message
     */
    V5_Cdc2FileDataWrite(address, data) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_WRITE;
        const buf = new Uint8Array(4 + data.length);
        const dvb = new DataView(buf.buffer);
        // address is 32 bit start address
        // set address ith littleEndian true
        dvb.setUint32(0, address, true);
        // add the message data
        buf.set(data, 4);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a flash read command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileDataRead(address, bytes) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_READ;
        // address is 32 bit start address
        // bytes is number of bytes to read
        const buf = new Uint8Array(6);
        const dvb = new DataView(buf.buffer);
        // set with littleEndian true
        dvb.setUint32(0, address, true);
        dvb.setUint16(4, bytes, true);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        // what do we do with error.
        msg.replyLength = 11 + bytes;
        if (bytes > 123) {
            msg.replyLength += 1;
        }
        return (new VexCDCMessage(h, msg.replyLength));
    }
    /**
     * Create a new user program link command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileLinkFile(vid, options, name) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_LINK;
        const str = new TextEncoder().encode(name);
        const buf = new Uint8Array(26);
        buf.set([vid, options], 0);
        buf.set(str.subarray(0, 23), 2);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Directory count
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileDir(vid, options) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_DIR;
        const buf = new Uint8Array(2);
        buf.set([vid, options], 0);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Directory entry
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileDirEntry(index) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_DIR_ENTRY;
        const buf = new Uint8Array(2);
        buf.set([index, 0], 0);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new user program load command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileLoadAndRun(vid, options, name) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_LOAD;
        const str = new TextEncoder().encode(name);
        const buf = new Uint8Array(26);
        buf.set([vid, options], 0);
        buf.set(str.subarray(0, 23), 2);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new metadata get command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileMetadataGet(vid, options, name) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_GET_INFO;
        const str = new TextEncoder().encode(name);
        const buf = new Uint8Array(26);
        buf.set([vid, options], 0);
        buf.set(str.subarray(0, 23), 2);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new metadata set command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileMetadataSet(vid, options, addr, type, version, name) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_SET_INFO;
        const str = new TextEncoder().encode(name);
        const buf = new Uint8Array(42);
        const dvb = new DataView(buf.buffer);
        // Updated for proposed new V5 protocol
        dvb.setUint8(0, vid);
        dvb.setUint8(1, options);
        // address
        dvb.setUint32(2, addr, true);
        // type
        dvb.setUint32(6, addr, true);
        // timestamp
        let timestamp = ((Date.now() / 1000) >>> 0) - VexCDC.J2000_EPOCH;
        dvb.setUint32(10, timestamp, true);
        // version
        dvb.setUint32(14, version);
        // filename
        buf.set(str.subarray(0, 23), 18);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new file erase command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FileErase(vid, options, name) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_ERASE;
        const str = new TextEncoder().encode(name);
        const buf = new Uint8Array(26);
        buf.set([vid, options], 0);
        buf.set(str.subarray(0, 23), 2);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new file user status (slot) command
     * @return {Object} a message
     */
    V5_Cdc2FileUserStatus(vid, options, name) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FILE_USER_STAT;
        const str = new TextEncoder().encode(name);
        const buf = new Uint8Array(26);
        buf.set([vid, options], 0);
        buf.set(str.subarray(0, 23), 2);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new v5 system flags status command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FlagsStatus() {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.SYS_FLAGS;
        const h = this.cdc2Command(msg.cmd, cmd.cmd);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new v5 device status command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2DeviceStatus() {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.DEV_STATUS;
        const h = this.cdc2Command(msg.cmd, cmd.cmd);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new v5 system status command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2SystemStatus() {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.SYS_STATUS;
        const h = this.cdc2Command(msg.cmd, cmd.cmd);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new v5 file device table status command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FdtStatus() {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FDT_STATUS;
        const h = this.cdc2Command(msg.cmd, cmd.cmd);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new v5 log status command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2LogStatus() {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.LOG_STATUS;
        const h = this.cdc2Command(msg.cmd, cmd.cmd);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new v5 radio status command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2RadioStatus(extended) {
        const msg = VexCDC.TYPES.USER_CDC;
        let cmd = VexCDC.ECMDS.RADIO_STATUS;
        var h;
        if (extended !== undefined && extended == true) {
            var buf = new Uint8Array(1);
            buf[0] = 1;
            cmd = VexCDC.ECMDS.RADIO_STATUSE;
            h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        }
        else {
            h = this.cdc2Command(msg.cmd, cmd.cmd);
        }
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new v5 log status command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2LogRead(offset, count) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.LOG_READ;
        const buf = new Uint8Array(8);
        const dvb = new DataView(buf.buffer);
        dvb.setUint32(0, offset, true);
        dvb.setUint32(4, count, true);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new v5 user data read/write command
     * @param data the data to send to the user port. this is limited to 224 bytes per message
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2UserRead(data) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.USER_READ;
        // cap length at 224 bytes per the spec
        var length = (!!data) ? data.length : 0;
        if (length > 224)
            length = 224;
        const buf = new Uint8Array(2 + length);
        const dvb = new DataView(buf.buffer);
        // channel
        dvb.setUint8(0, 1);
        // length
        dvb.setUint8(1, length);
        if (length > 0) {
            // add the message data
            buf.set(data, 2);
        }
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new v5 key-value load command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2SysKVRead(key) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.SYS_KV_LOAD;
        let str = new TextEncoder().encode(key);
        // limit key length
        if (str.byteLength > 31) {
            str = str.subarray(0, 30);
        }
        const buf = new Uint8Array(str.byteLength + 1);
        buf.set(str, 0);
        buf.set([0], str.byteLength);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new v5 key-value save command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2SysKVSave(key, value) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.SYS_KV_SAVE;
        let strk = new TextEncoder().encode(key);
        const strv = new TextEncoder().encode(value);
        // limit key length
        if (strk.byteLength > 31) {
            strk = strk.subarray(0, 30);
        }
        const buf = new Uint8Array(strk.byteLength + strv.byteLength + 2);
        buf.set(strk, 0);
        buf.set([0], strk.byteLength);
        buf.set(strv, strk.byteLength + 1);
        buf.set([0], buf.byteLength - 1);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new v5 dashboard select command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2DashSelect(screen, port) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.SYS_DASH_SEL;
        const buf = new Uint8Array(2);
        buf[0] = screen;
        buf[1] = port !== undefined ? port : 0;
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new factory ping command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FactoryPing(data) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FACTORY_PING;
        let h;
        if (data !== undefined && data.byteLength > 0) {
            h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, data);
        }
        else {
            h = this.cdc2Command(msg.cmd, cmd.cmd);
        }
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new factory pong command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FactoryPong(len) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FACTORY_PONG;
        const buf = new Uint8Array(2);
        const dvb = new DataView(buf.buffer);
        dvb.setUint16(0, len, true);
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new factory enable command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FactoryEnable() {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FACTORY_EBL;
        const buf = new Uint8Array(4);
        buf[0] = 0x4D;
        buf[1] = 0x4C;
        buf[2] = 0x4B;
        buf[3] = 0x4A;
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new factory firmware update status command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FactoryStatus() {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FACTORY_STATUS;
        const h = this.cdc2Command(msg.cmd, cmd.cmd);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new factory system reset command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2FactoryReset(powerOff) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FACTORY_RESET;
        powerOff = (powerOff === undefined) ? false : powerOff;
        const len = (powerOff === true) ? 6 : 4;
        const buf = new Uint8Array(len);
        // 'V5V5'
        buf[0] = 0x56;
        buf[1] = 0x35;
        buf[2] = 0x56;
        buf[3] = 0x35;
        if (powerOff) {
            buf[4] = 0x4B;
            buf[5] = 0x39;
        }
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create factory "special message".  This is a wrapper for Mark's special message
     * that returns an ACK
     * Development only, seriously, don;t use this it can brick the V5 !
     * @param cmd
     * @param data
     */
    V5_Cdc2FactorySpecial(scmd, data) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.FACTORY_SPECIAL;
        const buf = new Uint8Array(1 + data.length);
        // create special command
        buf[0] = scmd;
        for (let i = 0; i < data.length; i++) {
            buf[i + 1] = data[i];
        }
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new v5 screen capture command
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2ScreenCaptureLayer(layer) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.SYS_SCREEN_CAP;
        const hasLayer = layer !== undefined;
        const h = hasLayer ?
            this.cdc2CommandWithData(msg.cmd, cmd.cmd, new Uint8Array([layer])) :
            this.cdc2Command(msg.cmd, cmd.cmd);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a simulated controller command
     * @param {*} buttons
     * @param {*} lx
     * @param {*} ly
     * @param {*} rx
     * @param {*} ry
     * @return {VexCDCMessage} a message
     */
    V5_Cdc2ControllerSimSet(buttons, lx, ly, rx, ry) {
        var msg = VexCDC.TYPES.USER_CDC;
        var cmd = VexCDC.ECMDS.CTRL_JOYSTICK_SET;
        var buf = new Uint8Array(16);
        var dvb = new DataView(buf.buffer);
        var leftjoy = ((lx + 0x7f) << 8) + (ly + 0x7f);
        var rightjoy = ((rx + 0x7f) << 8) + (ry + 0x7f);
        dvb.setUint16(0, 0);
        dvb.setUint16(2, leftjoy, true);
        dvb.setUint16(4, rightjoy, true);
        dvb.setUint16(6, buttons, true);
        var h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, buf);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    //#endregion V5 Commands
    //#region IQ2/EXP controller commands
    IQ2_Cdc2ControllerVersions() {
        const msg = VexCDC.TYPES.CTRL_CDC;
        const cmd = VexCDC.ECMDS_CTRL.CNTR_GET_VERSIONS;
        const h = this.cdc2Command(msg.cmd, cmd.cmd);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    cdc2ValidateMessageCtrl(msg) {
        if (this.validateHeaderAndLength(msg)) {
            // check for extended message
            if (msg[2] !== VexCDC.TYPES.CTRL_CDC.cmd) {
                return false;
            }
            // check packet crc
            const crc1 = crc16(msg.subarray(0, msg.byteLength - 2), 0);
            const crc2 = (msg[msg.byteLength - 2] << 8) + msg[msg.byteLength - 1];
            return crc1 === crc2;
        }
        return false;
    }
    //#endregion IQ2/EXP controller commands
    //#region AI Vision commands
    /**
     * Create a new AI Vision settings message
     * @return a message
     */
    AI2_Cdc2Settings(data) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.AI2CAM_SETTINGS;
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, data);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new AI Vision detection settings message
     * @return a message
     */
    AI2_Cdc2DetectionSettings(data) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.AI2CAM_DETSET;
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, data);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new AI Vision detection settings message
     * @return a message
     */
    AI2_Cdc2DetectionGetSettings(data) {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.AI2CAM_DETGET;
        const h = this.cdc2CommandWithData(msg.cmd, cmd.cmd, data);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new AI Vision status request
     * @return a message
     */
    AI2_Cdc2Status() {
        const msg = VexCDC.TYPES.USER_CDC;
        const cmd = VexCDC.ECMDS.AI2CAM_STATUS;
        const h = this.cdc2Command(msg.cmd, cmd.cmd);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new 2D AI camera clear user model
     * @return a message
     */
    AI2_Cdc2ClearModel() {
        var msg = VexCDC.TYPES.USER_CDC;
        var cmd = VexCDC.ECMDS.AI2CAM_CLEAR;
        var h = this.cdc2Command(msg.cmd, cmd.cmd);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new 2D AI camera ai model request
     * @return a message
     */
    AI2_Cdc2ModelNameRequestl() {
        var msg = VexCDC.TYPES.USER_CDC;
        var cmd = VexCDC.ECMDS.AI2CAM_MODEL;
        var h = this.cdc2Command(msg.cmd, cmd.cmd);
        return new VexCDCMessage(h, cmd.replyLength);
    }
    /**
     * Create a new 2D AI camera object request
     * @return a message
     */
    AI2_Cdc2ObjectRequest() {
        var msg = VexCDC.TYPES.USER_CDC;
        var cmd = VexCDC.ECMDS.AI2CAM_OBJECTS;
        var h = this.cdc2Command(msg.cmd, cmd.cmd);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    /**
     * Create a new 2D AI camera class names request
     * @return a message
     */
    AI2_Cdc2ClassNamesRequest() {
        var msg = VexCDC.TYPES.USER_CDC;
        var cmd = VexCDC.ECMDS.AI2CAM_CLASSES;
        var h = this.cdc2Command(msg.cmd, cmd.cmd);
        return (new VexCDCMessage(h, cmd.replyLength));
    }
    //#endregion AI Vision commands
    /*
    * ----------------------------------------------------------------------
    * Most of the below is debug related for decoding replies into human readable
    * information.
    */
    /**
     * Utility function to create a hex string from the given number
     * @param  (number} value the number to be formatted into a string with %02X format
     * @return {string}
     */
    hex2(value) {
        const str = ('00' + value.toString(16)).substr(-2, 2);
        return (str.toUpperCase());
    }
    /**
     * Utility function to create a hex string from the given number
     * @param  (number} value the number to be formatted into a string with %08X format
     * @return {string}
     */
    hex8(value) {
        const str = ('00000000' + value.toString(16)).substr(-8, 8);
        return (str.toUpperCase());
    }
    /**
     * Utility function to create a decimal string from the given number
     * @param  (number} value the number to be formatted into a string with %02d format
     * @return {string}
     */
    dec2(value) {
        const str = ('00' + value.toString(10)).substr(-2, 2);
        return (str.toUpperCase());
    }
    /**
     * Decode a received CDC reply
     * @param  (ArrayBuffer} buf the CDC reply to decode
     * @return {string}
     */
    decode(buf) {
        if (!buf) {
            return 'vexcdc: decode error';
        }
        const msg = new Uint8Array(buf);
        let str = '';
        // check header
        if (this.validateHeaderAndLength(msg)) {
            // this is inefficient and used for debug
            // ignore if len is 0
            let replyLen = this.getReplyLengthFromCommand(msg[2]);
            // update for large replies, 5/28/2024
            var dataLen = msg[3];
            if (replyLen && (dataLen & 0x80)) {
                dataLen = ((dataLen & 0x7F) << 8) + msg[4];
                replyLen -= 1;
            }
            if ((replyLen > 0) && (replyLen - VexCDC.HEADERS_LENGTH) !== dataLen) {
                console.log(dataLen, replyLen);
                console.log("vexcdc: bad reply length");
            }
            switch (msg[2]) {
                case VexCDC.TYPES.ACK.cmd:
                    str = 'vexcdc: General ACK with status ' + this.hex2(msg[4]);
                    break;
                case VexCDC.TYPES.QUERY1.cmd:
                    str = this.decodeQuery1String(msg);
                    break;
                case VexCDC.TYPES.SYSTEM_VERSION.cmd:
                    str = this.decodeSystemVersionString(msg);
                    break;
                case VexCDC.TYPES.USER_CDC.cmd:
                    VexCDC.TYPES.USER_CDC.replyLength = 0;
                    str = 'vexcdc: cdc2 reply';
                    break;
                default:
                    str = 'vexcdc: unknown reply';
                    break;
            }
        }
        else
            str = "bad reply";
        return (str);
    }
    /**
     * Decode a received Query 1 reply
     * @param  (Uint8Array} meg the CDC reply to decode
     * @return {string}
     */
    decodeQuery1String(msg) {
        let str = 'query1:\n';
        let tmp;
        tmp = '  Joystick ' + this.dec2(msg[4]) + '.' + this.dec2(msg[5]);
        str = str + tmp + '\n';
        tmp = '  Brain    ' + this.dec2(msg[6]) + '.' + this.dec2(msg[7]);
        str = str + tmp + '\n';
        tmp = '  Bootload ' + this.dec2(msg[10]) + '.' + this.dec2(msg[11]);
        str = str + tmp + '\n';
        this.vex_version = msg[6];
        return (str);
    }
    /**
     * Decode a received System verison reply
     * @param  (Uint8Array} meg the CDC reply to decode
     * @return {string}
     */
    decodeSystemVersionString(msg) {
        let str = 'system version:\n';
        let tmp;
        tmp = '  Version  ' + this.dec2(msg[4]) + '.' +
            this.dec2(msg[5]) + '.' +
            this.dec2(msg[6]) + 'b' +
            this.dec2(msg[8]);
        str = str + tmp + '\n';
        tmp = '  Hardware ' + (msg[7] == 1 ? 'V1' : 'V2');
        str = str + tmp + '\n';
        return (str);
    }
}
VexCDC.HEADERS_LENGTH = 4;
VexCDC.HEADERS = [0xC9, 0x36, 0xB8, 0x47];
VexCDC.HEADERR = [0xAA, 0x55];
//#region static constants
/**
 * All CDC messages are defined here
 */
VexCDC.TYPES = {
    // reply only
    ACK: { cmd: 0x33, replyLength: 5 },
    // commands and replies
    QUERY1: { cmd: 0x21, replyLength: 14 },
    SYSTEM_VERSION: { cmd: 0xA4, replyLength: 12 },
    USER_CDC: { cmd: 0x56, replyLength: 0 },
    CTRL_CDC: { cmd: 0x58, replyLength: 0 },
    // for IQ
    EEPROM_ERASE: { cmd: 0x31, replyLength: 5 },
    USER_ENTER: { cmd: 0x60, replyLength: 5 },
    USER_CATALOG: { cmd: 0x61, replyLength: 33 },
    FLASH_ERASE: { cmd: 0x63, replyLength: 5 },
    FLASH_WRITE: { cmd: 0x64, replyLength: 5 },
    FLASH_READ: { cmd: 0x65, replyLength: 0 },
    USER_EXIT: { cmd: 0x66, replyLength: 5 },
    USER_PLAY: { cmd: 0x67, replyLength: 5 },
    USER_STOP: { cmd: 0x68, replyLength: 5 },
    COMPONENT_GET: { cmd: 0x69, replyLength: 7 },
    USER_SLOT_GET: { cmd: 0x78, replyLength: 44 },
    USER_SLOT_SET: { cmd: 0x79, replyLength: 5 },
    BRAIN_NAME_GET: { cmd: 0x44, replyLength: 0 },
};
VexCDC.ECMDS = {
    FILE_CTRL: { cmd: 0x10, replyLength: 8 },
    FILE_INIT: { cmd: 0x11, replyLength: 18 },
    FILE_EXIT: { cmd: 0x12, replyLength: 8 },
    FILE_WRITE: { cmd: 0x13, replyLength: 8 },
    FILE_READ: { cmd: 0x14, replyLength: 0 },
    FILE_LINK: { cmd: 0x15, replyLength: 8 },
    FILE_DIR: { cmd: 0x16, replyLength: 0xFFFF },
    FILE_DIR_ENTRY: { cmd: 0x17, replyLength: 57 },
    FILE_LOAD: { cmd: 0x18, replyLength: 8 },
    FILE_GET_INFO: { cmd: 0x19, replyLength: 57 },
    FILE_SET_INFO: { cmd: 0x1A, replyLength: 8 },
    FILE_ERASE: { cmd: 0x1B, replyLength: 8 },
    FILE_USER_STAT: { cmd: 0x1C, replyLength: 9 },
    SYS_FLAGS: { cmd: 0x20, replyLength: 0xFFFF },
    DEV_STATUS: { cmd: 0x21, replyLength: 0xFFFF },
    SYS_STATUS: { cmd: 0x22, replyLength: 0xFFFF },
    FDT_STATUS: { cmd: 0x23, replyLength: 0xFFFF },
    LOG_STATUS: { cmd: 0x24, replyLength: 25 },
    LOG_READ: { cmd: 0x25, replyLength: 0xFFFF },
    RADIO_STATUS: { cmd: 0x26, replyLength: 15 },
    RADIO_STATUSE: { cmd: 0x26, replyLength: 15 + 12 },
    USER_READ: { cmd: 0x27, replyLength: 0xFFFF },
    SYS_SCREEN_CAP: { cmd: 0x28, replyLength: 8 },
    SYS_USER_PROG: { cmd: 0x29, replyLength: 0xFFFF },
    SYS_DASH_TOUCH: { cmd: 0x2A, replyLength: 8 },
    SYS_DASH_SEL: { cmd: 0x2B, replyLength: 8 },
    SYS_DASH_EBL: { cmd: 0x2C, replyLength: 0xFFFF },
    SYS_DASH_DIS: { cmd: 0x2D, replyLength: 8 },
    SYS_KV_LOAD: { cmd: 0x2E, replyLength: 0xFFFF },
    SYS_KV_SAVE: { cmd: 0x2F, replyLength: 8 },
    AI2CAM_SETTINGS: { cmd: 0x61, replyLength: 8 },
    AI2CAM_DETSET: { cmd: 0x62, replyLength: 8 },
    AI2CAM_DETGET: { cmd: 0x63, replyLength: 0xFFFF },
    AI2CAM_OBJECTS: { cmd: 0x68, replyLength: 0xFFFF },
    AI2CAM_CLASSES: { cmd: 0x69, replyLength: 0xFFFF },
    AI2CAM_MODEL: { cmd: 0x6A, replyLength: 0xFFFF },
    AI2CAM_CLEAR: { cmd: 0x6E, replyLength: 8 },
    AI2CAM_STATUS: { cmd: 0x6F, replyLength: 0xFFFF },
    FACTORY_STATUS: { cmd: 0xF1, replyLength: 10 },
    FACTORY_RESET: { cmd: 0xF2, replyLength: 0 },
    FACTORY_PING: { cmd: 0xF4, replyLength: 8 },
    FACTORY_PONG: { cmd: 0xF5, replyLength: 0xFFFF },
    FACTORY_SPECIAL: { cmd: 0xFE, replyLength: 8 },
    FACTORY_EBL: { cmd: 0xFF, replyLength: 8 },
    CTRL_JOYSTICK_SET: { cmd: 0x84, replyLength: 0xFFFF }
};
VexCDC.ECMDS_FILE_CTRL_GROUP = {
    FILE_CTRL_RADIO: 1,
    FILE_CTRL_RADIO_UPD: 0x10,
};
VexCDC.CTRL_SYS_STATUS = {
    TETHERED: 0x01,
    LINKED: 0x02,
    LINKED_IQ_GEN1: 0x04
};
VexCDC.CDC2_ACK_TYPES = {
    CDC2_ACK: 0x76,
    CDC2_NACK: 0xFF,
    CDC2_NACK_PACKET_CRC: 0xCE,
    CDC2_NACK_CMD_LENGTH: 0xD0,
    CDC2_NACK_SIZE: 0xD1,
    CDC2_NACK_CRC: 0xD2,
    CDC2_NACK_FILE: 0xD3,
    CDC2_NACK_INIT: 0xD4,
    CDC2_NACK_FUNC: 0xD5,
    CDC2_NACK_ALIGN: 0xD6,
    CDC2_NACK_ADDR: 0xD7,
    CDC2_NACK_INCOMPLETE: 0xD8,
    CDC2_NACK_DIR_INDEX: 0xD9,
    CDC2_NACK_MAX_USER_FILES: 0xDA,
    CDC2_NACK_FILE_EXISTS: 0xDB,
    CDC2_NACK_FILE_SYS_FULL: 0xDC,
};
VexCDC.ECMDS_CTRL = {
    CON_COMP_CTRL: { cmd: 0xC1, replyLength: 8 },
    CON_VER_FLASH: { cmd: 0x39, replyLength: 0xFFFF },
    CON_RADIO_MODE: { cmd: 0x41, replyLength: 0xFFFF },
    CON_RADIO_FORCE: { cmd: 0x3F, replyLength: 0xFFFF },
    // IQ2/EXP controller specific
    CNTR_GET_STATE: { cmd: 0x60, replyLength: 0xFFFF },
    CNTR_SET_PAIR_ID: { cmd: 0x61, replyLength: 0xFFFF },
    CNTR_GET_PAIR_ID: { cmd: 0x62, replyLength: 0xFFFF },
    CNTR_GET_TEST_DATA: { cmd: 0x63, replyLength: 0xFFFF },
    CNTR_TEST_CMD: { cmd: 0x64, replyLength: 0xFFFF },
    CNTR_ABORT_JS_CAL: { cmd: 0x65, replyLength: 0xFFFF },
    CNTR_START_JS_CAL: { cmd: 0x66, replyLength: 0xFFFF },
    CNTR_GET_VERSIONS: { cmd: 0x67, replyLength: 0xFFFF },
    CNTR_DEV_STATE: { cmd: 0x68, replyLength: 0xFFFF },
};
/** constants for the ID values for the different product options */
VexCDC.PRODUCT = {
    V5_BRAIN: 0x10,
    V5_CONTROLLER: 0x11,
    V5_FIELD_CONTROLLER: 0x14,
    IQ1_BRAIN: 0x01,
    IQ2_BRAIN: 0x20,
    IQ2_CONTROLLER: 0x21,
    EXP_BRAIN: 0x60,
    EXP_CONTROLLER: 0x61,
    HYDRA: 0x70,
    AI_VISION: 0x80,
    CTE_ARM: 0x90,
};
// Offset from unix time for timestamp fields
// timestamp = (unix time) - J2000_EPOCH
VexCDC.J2000_EPOCH = 946684800;



const log7 = logger.getLogger("vex-web-ble-device-manager-crc");
log7.setLevel(LoggerLevels.WARN);
log7.setHistoryLogger("vex-web-ble-device-manager");
// for dev only
// log7.enableAll();
const POLYNOMIAL_CRC32 = 0x04C11DB7;
const POLYNOMIAL_CRC16 = 0x1021;
const POLYNOMIAL_CRC8 = 0x07;
const _crc32_table = new Uint32Array(256);
const _crc16_table = new Uint32Array(256);
const _crc8_table = new Uint8Array(256);
const _bitrev_table = new Uint8Array(256);
let _crc32Initialized = false;
let _crc16Initialized = false;
let _crc8Initialized = false;
let _crc32RevInitialized = false;
/**
 * Generate CRC8 table
 */
function crc8GenTable() {
    var i;
    var j;
    var crc_accum;
    for (i = 0; i < 256; i++) {
        crc_accum = i;
        for (j = 0; j < 8; j++) {
            if (crc_accum & 0x80)
                crc_accum = (crc_accum << 1) ^ POLYNOMIAL_CRC8;
            else
                crc_accum = (crc_accum << 1);
        }
        _crc8_table[i] = crc_accum & 0xFF;
    }
    _crc8Initialized = true;
}
/**
 * Generate CRC16 table
 */
function crc16GenTable() {
    var i;
    var j;
    var crc_accum;
    for (i = 0; i < 256; i++) {
        crc_accum = i << 8;
        for (j = 0; j < 8; j++) {
            if (crc_accum & 0x8000)
                crc_accum = (crc_accum << 1) ^ POLYNOMIAL_CRC16;
            else
                crc_accum = (crc_accum << 1);
        }
        _crc16_table[i] = crc_accum;
    }
    _crc16Initialized = true;
}
/**
 * Generate CRC32 table
 */
function crc32GenTable() {
    var i;
    var j;
    var crc_accum;
    for (i = 0; i < 256; i++) {
        crc_accum = i << 24;
        for (j = 0; j < 8; j++) {
            if (crc_accum & 0x80000000)
                crc_accum = (crc_accum << 1) ^ POLYNOMIAL_CRC32;
            else
                crc_accum = (crc_accum << 1);
        }
        _crc32_table[i] = crc_accum;
    }
    _crc32Initialized = true;
}
/**
 * Generate CRC32 reverse table
 */
function crc32GenReverseTable() {
    for (let x = 0; x < 256; x++) {
        let r = 0;
        let v = x;
        for (let i = 0; i < 8; ++i) {
            r <<= 1;
            r |= v & 1;
            v >>= 1;
        }
        _bitrev_table[x] = r;
    }
    _crc32RevInitialized = true;
}
// init the crc tables
/**
 * Calculate CRC8 for buffer
 */
function crc8(buf, initvalue) {
    const numberOfBytes = buf.byteLength;
    let accumulator = initvalue;
    let i;
    let j;
    // First call, calculate table
    if (!_crc8Initialized) {
        crc8GenTable();
    }
    // now calculate CRC8 
    for (j = 0; j < numberOfBytes; j++) {
        i = ((accumulator >>> 0) ^ buf[j]) & 0xFF;
        accumulator = ((accumulator << 8) ^ _crc8_table[i]) >>> 0;
    }
    return (accumulator & 0xFF) >>> 0;
}
/**
 * Calculate CRC16 for buffer
 */
function crc16(buf, initvalue) {
    const numberOfBytes = buf.byteLength;
    let accumulator = initvalue;
    let i;
    let j;
    // First call, calculate table
    if (!_crc16Initialized) {
        crc16GenTable();
    }
    // now calculate CRC16
    for (j = 0; j < numberOfBytes; j++) {
        i = ((accumulator >>> 8) ^ buf[j]) & 0xFF;
        accumulator = ((accumulator << 8) ^ _crc16_table[i]) >>> 0;
    }
    return (accumulator & 0xFFFF) >>> 0;
}
/**
 * Calculate CRC32 for buffer
 */
function crc32(buf, initvalue) {
    const numberOfBytes = buf.byteLength;
    let accumulator = initvalue;
    let i;
    let j;
    // First call, calculate table
    if (!_crc32Initialized) {
        crc32GenTable();
    }
    // now calculate CRC32
    for (j = 0; j < numberOfBytes; j++) {
        i = ((accumulator >>> 24) ^ buf[j]) & 0xFF;
        accumulator = ((accumulator << 8) ^ _crc32_table[i]) >>> 0;
    }
    return (accumulator & 0xFFFFFFFF) >>> 0;
}
/**
 * reflect 8 bit value
 */
function crc32Reflect8(value) {
    return _bitrev_table[value];
}
/**
 * reflect 32 bit value
 */
function crc32Reflect32(value) {
    if (!_crc32RevInitialized) {
        crc32GenReverseTable();
    }
    const p = new DataView(new ArrayBuffer(4));
    const q = new DataView(new ArrayBuffer(4));
    p.setUint32(0, value, true);
    q.setUint8(0, crc32Reflect8(p.getUint8(3)));
    q.setUint8(1, crc32Reflect8(p.getUint8(2)));
    q.setUint8(2, crc32Reflect8(p.getUint8(1)));
    q.setUint8(3, crc32Reflect8(p.getUint8(0)));
    return q.getUint32(0, true);
}
/**
 * Calculate CRC32 for buffer
 */
function crc32reflectedInput(buf, initvalue) {
    const numberOfBytes = buf.byteLength;
    let accumulator = initvalue;
    let i;
    let j;
    // First call, calculate table
    if (!_crc32Initialized) {
        crc32GenTable();
    }
    if (!_crc32RevInitialized) {
        crc32GenReverseTable();
    }
    // now calculate CRC32
    for (j = 0; j < numberOfBytes; j++) {
        i = ((accumulator >>> 24) ^ crc32Reflect8(buf[j])) & 0xFF;
        accumulator = ((accumulator << 8) ^ _crc32_table[i]) >>> 0;
    }
    return (accumulator & 0xFFFFFFFF) >>> 0;
}


const log8 = logger.getLogger("vex-web-ble-device-manager-ini");
log8.setLevel(LoggerLevels.WARN);
log8.setHistoryLogger("vex-web-ble-device-manager");
var VEXcodeIcons;
(function (VEXcodeIcons) {
    VEXcodeIcons["VEXcodeBlocks"] = "USER922x.bmp";
    VEXcodeIcons["VEXcodeCPP"] = "USER926x.bmp";
    VEXcodeIcons["VEXcodePython"] = "USER925x.bmp";
    VEXcodeIcons["VEXcodePro"] = "USER921x.bmp";
})(VEXcodeIcons || (VEXcodeIcons = {}));
/**
 * this is used to help create the ini string for the V5
 */
class VexINI {
    /**
     * create new ini instance
     * @constructor
     */
    constructor() {
        this._project = {
            version: "1",
            ide: "Unknown",
            file: "none",
        };
        this._program = {
            version: "1",
            name: "program",
            slot: "1",
            icon: "default.bmp",
            iconalt: "",
            description: "",
            date: "",
            timezone: "0",
        };
        this._config = {
            port_22: "adi",
        };
        this._ctrl1 = undefined;
        this._ctrl2 = undefined;
        this.createIni();
    }
    /**
     * add controller configuration info to ini file
     * @param ctrl the controler number: 0 for the first controller, 1 for the second controller
     * @param item key
     * @param str value
     */
    addControllerConfig(ctrl, item, str) {
        if (ctrl === 0) {
            if (!this._ctrl1) {
                this._ctrl1 = {};
            }
            this._ctrl1[item] = str;
        }
        else if (ctrl === 1) {
            if (!this._ctrl2) {
                this._ctrl2 = {};
            }
            this._ctrl2[item] = str;
        }
    }
    /**
     * add port configuration to ini file
     * @param port the port number for the device. 1-21
     * @param str the text to display for the device
     */
    addPortConfig(port, str) {
        if (port < 1 || port > 21) {
            return;
        }
        const prop = ("port_" + this.dec2(port));
        this._config[prop] = str;
    }
    /**
     * add adi port configuration to ini file
     * @param port the port number for the ADI. 1-22
     * @param subport the port on the ADI. 0-7 for A-H
     * @param str the text to display for the device
     */
    addAdiPortConfig(port, subport, str) {
        if (port < 1 || port > 22) {
            return;
        }
        const id = 0x41 + subport;
        const prop = "port_" + this.dec2(port) + String.fromCharCode(id);
        this._config[prop] = str;
        if (port === 22 && this._config["port_22"]) {
            delete this._config["port_22"];
        }
    }
    /**
     * add program slot to ini file
     * @param slot 0-7 for the project slot
     */
    programSlotSet(slot) {
        if (slot < 0) {
            slot = 0;
        }
        this._program.slot = slot.toString();
    }
    /**
     * add program name to ini file. this will automatically trim the string the the max length
     * @param name the name of the program on the brain
     */
    programNameSet(name) {
        this._program.name = name.substr(0, 32);
    }
    /**
     * add program description to ini f ile. this will automatically trim the string the the max length
     * @param desc the descript to display to the user in the program info screen
     */
    programDescriptionSet(desc) {
        this._program.description = desc.substr(0, 256);
    }
    /**
     * add program icon to ini file
     * @param name the icon to use for the
     */
    programIconSet(name) {
        this._program.icon = name.substr(0, 16);
    }
    /**
     * add optional alternate program icon to ini file
     */
    programIconAltSet(name) {
        this._program.iconalt = name.substr(0, 16);
    }
    /**
     * add program ide to ini file
     */
    projectIdeSet(name) {
        this._project.ide = name.substr(0, 16);
    }
    /**
     * add program date to ini file
     */
    programDateSet(date) {
        const d = (date === undefined ? new Date : date);
        this._program.date = d.toISOString();
        const tzo = Math.abs(d.getTimezoneOffset());
        const tzh = tzo / 60 >>> 0;
        const tzm = tzo - (tzh * 60);
        this._program.timezone = (d.getTimezoneOffset() > 0 ? "-" : "+") + this.dec2(tzh) + ":" + this.dec2(tzm);
    }
    /**
     * turn ini class into string suitable for saving as an ini file on the V5
     */
    createIni() {
        const str = [];
        if (!this._program.date) {
            this.programDateSet();
        }
        str.push(";" + "\n");
        str.push("; VEX program ini file" + "\n");
        str.push("; Copyright (c) 2017-2021 VEX Robotics" + "\n");
        str.push(";" + "\n");
        str.push("[project]" + "\n");
        let projectProperty;
        for (projectProperty in this._project) {
            if (this._project.hasOwnProperty(projectProperty)) {
                const s = (projectProperty + "                ").substr(0, 12);
                const t = this._project[projectProperty];
                str.push(s + ' = "' + t + '"\n');
            }
        }
        str.push(";" + "\n");
        str.push("[program]" + "\n");
        let programProperty;
        for (programProperty in this._program) {
            if (this._program.hasOwnProperty(programProperty)) {
                const s = (programProperty + "                ").substr(0, 12);
                const t = this._program[programProperty];
                // skip new alternate icon if it is not set
                if (s.match("iconalt") && t == "") {
                    continue;
                }
                str.push(s + ' = "' + t + '"\n');
            }
        }
        str.push(";" + "\n");
        str.push("[config]" + "\n");
        let configProperty;
        for (configProperty in this._config) {
            if (this._config.hasOwnProperty(configProperty)) {
                const s = (configProperty + "                ").substr(0, 12);
                const t = this._config[configProperty];
                str.push(s + ' = "' + t + '"\n');
            }
        }
        if (this._ctrl1 !== undefined) {
            str.push(";" + "\n");
            str.push("[controller_1]" + "\n");
            for (const property in this._ctrl1) {
                if (this._ctrl1.hasOwnProperty(property)) {
                    const s = (property + "                ").substr(0, 12);
                    const t = this._ctrl1[property];
                    str.push(s + ' = "' + t + '"\n');
                }
            }
        }
        if (this._ctrl2 !== undefined) {
            str.push(";" + "\n");
            str.push("[controller_2]" + "\n");
            for (const property in this._ctrl2) {
                if (this._ctrl2.hasOwnProperty(property)) {
                    const s = (property + "                ").substr(0, 12);
                    const t = this._ctrl2[property];
                    str.push(s + ' = "' + t + '"\n');
                }
            }
        }
        log8.debug("ini lines: ", str);
        const s = str.join("");
        // console.log(s);
        return s;
    }
    /**
     * Utility function to create a decimal string from the given number
     * @param value the number to be formatted into a string with %02d format
     * @return the number as a 2 digit string padded with 0
     */
    dec2(value) {
        const str = ("00" + value.toString(10)).substr(-2, 2);
        return str.toUpperCase();
    }
}

// sample of the screen image options from the test site
// width="0" height="0" bpp="0" layer="8" le="true" - JPEG 640x480
// width="0" height="0" bpp="0" layer="9" le="true" - JPEG 1280x960
// width="240" height="240" bpp="2" le="true" - 240x240 (Hydra)
// width="320" height="240" bpp="2" le="true" - 320x240
// width="640" height="480" bpp="2" le="true" - 640x480 (RGB)
// width="640" height="480" bpp="2" layer="2" le="true" yuv="true" - 640x480 (YUV)
// width="640" height="480" bpp="2" layer="2" le="true" raw="true" - 640x480 (RAW)
// width="320" height="240" bpp="4" layer="1" le="true" - 320x240 (RGB888)
// width="320" height="240" bpp="1" layer="3" - 320x240 (Mono)
// width="640" height="480" bpp="1" layer="3" - 640x480 (Mono)
// width="480" height="272" stride="512" bpp="4" layer="-1" le="false" - V5
// width="160" height="128" bpp="2" layer="-1" le="false" - IQ2/EXP
//#region internal helpers
/**
 * A helper for all of the converters as they all draw and convert the canvas to a data url the same way
 * @param image the image object to draw and convert to a data url
 * @returns a data url string of the image
 */
function drawAndConvertImage(image) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    // set the canvas size to the image size
    canvas.width = image.width;
    canvas.height = image.height;
    // draw the image data to the canvas
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
}
//#endregion internal helpers
/**
 * converts a JPEG image data buffer to a base 64 encoded string in PNG format
 * @param data the raw image data
 * @returns A promise that resolves to a base64-encoded PNG data URL of the converted image.
 */
function convertImageDataJPEG(data) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const blob = new Blob([data.buffer], { type: "image/jpeg" });
    const urlCreator = window.URL;
    const imageUrl = urlCreator.createObjectURL(blob);
    const img = new Image();
    return new Promise((resolve, reject) => {
        img.onload = function () {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
        };
        img.src = imageUrl;
        resolve(canvas.toDataURL("image/png"));
    });
}
/**
 * converts the raw image data to a base 64 encoded string in PNG format. This is for image data that has 2 bytes per pixel
 * @param data the raw image data
 * @param width The width of the image.
 * @param height The height of the image.
 * @param littleEndian Indicates if the data is in little-endian format.
 * @returns A promise that resolves to a base64-encoded PNG data URL of the converted image.
 */
function convertImageDataRGB565(data, width, height, littleEndian) {
    const dataView = new DataView(data.buffer);
    const pixel0 = dataView.getInt16(0, littleEndian);
    const pixel1 = dataView.getInt16(2, littleEndian);
    const isEmojiLayer = !(pixel0 & 0x0001) && pixel1 & 0x0001;
    const imageRGBData = new Uint8ClampedArray(4 * width * height);
    const image = new ImageData(imageRGBData, width, height);
    for (let sourceYPos = 0; sourceYPos < height; sourceYPos++) {
        const sourceYPixelOffset = sourceYPos * width;
        const destinationYPos = isEmojiLayer ? height - sourceYPos - 1 : sourceYPos;
        const destinationYPixelOffset = destinationYPos * width;
        for (let sourceXPos = 0; sourceXPos < width; sourceXPos++) {
            const destinationXPos = isEmojiLayer ? width - sourceXPos - 1 : sourceXPos;
            const sourcePixel = sourceYPixelOffset + sourceXPos;
            const destinationPixel = destinationYPixelOffset + destinationXPos;
            const imageDataOffset = destinationPixel * 4;
            let pixel = dataView.getUint16(sourcePixel * 2, littleEndian);
            let r = (pixel & 0xF800) >> 8;
            let g = (pixel & 0x07E0) >> 3;
            let b = (pixel & 0x001F) << 3;
            // extend the lsb for 5 or 6 bit data into lower bits of 8 bit data
            if (r & 0x08) {
                r |= 0x07;
            }
            ;
            if (g & 0x04) {
                g |= 0x03;
            }
            ;
            if (b & 0x08) {
                b |= 0x07;
            }
            ;
            image.data[imageDataOffset + 0] = r;
            image.data[imageDataOffset + 1] = g;
            image.data[imageDataOffset + 2] = b;
            image.data[imageDataOffset + 3] = 0xFF;
        }
    }
    return drawAndConvertImage(image);
}
/**
 * Converts image data from RGB888 format to a base64-encoded PNG data URL.
 *
 * @param data The input image data in RGB888 format as a Uint8Array.
 * @param width The width of the image.
 * @param height The height of the image.
 * @param stride The number of bytes per row of the image. If not provided, defaults to the width.
 * @param littleEndian Indicates if the data is in little-endian format.
 * @returns A promise that resolves to a base64-encoded PNG data URL of the converted image.
 */
function convertImageDataRGB888(data, width, height, stride, littleEndian) {
    let offset = 0;
    stride = stride !== undefined ? stride : width;
    const imageRGBData = new Uint8ClampedArray(4 * stride * height);
    const image = new ImageData(imageRGBData, stride, height);
    // copy and reorder layer 1
    for (let h = 0; h < height; h++) {
        for (let w = 0; w < stride; w++) {
            const b = data[offset + 0];
            const g = data[offset + 1];
            const r = data[offset + 2];
            imageRGBData[offset + 0] = r;
            imageRGBData[offset + 1] = g;
            imageRGBData[offset + 2] = b;
            imageRGBData[offset + 3] = 255;
            offset += 4;
        }
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    // set the canvas size to the image size
    canvas.width = image.width;
    canvas.height = image.height;
    // TODO: review this.
    // it looks like there is almost no difference between the two branches. but it also seems
    // like something is missing regarding the width vs stride
    if (stride === width) {
        var _osb = document.createElement("canvas");
        _osb.width = image.width;
        _osb.height = image.height;
        // render our ImageData on this canvas
        _osb.getContext('2d').putImageData(image, 0, 0);
        // Now we can scale our image, by drawing our second canvas
        ctx.drawImage(_osb, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height);
    }
    else {
        var _osb = document.createElement("canvas");
        _osb.width = image.width;
        _osb.height = image.height;
        // render our ImageData on this canvas
        _osb.getContext('2d').putImageData(image, 0, 0);
        // Now we can scale our image, by drawing our second canvas
        ctx.drawImage(_osb, 0, 0, width, image.height, 0, 0, canvas.width, canvas.height);
    }
    // create a data url of the image
    return canvas.toDataURL("image/png");
}
/**
 * Converts YUV image data to an RGB image and returns it as a base64 encoded string.
 *
 * @param data The YUV image data.
 * @param width The width of the image.
 * @param height The height of the image.
 * @param littleEndian Indicates if the data is in little-endian format.
 * @returns A promise that resolves to a base64-encoded PNG data URL of the converted image.
 */
function convertImageDataYUV(data, width, height, littleEndian) {
    const dataView = new DataView(data.buffer);
    const imageRGBData = new Uint8ClampedArray(4 * width * height);
    const image = new ImageData(imageRGBData, width, height);
    let offsetImage = 0;
    let offsetSource = 0;
    for (let h = 0; h < image.height; h++) {
        for (let w = 0; w < image.width; w += 2) {
            const pixel1 = dataView.getUint16(offsetSource, littleEndian);
            offsetSource += 2;
            const pixel2 = dataView.getUint16(offsetSource, littleEndian);
            const y1 = (pixel1 & 0xFF00) >> 8;
            const y2 = (pixel2 & 0xFF00) >> 8;
            const cr = (pixel1 & 0x00FF) - 128;
            const cb = (pixel2 & 0x00FF) - 128;
            // ITU-R BT601 matrix
            const g1 = (y1 * 1.000 + cb * -0.3437 + cr * -0.7142);
            const b1 = (y1 * 1.000 + cb * 1.7722 + cr * 0.0000);
            const r1 = (y1 * 1.000 + cb * 0.0000 + cr * 1.4017);
            const g2 = (y2 * 1.000 + cb * -0.3437 + cr * -0.7142);
            const b2 = (y2 * 1.000 + cb * 1.7722 + cr * 0.0000);
            const r2 = (y2 * 1.000 + cb * 0.0000 + cr * 1.4017);
            image.data[offsetImage + 0] = r1;
            image.data[offsetImage + 1] = g1;
            image.data[offsetImage + 2] = b1;
            image.data[offsetImage + 3] = 0xFF;
            image.data[offsetImage + 4] = r2;
            image.data[offsetImage + 5] = g2;
            image.data[offsetImage + 6] = b2;
            image.data[offsetImage + 7] = 0xFF;
            offsetImage += 8;
            offsetSource += 2;
        }
    }
    return drawAndConvertImage(image);
}
/**
 * Converts monochrome image data to an RGBA image and returns it as a base64 string.
 *
 * @param data The monochrome image data as a Uint8Array.
 * @param width The width of the image.
 * @param height The height of the image.
 * @returns A promise that resolves to a base64-encoded PNG data URL of the converted image.
 */
function convertImageDataMono(data, width, height) {
    const dataView = new DataView(data.buffer);
    const imageRGBData = new Uint8ClampedArray(4 * width * height);
    const image = new ImageData(imageRGBData, width, height);
    let offsetImage = 0;
    let offsetSource = 0;
    for (let h = 0; h < image.height; h++) {
        for (let w = 0; w < image.width; w++) {
            const pixel = dataView.getUint8(offsetSource);
            const r = pixel;
            const g = pixel;
            const b = pixel;
            image.data[offsetImage + 0] = r;
            image.data[offsetImage + 1] = g;
            image.data[offsetImage + 2] = b;
            image.data[offsetImage + 3] = 0xFF;
            offsetImage += 4;
            offsetSource += 1;
        }
    }
    return drawAndConvertImage(image);
}










const log9 = logger.getLogger("vex-web-ble-device-manager");
log9.setLevel(LoggerLevels.WARN);
const historyLogger9 = log9.setHistoryLogger("vex-web-ble-device-manager");
historyLogger9.setLevel(LoggerLevels.DEBUG);
historyLogger9.setMaxLines(2000);

const VEXBLEDeviceManagerVersion = "1.0.22";
/**
 * @global
 * @type {VEXBLEDeviceManager}
 */
let bleDeviceManager;
function init(target) {
    // initialize Device manager
    try {
        log9.debug("VEX BLE Device Manager Version : ", VEXBLEDeviceManagerVersion);
        if (!navigator || !navigator.bluetooth) {
            log9.error("navigator.bluetooth not available");
            return;
        }
        bleDeviceManager = new VEXBLEDeviceManager(target);
    }
    catch (e) {
        log9.error("error initializing VEXBLEDevice Manager", e);
    }
}
function getDeviceManagerVersion() {
    return VEXBLEDeviceManagerVersion;
}
async function getMachineBleHardwareInfo(platform) {
    return await bleDeviceManager.getMachineBleHardwareInfo(platform);
}
async function updateFirmware(firmwareType = VEXFirmwareType.Release) {
    if (bleDeviceManager.productType != VEXProductTypes.VEXAIM) {
        await bleDeviceManager.updateFirmware(firmwareType);
    }
    else {
        log9.warn("Firmware update not supported for VEXAIM");
    }
}
async function setFirmwareToBeta(firmwareType = VEXFirmwareType.Release) {
    await bleDeviceManager.setFirmwareToBeta(firmwareType);
}
/**
 *  Returns the version of the latest firmware available on the cloud
 *  If server not reachable, returns the local version packed with the application
 *  return 0.0.0.b0 on failure to get both.
 */
async function getLatestFirmwareVersion(firmwareType = VEXFirmwareType.Release) {
    return await bleDeviceManager.getLatestFirmwareVersion(firmwareType);
}
/**
 *  Returns the version of the latest firmware available on the cloud
 *  If server not reachable, returns the local version packed with the application
 *  return 0.0.0.b0 on failure to get both.
 */
async function getLatestBootloaderVersion(firmwareType = VEXFirmwareType.Release) {
    return await bleDeviceManager.getLatestBootLoaderVersion();
}
/**
 * Returns the version of firmware on the device
 */
function getDeviceFirmwareVersion() {
    return bleDeviceManager.getDeviceFirmwareVersion();
}
/**
 * Returns the version of bootloader on the device
 */
function getDeviceBootloaderVersion() {
    return bleDeviceManager.getDeviceBootloaderVersion();
}
function CanUpdateBootloader() {
    return bleDeviceManager.CanUpdateBootloader();
}
async function bootload() {
    if (bleDeviceManager.productType == VEXProductTypes.OneStickController) {
        await bleDeviceManager.bootloadOneStick();
    }
    else {
        await bleDeviceManager.bootload();
    }
}
async function powerOff() {
    await bleDeviceManager.powerOff();
}
async function reboot() {
    await bleDeviceManager.reboot();
}
function getConnectionState() {
    return bleDeviceManager.getConnectionState();
}
/**
 * Returns program program command status subscription state.
 * Returns true if we have subscribed to this status.
 */
function isProgramCommandStatusEnabled() {
    return bleDeviceManager.isProgramCommandStatusEnabled();
}
/**
 * Returns program sensor status subscription state.
 * Returns true if we have subscribed to this status.
 */
function isSensorStatusEnabled() {
    return bleDeviceManager.isProgramSensorStatusEnabled();
}
/**
 * Returns program port command status subscription state
 * Returns true if we have subscribed to this status.
 */
function isPortCommandStatusEnabled() {
    return bleDeviceManager.isProgramPortCommandStatusEnabled();
}
/**
 * Returns device log service subscription state
 * Returns true if we have subscribed to this status.
 */
function isDeviceLogServiceEnabled() {
    return bleDeviceManager.isDeviceLogServiceEnabled();
}
/**
 * Subscribe/Unsubscribe to program command status
 * @param enable true to start robot status update. false, to stop them
 */
function enableProgramCommandStatus(enable) {
    bleDeviceManager.enableProgramCommandStatus(enable);
}
/**
 * Subscribe/Unsubscribe to sensor status
 * @param enable true to start robot status update. false, to stop them
 */
function enableSensorStatus(enable) {
    bleDeviceManager.enableProgramSensorStatus(enable);
}
/**
 * Subscribe/Unsubscribe to port command status
 * @param enable true to start robot status update. false, to stop them
 */
function enablePortCmdStatus(enable) {
    bleDeviceManager.enableProgramPortCmdStatus(enable);
}
/**
 * Subscribe/Unsubscribe to brain log seervice
 * @param enable true to start log feed. false, to stop them
 */
function enableDeviceLogService(enable) {
    bleDeviceManager.enableDeviceInfoLogService(enable);
}
function enableAdminService(enable) {
    bleDeviceManager.enableAdminService(enable);
}
function enableAIMRemoteControlService(enable) {
    bleDeviceManager.enableAIMRemoteControlService(enable);
}
async function scanAndConnect() {
    await bleDeviceManager.scanAndConnect();
}
async function stopProgram() {
    await bleDeviceManager.SendProgramStateCommand(VEXProgramState.Stop);
}
async function disconnect() {
    await bleDeviceManager.disconnect();
}
async function sendCommand(cmd, uuid) {
    if (bleDeviceManager.productType == VEXProductTypes.VEXAIM) {
        await bleDeviceManager.executeSingleCommandAIM(cmd, uuid);
    }
    else {
        await bleDeviceManager.executeSingleCommand(cmd);
    }
}
async function sendCommandMultiple(cmds) {
    await bleDeviceManager.executeMutlipleCommands(cmds);
}
async function sendRobotConfigPreset(preset) {
    await bleDeviceManager.setRobotConfigPreset(preset);
}
async function LocateRobot(durationSec = 2) {
    await bleDeviceManager.LocateRobot(durationSec);
}
async function getCommandNameFromID(command) {
    return bleDeviceManager.getCommandNameFromID(command);
}
/**
 * This will will clear all events for the passed in port
 * @param portID Port to clear events on.
 */
async function clearPortEvents(portID) {
    await bleDeviceManager.clearPortEvents(portID);
}
async function requestRobotConfig() {
    await bleDeviceManager.requestRobotConfig();
}
async function setRobotName(newName) {
    if (bleDeviceManager.productType == VEXProductTypes.VEXAIM || bleDeviceManager.productType == VEXProductTypes.VEXIQ2Brain) {
        let nameFromBrain = await bleDeviceManager.SetBrainNameAdmin(newName);
        log9.debug("Name from Brain: ", nameFromBrain);
    }
    else {
        await bleDeviceManager.SetRobotName(newName);
    }
}
function getDeviceInfo() {
    return bleDeviceManager.getDeviceInfo();
}
function showAllBLEDevices(enable) {
    bleDeviceManager.showAllBLEDevices(enable);
}
async function setPortConfig(portNum, devType, flags = VEXPortConfigFlags.FLAG_ENABLED, iLimitPct = 100, iLimitMax = 500) {
    await bleDeviceManager.setPortConfig(portNum, devType, flags, iLimitPct, iLimitMax);
}
/**
    * Sends control values to robot
    * @param leftX Left Stick X value (0 to 255). 127 == stop
    * @param leftY Left Stick Y value (0 to 255). 127 == stop
    * @param rightX Right Stick X value (0 to 255). 127 == stop
    * @param rightY Right Stick Y value (0 to 255). 127 == stop
    * @param Buttons1 First 8 button bit map
    * @param Buttons2 Second 8 button bit map
    */
async function setControlControlValues(leftX = 127, leftY = 127, rightX = 127, rightY = 127, Buttons1 = 0, Buttons2 = 0) {
    await bleDeviceManager.setControlControlValues(leftX, leftY, rightX, rightY, Buttons1, Buttons2);
}
/**
 * Sends a command to set the stick type for control values
 * @param newType
 * @param driveSensi
 * @param turnSensi
 */
async function setControlDriveStickType(newType, driveSensi = 50, turnSensi = 25) {
    await bleDeviceManager.setControlDriveStickType(newType, driveSensi, turnSensi);
}
/**
* Convieniance method for setting up button commands.
* This method will attempt to parse the string for the command and pass the 4 byte value to the base class to send to the robot.
* @param command Command string
* @param buttonID Button ID
* @param pressed Buttons state that this command is connected to
*/
async function controllerAddButtonCommand(command, buttonID, pressed) {
    let state = await bleDeviceManager.controllerAddButtonCommand(command, buttonID, pressed);
    return state;
}
//functions below are needed only if VEXcode let library to run the controller update loop
/**
 * Starts/Stops timer to send controller updates to the robot.
 * @param enable true to start the game timer. false to stop it.
 * @param updateRate Controlls update interval in seconds. Default = 0.050
 */
function controllerEnable(enable, updateRate = 0.050) {
    bleDeviceManager.controllerEnable(enable, updateRate);
}
function controllerIsEnabled() {
    return bleDeviceManager.controllerIsEnabled();
}
/**
 * Sets the stick values to be sent on the next controls udpate
 * @param leftX Left Stick X value (0 to 255). 127 == stop
 * @param leftY Left Stick Y value (0 to 255). 127 == stop
 * @param rightX Right Stick X value (0 to 255). 127 == stop
 * @param rightY Right Stick Y value (0 to 255). 127 == stop
 */
function controllerSetStickValues(leftX = 127, leftY = 127, rightX = 127, rightY = 127) {
    bleDeviceManager.controllerSetStickValues(leftX, leftY, rightX, rightY);
}
/**
 * Sets the button values to be sent on the next controls udpate
 * @param buttonID button id to update
 * @param pressed button state
 */
function controllerSetButonValue(buttonID, pressed) {
    bleDeviceManager.controllerSetButonValue(buttonID, pressed);
}
/**
 * Sets all controll values to their default value (sticks are neutral and buttons are released)
 */
function controllerClearValues() {
    bleDeviceManager.controllerClearValues();
}
/**
 * Sends command to save the current controll settings for button commands and robot config
 * When the the robot reboots it will remember these settings once commanded into the "Control" config preset
 */
async function saveControlSettings() {
    await bleDeviceManager.saveControlSettings();
}
/**
 * This will request the devices current connection interval. Value will be returned in the ack data callback.
 */
async function RequestConnectionInterval() {
    await bleDeviceManager.RequestConnectionInterval();
}
async function SetSensorMode(newMode) {
    await bleDeviceManager.SetSensorMode(newMode);
}
/**
 * Send a command to read the current user setting from the 123 Robot
 * Status is returned in the VEXBLEBrowser.UserSettingsStatus event callback
 */
async function Get123RobotUserSettings() {
    await bleDeviceManager.Get123RobotUserSettings();
}
/**
 * Send new user settings to 123 robot device. Status is returned in the VEXBLEBrowser.UserSettingsStatus event callback
 * @param idleTimeout Coder will sleep after this many ms if not connected and no buttons have been pressed
 * @param soundVolume
 * @param persist If true these settings will be saved in flash else these settings will only persist until reboot. (In th case of the encoder this means batteries are removed.)
 */
async function Set123RobotUserSettings(idleTimeout, soundVolume, persist) {
    await bleDeviceManager.Set123RobotUserSettings(idleTimeout, soundVolume, persist);
}
/**
 *
 */
async function IsFWUpdateSupported() {
    return await bleDeviceManager.IsFWUpdateSupported();
}
/**
 * Writes raw data through admin characteristics
 * @param data byte array or CDC Message with data
 */
async function WriteDataAsync(data, options) {
    return await bleDeviceManager.WriteDataAsync(data);
}
/**
 * gets the Brain Name though Admin characteristics
 */
async function GetBrainNameAdmin() {
    return await bleDeviceManager.GetBrainNameAdmin();
}
/**
 * gets the Brain System Version through Admin characteristics
 */
async function BrainGetSystemVersionAdmin() {
    return await bleDeviceManager.BrainGetSystemVersion();
}
/**
 * gets the Brain System Version through Admin characteristics
 */
async function BrainGetSystemStatusAdmin() {
    return await bleDeviceManager.BrainGetSystemStatus();
}
/**
 * gets the Brain Device ID through Admin characteristics
 * deviceID is also reported via "VEXBLEBrowser.DeviceInfo" event when a device is connected
 * if required this function can be called to get the device ID ONLY after LockCode is sent and connected to device fully
 * Because: all the CDC2 commands based querries are blocked in firmware until the device is unlocked
 */
async function BrainGetDeviceID() {
    return await bleDeviceManager.BrainGetSystemStatus();
}
/**
 * Sends the lock code to the device
 * @param code
 * @returns true if the device is unlocked
 */
async function SendLockCode(code) {
    let unlocked = await bleDeviceManager.SendLockCode(code);
    return unlocked;
}
async function ShowLockCodeOnBrain(show) {
    await bleDeviceManager.ShowLockCodeOnBrain(show);
}
/**
 * Runs the project at the specified slot.
 *
 * @param {number} slot - The slot number of the project to run. 0 indexed.
 * @returns {Promise<boolean>} A promise that resolves to a boolean indicating the success of the operation.
 */
async function Play(slot) {
    return await bleDeviceManager.Play(slot);
}
/**
 * Stops the currently running project.
 * @returns {Promise<boolean>} A promise that resolves to a boolean indicating the success of the operation.
 */
async function Stop() {
    return await bleDeviceManager.Stop();
}
/**
 *  Downloads the program to the device
 * @param slot  The slot number of the project to run. 0 indexed.
 * @param projectName  The name of the project
 * @param language (only "python" is supported)
 * @param data  The program data to download
 * @param progressCallback  The callback to receive download progress updates
 * @param ide  "Blocks" or "Python"
 * @returns
 */
async function downloadProgram(slot, projectName, language, data, progressCallback, ide) {
    return await bleDeviceManager.downloadProgram(slot, projectName, language, data, progressCallback, ide);
}
async function checkAndInstallPythonVm(crc, version, progressCallback, force = false) {
    return await bleDeviceManager.checkAndInstallPythonVm(crc, version, progressCallback, force);
}
/***
* Downloads the image file to the AIM
* @param filename the name of the file to download
* @param data the image data to download
* @param progress the progress callback
* @returns true if the download was successful
*/
async function downloadImageFileAIM(filename, data, progress) {
    return await bleDeviceManager.downloadImageFileAIM(filename, data, progress);
}
/**
* Deletes the image file from the AIM
* @param filename to be deleted from AIM
* @returns
*/
async function deleteImageFileAIM(filename) {
    return await bleDeviceManager.deleteImageFileAIM(filename);
}
/**
 * Reads the image file from the AIM
 * @param filename to be read from AIM
 * @param progressCallback to get the progress of the read
 * @returns the image data or null if the read failed
 */
async function readImageFileAIM(filename, progressCallback) {
    return await bleDeviceManager.readImageFileAIM(filename, progressCallback);
}
/**
 * Sends the data to the user port
 * @param data string to be sent to the user port
 * @returns
 */
async function sendDataUserPort(data) {
    return await bleDeviceManager.WriteDataUser(data);
}
/**
 * Lists all the image files on the AIM
 * @returns list of image file meta data
 */
async function listImageFiles() {
    return await bleDeviceManager.listImageFilesAIM();
}
/**
 * Lists all the sound files on the AIM
 * @returns list of sound files meta data
 */
async function listSoundFiles() {
    return await bleDeviceManager.listSoundFilesAIM();
}
/**
* Deletes the sound file from the AIM
* @param filename to be deleted from AIM
* @returns
*/
async function deleteSoundFileAIM(filename) {
    return await bleDeviceManager.deleteSoundFileAIM(filename);
}
/**
* Reads the sound file from the AIM
* @param filename to be read from AIM
* @param progressCallback to get the progress of the read
* @returns the sound data or null if the read failed
*/
async function readSoundFileAIM(filename, progressCallback) {
    return await bleDeviceManager.readSoundFileAIM(filename, progressCallback);
}
/***
* Downloads the sound file to the AIM
* @param filename the name of the file to download
* @param data  sound data to download
* @param progress the progress callback
* @returns true if the download was successful
*/
async function downloadSoundFileAIM(filename, data, progress) {
    return await bleDeviceManager.downloadSoundFileAIM(filename, data, progress);
}
/**
     * capture the screen from the AIM
     * @param progressCallback
     * @returns image in RGB565 format as dataUrl string
     */
async function captureBrainScreenAIM(progressCallback) {
    return await bleDeviceManager.captureBrainScreenAIM(progressCallback);
}
async function runSystemProgram(slot) {
    return await bleDeviceManager.runSystemProgram(slot);
}
async function isProjectRunning() {
    return await bleDeviceManager.isProjectRunning();
}
/**
 * Simulates the controller by sending buttons and axis through Admin CDC service to Brain.
 * @param state the buttons and axis state to simulate
 *
 * The buttons are boolean state of the buttons pressed.
 * The joystick values are in the range of -1 to 1.
 *
 * Supports only IQ2 and AIM.
 * @returns
 */
async function SimulateControllerThroughCDC(state) {
    return await bleDeviceManager.SimulateControllerThroughCDC(state);
}
function enableALLLogger() {
    getLogger("vex-web-ble-device-manager").enableAll();
    getLogger("vex-web-ble-device-manager-cdc").enableAll();
    getLogger("vex-web-ble-device-manager-cdcdevice").enableAll();
    getLogger("vex-web-ble-device-manager-crc").enableAll();
    getLogger("vex-web-ble-device-manager-ini").enableAll();
    getLogger("vex-web-ble-device-manager-eventsystem").enableAll();
    getLogger("vex-web-ble-device-manager-prog-utils").enableAll();
    getLogger("vex-web-ble-device-manager-firmware").enableAll();
    getLogger("vex-web-ble-device-manager-botstatus").enableAll();
}


/// Values that represent a program's state
var VEXProgramState;
(function (VEXProgramState) {
    VEXProgramState[VEXProgramState["End"] = 0] = "End";
    VEXProgramState[VEXProgramState["Stop"] = 1] = "Stop";
    VEXProgramState[VEXProgramState["Play"] = 2] = "Play";
    VEXProgramState[VEXProgramState["Pause"] = 3] = "Pause";
    VEXProgramState[VEXProgramState["Step"] = 4] = "Step";
})(VEXProgramState || (VEXProgramState = {}));
/// Values that represent a program's mode
var VEXProgramMode;
(function (VEXProgramMode) {
    VEXProgramMode[VEXProgramMode["None"] = 0] = "None";
    VEXProgramMode[VEXProgramMode["Waiting"] = 1] = "Waiting";
    VEXProgramMode[VEXProgramMode["Ready"] = 2] = "Ready";
    VEXProgramMode[VEXProgramMode["SingleCmd"] = 3] = "SingleCmd";
})(VEXProgramMode || (VEXProgramMode = {}));
/// Structure that represents a program's status
class VEXProgramStatus {
}
var vexProgramBotStatusTypes;
(function (vexProgramBotStatusTypes) {
    vexProgramBotStatusTypes[vexProgramBotStatusTypes["BotStatusTypePuck"] = 1] = "BotStatusTypePuck";
    vexProgramBotStatusTypes[vexProgramBotStatusTypes["BotStatusTypeCode"] = 2] = "BotStatusTypeCode";
    vexProgramBotStatusTypes[vexProgramBotStatusTypes["BotStatusTypeArm"] = 3] = "BotStatusTypeArm";
    vexProgramBotStatusTypes[vexProgramBotStatusTypes["BotStatusTypeGo"] = 4] = "BotStatusTypeGo";
})(vexProgramBotStatusTypes || (vexProgramBotStatusTypes = {}));



const log10 = logger.getLogger("vex-web-ble-device-manager-botstatus");
log10.setLevel(LoggerLevels.WARN);
log10.setHistoryLogger("vex-web-ble-device-manager");

var VEXProgramBotStatusTypes;
(function (VEXProgramBotStatusTypes) {
    VEXProgramBotStatusTypes[VEXProgramBotStatusTypes["BotStatusType_Puck"] = 1] = "BotStatusType_Puck";
    VEXProgramBotStatusTypes[VEXProgramBotStatusTypes["BotStatusType_Code"] = 2] = "BotStatusType_Code";
    VEXProgramBotStatusTypes[VEXProgramBotStatusTypes["BotStatusType_Arm"] = 3] = "BotStatusType_Arm";
    VEXProgramBotStatusTypes[VEXProgramBotStatusTypes["BotStatusType_Go"] = 4] = "BotStatusType_Go";
})(VEXProgramBotStatusTypes || (VEXProgramBotStatusTypes = {}));
// Base class for Robot Status types
class VEXBotStatus {
    constructor() {
        // Currently set robot config
        this.configPreset = VEXRobotConfigPreset.NoConfig;
        // Device Flags (TBD)
        this.deviceFlags = 0;
        // Battery voltage in volts
        this.batteryVoltage = 0.0;
        // Robot heading in degrees (+- MAX(int16))
        this.heading = 0;
        // Proximity value (0-255) Higher value = closer object
        this.proximity = 0;
        // Processed Hue value of light sensor
        this.hue = 0;
    }
}
class VEX123BotStatus extends VEXBotStatus {
    constructor() {
        super();
        this.turnRate = 0;
        // Current drive position in mm
        this.position = 0;
        // Current drive velocity in mmps
        this.velocity = 0;
        // Current raw sensor value from line sensor
        this.floorSensorValue = 0;
        // Value representing the pressed state of the butons
        this.buttonState = 0;
        /// TBD data for now.
        this.extraData = 0;
    }
}
// Type representing the Go robot in code configuration
class VEXGoCodeBotStatus extends VEXBotStatus {
    constructor() {
        super();
        // Rate that the robot is turn in DPS
        this.turnRate = 0;
        // Current switch pressed state
        this.switchState = 0;
        // Current switch LED PWM (>0 = Green, <0 = Red)
        this.switchPWM = 0;
        // Current PWM for the electro magnet
        this.magnetPWM = 0;
        // Current drive postion in degrees
        this.position = 0;
        // Current drive velocity in dps
        this.velocity = 0;
    }
}
// Type representing the Go robot in arm configuration
class VEXGoArmBotStatus extends VEXBotStatus {
    constructor() {
        super();
        // Rate that the robot is turn in DPS
        this.turnRate = 0;
        // Current switch pressed state
        this.switchState = 0;
        // Current switch LED PWM (>0 = Green, <0 = Red)
        this.switchPWM = 0;
        // Current PWM for the electro magnet
        this.magnetPWM = 0;
        // Current postion of the rotation motor in degrees
        this.rotationPosition = 0;
        // Current postion of the tilt motor in degrees
        this.tiltPosition = 0;
    }
}
// Type representing the Go robot in arm configuration
class VEXGoCustomBotStatus extends VEXBotStatus {
    constructor() {
        super();
        // Rate that the robot is turn in DPS
        this.turnRate = 0;
        this.ports = [new VEXProgramPortStatus(), new VEXProgramPortStatus(), new VEXProgramPortStatus(), new VEXProgramPortStatus()];
    }
}
class VEXAimBleRCCmdAck {
    constructor() {
        this.ackByte = 0;
        this.cmdType = 0;
        this.cmdId = 0;
        this.reserved1 = 0;
        this.activeCmdUuid = 0;
        this.reserved2 = 0;
    }
    static fromData(data) {
        if (data.byteLength < 8) {
            log10.error(`Error: Data size ${data.byteLength} is less than AimBleRCCmdAck size of 8`);
            return null;
        }
        const ack = new VEXAimBleRCCmdAck();
        ack.ackByte = data.getUint8(0);
        ack.cmdType = data.getUint8(1);
        ack.cmdId = data.getUint8(2);
        ack.reserved1 = data.getUint8(3);
        ack.activeCmdUuid = data.getUint16(4, true);
        ack.reserved2 = data.getUint16(6, true);
        return ack;
    }
}
/**
 * Represents VEX AIM robot status flags  ( which bytes are set)
 */
class VEXAimBleStatusFlags {
}
VEXAimBleStatusFlags.SOUND_PLAYING = 1 << 0;
VEXAimBleStatusFlags.IS_DRIVING = 1 << 1;
VEXAimBleStatusFlags.HAS_OBJECT = 1 << 2;
VEXAimBleStatusFlags.IMU_CAL = 1 << 3;
VEXAimBleStatusFlags.IS_TURNING = 1 << 4;
VEXAimBleStatusFlags.IS_MOVING = 1 << 5;
VEXAimBleStatusFlags.IS_SHAKE = 1 << 8;
VEXAimBleStatusFlags.IS_SOUND_DNL = 1 << 16;
/**
 * class representing the VEX AIM robot status
 * This class encapsulates the details of the robot status reported by the VEX AIM robot through BLE services.
 * The status includes the robot's current position, orientation, and sensor data.
 * The status also includes the robot's current battery level and the status of the controller.
 */
class VEXAimBleStatus {
    constructor() {
        this.controller_buttons = 0;
        this.controller_stick_x = 0;
        this.controller_stick_y = 0;
        this.controller_battery = 0;
        this.reserved1 = 0;
        this.active_cmd_uuid_1 = 0;
        this.active_cmd_uuid_2 = 0;
        this.active_cmd_uuid_3 = 0;
        this.reserved2 = 0;
        this.flags = 0;
        this.battery = 0;
        this.touch_flags = 0;
        this.touch_x = 0;
        this.touch_y = 0;
        this.robot_x = 0.0;
        this.robot_y = 0.0;
        this.imu_roll = 0.0;
        this.imu_pitch = 0.0;
        this.imu_yaw = 0.0;
        this.imu_heading = 0.0;
        this.imu_acceleration = [0.0, 0.0, 0.0];
        this.imu_gyro_rate = [0.0, 0.0, 0.0];
        this.is_sound_playing = false;
        this.is_driving = false;
        this.has_object = false;
        // is imu calibrating robot.inertial.is_calibrating()
        this.is_imu_calibrating = false;
        this.is_turning = false;
        this.is_moving = false;
        this.is_shake = false;
        // is downloading sound
        this.is_sound_dnl = false;
    }
    /**
     *
     * @param data  - DataView containing the status data
     *  The data is expected to be 72 bytes long and contains data in the order and position as coded below
     * @returns  VEXAimBleStatus object or null if the data is invalid
     */
    static fromData(data) {
        if (data.byteLength < 72) {
            //TODO: verify this is the correct size
            log10.error(`Error: Data size ${data.byteLength} is less than VEXAimBleStatus size of 48`);
            return null;
        }
        let floatPrecision = 2;
        const status = new VEXAimBleStatus();
        status.controller_buttons = data.getUint16(0, true);
        status.controller_stick_x = data.getInt8(2);
        status.controller_stick_y = data.getInt8(3);
        status.controller_battery = data.getUint8(4);
        status.reserved1 = data.getUint8(5);
        status.active_cmd_uuid_1 = data.getUint16(6, true);
        status.active_cmd_uuid_2 = data.getUint16(8, true);
        status.active_cmd_uuid_3 = data.getUint16(10, true);
        status.reserved2 = data.getUint32(12, true);
        status.flags = data.getUint32(16, true);
        status.battery = data.getUint8(20);
        status.touch_flags = data.getUint8(21);
        status.touch_x = data.getUint8(22);
        status.touch_y = data.getUint8(23);
        status.robot_x = data.getFloat32(24, true);
        status.robot_x = parseFloat(status.robot_x.toFixed(floatPrecision));
        status.robot_y = data.getFloat32(28, true);
        status.robot_y = parseFloat(status.robot_y.toFixed(floatPrecision));
        status.imu_roll = data.getFloat32(32, true);
        status.imu_roll = parseFloat(status.imu_roll.toFixed(floatPrecision));
        status.imu_pitch = data.getFloat32(36, true);
        status.imu_pitch = parseFloat(status.imu_pitch.toFixed(floatPrecision));
        status.imu_yaw = data.getFloat32(40, true);
        status.imu_yaw = parseFloat(status.imu_yaw.toFixed(floatPrecision));
        status.imu_heading = data.getFloat32(44, true);
        status.imu_heading = parseFloat(status.imu_heading.toFixed(floatPrecision));
        let imu_accel_x = data.getFloat32(48, true);
        imu_accel_x = parseFloat(imu_accel_x.toFixed(floatPrecision));
        let imu_accel_y = data.getFloat32(52, true);
        imu_accel_y = parseFloat(imu_accel_y.toFixed(floatPrecision));
        let imu_accel_z = data.getFloat32(56, true);
        imu_accel_z = parseFloat(imu_accel_z.toFixed(floatPrecision));
        status.imu_acceleration = [
            imu_accel_x, imu_accel_y, imu_accel_z
        ];
        let imu_gyro_x = data.getFloat32(60, true);
        imu_gyro_x = parseFloat(imu_gyro_x.toFixed(floatPrecision));
        let imu_gyro_y = data.getFloat32(64, true);
        imu_gyro_y = parseFloat(imu_gyro_y.toFixed(floatPrecision));
        let imu_gyro_z = data.getFloat32(68, true);
        imu_gyro_z = parseFloat(imu_gyro_z.toFixed(floatPrecision));
        status.imu_gyro_rate = [
            imu_gyro_x, imu_gyro_y, imu_gyro_z
        ];
        // derive status from flags
        status.is_sound_playing = (status.flags & VEXAimBleStatusFlags.SOUND_PLAYING) !== 0;
        status.is_driving = (status.flags & VEXAimBleStatusFlags.IS_DRIVING) !== 0;
        status.has_object = (status.flags & VEXAimBleStatusFlags.HAS_OBJECT) !== 0;
        status.is_imu_calibrating = (status.flags & VEXAimBleStatusFlags.IMU_CAL) !== 0;
        status.is_turning = (status.flags & VEXAimBleStatusFlags.IS_TURNING) !== 0;
        status.is_moving = (status.flags & VEXAimBleStatusFlags.IS_MOVING) !== 0;
        status.is_shake = (status.flags & VEXAimBleStatusFlags.IS_SHAKE) !== 0;
        status.is_sound_dnl = (status.flags & VEXAimBleStatusFlags.IS_SOUND_DNL) !== 0;
        return status;
    }
}
class VEXAimBleAiVisionSettings {
}
class VEXAimBleAiVisionStatus {
}
/**
 * Represents the VEX AIM BLE AI Status flags (which bytes are set)
 */
class VEXAimBleAiStatusFlags {
}
VEXAimBleAiStatusFlags.tagsEnabled = 1 << 0;
VEXAimBleAiStatusFlags.colorEnabled = 1 << 1;
VEXAimBleAiStatusFlags.aiObjEnabled = 1 << 2;
// 1 << 3
VEXAimBleAiStatusFlags.mergeEnabled = 1 << 4;
VEXAimBleAiStatusFlags.statOvlEnabled = 1 << 5;
VEXAimBleAiStatusFlags.dispOvlEnabled = 1 << 6;
VEXAimBleAiStatusFlags.usbOvlEnabled = 1 << 7;
VEXAimBleAiStatusFlags.lastPacket = 1 << 8; // set to true if AI Status is only 1 packet, or for the last packet if split up
/**
 * Represents the VEX AIM BLE AI Status
 * This class encapsulates the details of the AI status reported by the VEX AIM robot through BLE services.
 * The status includes the number of objects detected and the flags for the AI model.
 * The status also includes the object data for the detected objects.
 */
class VEXAimBleAiStatus {
    constructor() {
        this.object_count = 0;
        this.reserved1 = 0;
        this.flags = 0;
        this.object_data = new Uint8Array();
    }
    static fromData(data) {
        if (data.byteLength < 4) {
            log10.error(`Error: Data size ${data.byteLength} is less than minimum expected AimBleAiStatus size of 4`);
            return null;
        }
        const status = new VEXAimBleAiStatus();
        status.object_count = data.getUint8(0);
        status.reserved1 = data.getUint8(1);
        status.flags = data.getUint16(2, true);
        status.object_data = new Uint8Array(data.buffer.slice(4)); // Store remaining data as object_data
        return status;
    }
}
/**
 * Represents a VEX Aim BLE AI Vision Object.
 * This class encapsulates the details of an AI vision object detected by the VEX Aim BLE device.
 */
class VEXAimBleAiVisionObject {
    /**
     * Constructs a new VEXAimBleAiVisionObject with default values.
     */
    constructor() {
        this.id = 0;
        this.type = 0;
        this.object = null;
    }
    /**
     * Creates a VEXAimBleAiVisionObject from a DataView.
     *
     * @param data - The DataView containing the object data.
     * @returns A VEXAimBleAiVisionObject instance or null if the data is invalid.
     */
    static fromData(data) {
        if (data.byteLength < 18) {
            log10.error(`Error: Data size ${data.byteLength} is less than minimum expected VEXAimBleAiVisionObject size of 18`);
            return null;
        }
        const obj = new VEXAimBleAiVisionObject();
        obj.id = data.getUint8(0);
        obj.type = data.getUint8(1);
        switch (obj.type) {
            case 1:
                obj.object = new AiVisionColor(data.getUint16(2, true), data.getUint16(4, true), data.getUint16(6, true), data.getUint16(8, true), data.getUint16(10, true) * 0.01);
                break;
            case 2:
                obj.object = new AiVisionCode(data.getUint16(2, true), data.getUint16(4, true), data.getUint16(6, true), data.getUint16(8, true), data.getUint16(10, true) * 0.01);
                break;
            case 4:
                obj.object = new AiVisionObject(data.getUint16(2, true), data.getUint16(4, true), data.getUint16(6, true), data.getUint16(8, true), data.getUint16(10, true));
                break;
            case 8:
                obj.object = new AiVisionTag(data.getInt16(2, true), data.getInt16(4, true), data.getInt16(6, true), data.getInt16(8, true), data.getInt16(10, true), data.getInt16(12, true), data.getInt16(14, true), data.getInt16(16, true));
                break;
            default:
                log10.error(`Error: Unknown object type ${obj.type}`);
                return null;
        }
        return obj;
    }
}
/**
 *
 */
class AiVisionColor {
    constructor(xoffset, yoffset, width, height, angle) {
        this.xoffset = xoffset;
        this.yoffset = yoffset;
        this.width = width;
        this.height = height;
        this.angle = angle;
    }
}
class AiVisionCode {
    constructor(xoffset, yoffset, width, height, angle) {
        this.xoffset = xoffset;
        this.yoffset = yoffset;
        this.width = width;
        this.height = height;
        this.angle = angle;
    }
}
class AiVisionTag {
    constructor(x0, y0, x1, y1, x2, y2, x3, y3) {
        this.x0 = x0;
        this.y0 = y0;
        this.x1 = x1;
        this.y1 = y1;
        this.x2 = x2;
        this.y2 = y2;
        this.x3 = x3;
        this.y3 = y3;
    }
}
class AiVisionObject {
    constructor(xoffset, yoffset, width, height, score) {
        this.xoffset = xoffset;
        this.yoffset = yoffset;
        this.width = width;
        this.height = height;
        this.score = score;
    }
}

// //#region project info types
// export interface IProjectInformation {
//     slot: number;
//     name: string;
//     description: string;
//     icon: VEXIconString;
//     ide: string;
//     ports: IPortInfo[];
//     triports: ITriportInfo[];
//     controller1: IControllerConfigInfo;
//     controller2?: IControllerConfigInfo;
//     autorun?: boolean;
//     language: "cpp" | "python";
// }
// export interface IPortInfo {
//     port: number;
//     label: string;
// }
// export interface ITriportInfo {
//     port: number;
//     subport: number;
//     label: string;
// }
// /**
// * this is a base type def for controller config info. it should be
// * extended for each platform.
// */
// export interface IControllerConfigInfo {
//     Axis1: string;
//     Axis2: string;
//     Axis3: string;
//     Axis4: string;
//     [key: string]: string;
// }
// /**
//  * this is a base type def for controller config button names. it should be
//  * extended for each platform.
//  */
// export type ControllerButtonName = keyof IControllerConfigInfo;
// //#endregion project info types
// //#region download progress callback types
// export enum DownloadState {
//     None,
//     DownloadingProgram,
//     CheckingVM,
//     DownloadingVM,
// }
// export interface DownloadProgress {
//     progress: number;
//     state: DownloadState
// }
// export type ProgressCallbackDownload = (data: DownloadProgress) => void;
// //#endregion download progress callback types


var VEXPortNumber;
(function (VEXPortNumber) {
    VEXPortNumber[VEXPortNumber["Port1"] = 0] = "Port1";
    VEXPortNumber[VEXPortNumber["Port2"] = 1] = "Port2";
    VEXPortNumber[VEXPortNumber["Port3"] = 2] = "Port3";
    VEXPortNumber[VEXPortNumber["Port4"] = 3] = "Port4";
})(VEXPortNumber || (VEXPortNumber = {}));
/// These flags can be applied to the robot's port config
var VEXPortConfigFlags;
(function (VEXPortConfigFlags) {
    VEXPortConfigFlags[VEXPortConfigFlags["FLAG_DISABLED"] = 0] = "FLAG_DISABLED";
    VEXPortConfigFlags[VEXPortConfigFlags["FLAG_ENABLED"] = 1] = "FLAG_ENABLED";
    VEXPortConfigFlags[VEXPortConfigFlags["FLAG_REVERSE"] = 2] = "FLAG_REVERSE";
    VEXPortConfigFlags[VEXPortConfigFlags["FLAG_DRV_LEFT"] = 4] = "FLAG_DRV_LEFT";
    VEXPortConfigFlags[VEXPortConfigFlags["FLAG_DRV_RIGHT"] = 8] = "FLAG_DRV_RIGHT";
    VEXPortConfigFlags[VEXPortConfigFlags["FLAG_OPTIONAL"] = 16] = "FLAG_OPTIONAL";
})(VEXPortConfigFlags || (VEXPortConfigFlags = {}));
/// Base class for probram port command values
class VEXPortCommandStatus {
    constructor() {
        this.PortNumber = 0;
        this.DeviceID = 0;
        this.ActiveCommand = 0;
        this.UpdateCounter = 0;
    }
}
/// Detailed status for a motor device
class VEXPortCommandMotorStatus extends VEXPortCommandStatus {
    constructor() {
        super();
        this.Velocity = 0;
        this.Position = 0;
        this.Current = 0;
        this.Flags = 0;
        this.ModeBits = 0;
    }
}
/// Motor flags reported in the vexProgramMotorPortStatus class
var VEXDrivePortFlagConst;
(function (VEXDrivePortFlagConst) {
    /// Switch is open
    VEXDrivePortFlagConst[VEXDrivePortFlagConst["Nothing"] = 0] = "Nothing";
    /// Bumper is actively pressed
    VEXDrivePortFlagConst[VEXDrivePortFlagConst["CrashEvent"] = 2] = "CrashEvent";
})(VEXDrivePortFlagConst || (VEXDrivePortFlagConst = {}));
/// Detailed status for a drivetrain device
class VEXPortCommandDriveStatus extends VEXPortCommandStatus {
    constructor() {
        super();
        this.Velocity = 0;
        this.Position = 0;
        this.Heading = 0;
        this.Flags = 0;
    }
}
/// Detailed status for a magnet device
class VEXPortCommandMagnetStatus extends VEXPortCommandStatus {
    constructor() {
        super();
        this.PWM = 0;
        this.Flags = 0;
    }
}
/// Motor flags reported in the vexProgramMotorPortStatus class
var VEXBumperPortFlagConst;
(function (VEXBumperPortFlagConst) {
    /// Switch is open
    VEXBumperPortFlagConst[VEXBumperPortFlagConst["Nothing"] = 0] = "Nothing";
    /// Bumper is actively pressed
    VEXBumperPortFlagConst[VEXBumperPortFlagConst["Pressing"] = 1] = "Pressing";
    /// Bumper has been pressed
    VEXBumperPortFlagConst[VEXBumperPortFlagConst["PressedEvent"] = 2] = "PressedEvent";
    /// Bumper has been released
    VEXBumperPortFlagConst[VEXBumperPortFlagConst["ReleasedEvent"] = 4] = "ReleasedEvent";
})(VEXBumperPortFlagConst || (VEXBumperPortFlagConst = {}));
/// Detailed status for a bumber device
class VEXPortCommandBumperStatus extends VEXPortCommandStatus {
    constructor() {
        super();
        /// Raw PWM for the bumpers LED -100 to 100
        this.PWM = 0;
        /// Switch
        this.State = 0;
        this.Flags = 0;
    }
}
// Detailed status for a magnet device
class VEXPortCommandSoundStatus extends VEXPortCommandStatus {
    constructor() {
        super();
        /// Sound state
        this.SoundType = 0;
        this.SoundID = 0;
    }
}
/// Possible 123 RGB LED color settings
var VEXTouchLEDColorIndex;
(function (VEXTouchLEDColorIndex) {
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Off"] = 0] = "Off";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Red"] = 1] = "Red";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Green"] = 2] = "Green";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Blue"] = 3] = "Blue";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Yellow"] = 4] = "Yellow";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Cyan"] = 5] = "Cyan";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Magenta"] = 6] = "Magenta";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Orange"] = 7] = "Orange";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["White"] = 8] = "White";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Light_Red"] = 10] = "Light_Red";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Light_Green"] = 11] = "Light_Green";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Light_Blue"] = 12] = "Light_Blue";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Red_Green_Blink"] = 13] = "Red_Green_Blink";
    VEXTouchLEDColorIndex[VEXTouchLEDColorIndex["Custom"] = 255] = "Custom";
})(VEXTouchLEDColorIndex || (VEXTouchLEDColorIndex = {}));
/// Motor flags reported in the vexProgramMotorPortStatus class
class vex123DeviceFlags {
    constructor() {
        /// Switch is open
        this.NOTHING = 0x00;
        /// Low Battery warning
        this.LOW_BATTERY = 0x01;
        /// Robot crash detected
        this.CRASH_DETECTED = 0x02;
        /// Line sensor has been triggered
        this.LINE_DETECTED = 0x04;
        /// Robot shake detected
        this.SHAKE_DETECTED = 0x08;
    }
}
class VEXPortCommand123BotStatus extends VEXPortCommandStatus {
    constructor() {
        super();
        /// Ative Device State (vex123DeviceFlags)
        this.Flags = 0;
        /// Robot Velocity in mm/second
        this.Velocity = 0;
        /// Robot Heading in Degrees
        this.Heading = 0;
        /// Robot Position in mm
        this.Position = 0;
        /// Active button state
        this.ButtonState = 0;
        /// Flags for button pressed events
        this.PressedEvents = 0;
        /// Flags for button released events
        this.ReleasedEvents = 0;
        /// Active LED color index
        this.ColorIndex = VEXTouchLEDColorIndex.Off;
    }
}
/// Robot command status. This is used to status individual commands sent to ports
class VEXBotCommandStatus {
    constructor() {
        /// Robot batter voltage in volts
        this.Battery = 0.0;
        // Robot's configuration ID
        this.ConfigPreset = VEXRobotConfigPreset.NoConfig;
        /// Port Status and command status
        this.Ports = [new VEXPortCommandStatus(), new VEXPortCommandStatus(), new VEXPortCommandStatus(), new VEXPortCommandStatus(), new VEXPortCommandStatus()];
    }
}
/// These values represent device types that can be connected to the robot.
var VEXPortDeviceID;
(function (VEXPortDeviceID) {
    VEXPortDeviceID[VEXPortDeviceID["Unknown"] = 0] = "Unknown";
    VEXPortDeviceID[VEXPortDeviceID["Magnet"] = 16] = "Magnet";
    VEXPortDeviceID[VEXPortDeviceID["Motor"] = 32] = "Motor";
    VEXPortDeviceID[VEXPortDeviceID["Pot"] = 64] = "Pot";
    VEXPortDeviceID[VEXPortDeviceID["Bumper"] = 128] = "Bumper";
    VEXPortDeviceID[VEXPortDeviceID["DriveTrain"] = 160] = "DriveTrain";
    VEXPortDeviceID[VEXPortDeviceID["TouchRGB"] = 176] = "TouchRGB";
    VEXPortDeviceID[VEXPortDeviceID["Sound"] = 192] = "Sound";
    VEXPortDeviceID[VEXPortDeviceID["Drive123"] = 208] = "Drive123";
    VEXPortDeviceID[VEXPortDeviceID["Motor123"] = 224] = "Motor123";
})(VEXPortDeviceID || (VEXPortDeviceID = {}));
var VEXPortDetailIDs;
(function (VEXPortDetailIDs) {
    VEXPortDetailIDs[VEXPortDetailIDs["ValueTypeMotorDetail"] = 1] = "ValueTypeMotorDetail";
    VEXPortDetailIDs[VEXPortDetailIDs["ValueTypePotDetail"] = 2] = "ValueTypePotDetail";
    VEXPortDetailIDs[VEXPortDetailIDs["ValueTypeSwitchDetail"] = 3] = "ValueTypeSwitchDetail";
    VEXPortDetailIDs[VEXPortDetailIDs["ValueTypeDriveDetail"] = 160] = "ValueTypeDriveDetail";
})(VEXPortDetailIDs || (VEXPortDetailIDs = {}));
/// Base class used for port detail types
class VEXPortDetails {
    constructor() {
        this.portNumber = 0;
        this.deviceID = 0;
        this.valueType = 0;
        this.portFlags = 0;
    }
}
/// Detailed status for a motor device
class VEXPortMotorDetails extends VEXPortDetails {
    constructor() {
        super();
        this.timestamp = 0;
        this.velocity = 0;
        this.position = 0;
        this.positionError = 0;
        this.velocityError = 0;
        this.targetPosition = 0;
        this.targetVelocity = 0;
        this.commandVelocity = 0;
        this.motorI = 0;
        this.motorMode = 0;
        this.pwm = 0;
    }
}
/// Motor flags reported in the vexProgramMotorPortStatus class
var VEXMotorPortFlagConst;
(function (VEXMotorPortFlagConst) {
    /// No flags to report
    VEXMotorPortFlagConst[VEXMotorPortFlagConst["FlagNone"] = 0] = "FlagNone";
    /// Motor timed out on its' last command
    VEXMotorPortFlagConst[VEXMotorPortFlagConst["FlagTimeout"] = 1] = "FlagTimeout";
    /// Motor internal motor error.
    VEXMotorPortFlagConst[VEXMotorPortFlagConst["FlagDevError"] = 2] = "FlagDevError";
    /// Motor is current limiting
    VEXMotorPortFlagConst[VEXMotorPortFlagConst["FlagOOverCurrentT"] = 4] = "FlagOOverCurrentT";
    /// Motor cannot read position (Pot deadband)
    VEXMotorPortFlagConst[VEXMotorPortFlagConst["FlagOverRange"] = 8] = "FlagOverRange";
    /// Motor command is active but motor is not progressing (Timout is counting)
    VEXMotorPortFlagConst[VEXMotorPortFlagConst["FlagStall"] = 16] = "FlagStall";
    /// Motor command has timed out because of a stall
    VEXMotorPortFlagConst[VEXMotorPortFlagConst["FlagStallTimeout"] = 32] = "FlagStallTimeout";
    /// Motor has completed last position command
    VEXMotorPortFlagConst[VEXMotorPortFlagConst["FlagDone"] = 128] = "FlagDone";
})(VEXMotorPortFlagConst || (VEXMotorPortFlagConst = {}));
/// Motor flags reported in the vexProgramMotorPortStatus class
var VEXMotorPortModeConst;
(function (VEXMotorPortModeConst) {
    /// Motor is off and the default brake mode is applied
    VEXMotorPortModeConst[VEXMotorPortModeConst["Off"] = 1] = "Off";
    /// Motor is excecuting a velocity command
    VEXMotorPortModeConst[VEXMotorPortModeConst["Velocity"] = 2] = "Velocity";
    /// Motor is excecuting a position command
    VEXMotorPortModeConst[VEXMotorPortModeConst["Profile"] = 4] = "Profile";
    /// Motor is activly holding its position
    VEXMotorPortModeConst[VEXMotorPortModeConst["BrakeHold"] = 64] = "BrakeHold";
    /// Motor motor is in coast mode (this only happen when coast is NOT the default brake mode)
    VEXMotorPortModeConst[VEXMotorPortModeConst["BrakeCoast"] = 80] = "BrakeCoast";
    /// Motor motor is in brake mode (this only happen when brake is NOT the default brake mode)
    VEXMotorPortModeConst[VEXMotorPortModeConst["BrakeBrake"] = 96] = "BrakeBrake";
    /// Motor is performing a  command
    VEXMotorPortModeConst[VEXMotorPortModeConst["ActiveCommand"] = 128] = "ActiveCommand";
})(VEXMotorPortModeConst || (VEXMotorPortModeConst = {}));
class VEXProgramPortStatus {
}
/// Types used to represent an empty port
class VEXProgramEmptyPortStatus extends VEXProgramPortStatus {
    constructor() {
        super();
    }
}
/// Type representing the details of a port configured as a motor (Robot config ID = Custom)
class VEXProgramMotorPortStatus extends VEXProgramPortStatus {
    constructor() {
        super();
        /// Motor's current position in degrees
        this.position = 0;
        /// Motor's current velocity in dps
        this.velocity = 0;
        /// Motor's current current in mA
        this.current = 0;
        /// Motor's current angle in degrees (0-360)
        this.absoluteAngle = 0;
        /// Motor's current Mode Bits (TBD)
        this.modeBits = 0;
        /// Motor's current Flags (vexMotorPortFlagConst)
        this.flags = 0;
    }
}
/// Type representing the details of a port configured as a electro magnet (Robot config ID = Custom)
// tslint:disable-next-line: max-classes-per-file
class VEXProgramMagnetPortStatus extends VEXProgramPortStatus {
    constructor() {
        super();
        /// Length of time this magnet has been energized since bootup in ms
        this.onTime = 0;
        /// Current PWM power of the magnet
        this.power = 0;
        /// Currently set power setting
        this.boostPowerSetting = 0;
        /// Magnet flags (TBD)
        this.flags = 0;
    }
}
// Type representing the details of a port configured as a LED bumper (Robot config ID = Custom)
// tslint:disable-next-line: max-classes-per-file
class VEXProgramBumperPortStatus extends VEXProgramPortStatus {
    constructor() {
        super();
        /// Current set PWM power for the LED (>0 = Green, <0 = Red)
        this.power = 0;
        /// Current bumper fags (TBD)
        this.flags = 0;
        /// Current switch raw value (Only needed for debug)
        this.analogReading = 0;
    }
}
/// Type used to represent the current config for the robot's ports
// tslint:disable-next-line: max-classes-per-file
class VEXProgramPortConfig {
}

/// Value that represents the current values of the color sensor and gyro (123/Go)
class VEXSensorStatus {
}
/// Value that represents the current values of the color sensor and gyro (123/Go)
class VEXProgramSensorStatus {
    constructor() {
        /// Processed Hue value from RGBC
        this.Hue = 0;
        /// Processed brightness value in percent
        this.Brightness = 0;
        /// General Proximity value (0-255) Higher value = object closer
        this.Proximity = 0;
        /// Raw acceleration in x direction
        this.AccX = 0;
        /// Raw acceleration in y direction
        this.AccY = 0;
        /// Raw acceleration in z direction
        this.AccZ = 0;
        /// Raw gryo value in x direction
        this.GyroX = 0;
        /// Raw gryo value in y direction
        this.GyroY = 0;
        /// Raw gryo value in z direction
        this.GyroZ = 0;
        /// Pitch of the robot
        this.Pitch = 0;
        /// Role of the robot
        this.Roll = 0;
        /// Heading of the robot (0-360)
        this.Yaw = 0;
        //Raw Floor Sensor Value
        this.Floor = 0;
    }
}
/// Detailed information from the gyro sensor
class VEXGyroDetails {
}
class VEXSensorRegValue {
    constructor() {
        this.Flags = 0;
        this.DeviceAddress = 0;
        this.RegisterAddress = 0;
        this.DataLen = 0;
    }
}
var SensorConst;
(function (SensorConst) {
    SensorConst[SensorConst["CMD_SET_SENSOR_MODE"] = 16] = "CMD_SET_SENSOR_MODE";
    SensorConst[SensorConst["CMD_SET_SENSOR_REG"] = 17] = "CMD_SET_SENSOR_REG";
    SensorConst[SensorConst["CMD_SET_SENSOR_LED"] = 18] = "CMD_SET_SENSOR_LED";
    SensorConst[SensorConst["CMD_SET_GYRO_MODE"] = 32] = "CMD_SET_GYRO_MODE";
    SensorConst[SensorConst["CMD_SET_GYRO_REG"] = 33] = "CMD_SET_GYRO_REG";
    SensorConst[SensorConst["CMD_CAL_GYRO"] = 34] = "CMD_CAL_GYRO";
    SensorConst[SensorConst["CMD_SET_FLOOR_ONTIME"] = 48] = "CMD_SET_FLOOR_ONTIME";
    SensorConst[SensorConst["CMD_SET_RGB"] = 64] = "CMD_SET_RGB";
})(SensorConst || (SensorConst = {}));
var SensorFlagsConst;
(function (SensorFlagsConst) {
    SensorFlagsConst[SensorFlagsConst["SensorFlagColorMode"] = 1] = "SensorFlagColorMode";
    SensorFlagsConst[SensorFlagsConst["SensorFlagProxMode"] = 2] = "SensorFlagProxMode";
    SensorFlagsConst[SensorFlagsConst["SensorFlagGestMode"] = 4] = "SensorFlagGestMode";
})(SensorFlagsConst || (SensorFlagsConst = {}));
var VEXDeviceSensorMode;
(function (VEXDeviceSensorMode) {
    VEXDeviceSensorMode[VEXDeviceSensorMode["SENSOR_MODE_OFF"] = 0] = "SENSOR_MODE_OFF";
    VEXDeviceSensorMode[VEXDeviceSensorMode["SENSOR_MODE_COLOR_ONLY"] = 1] = "SENSOR_MODE_COLOR_ONLY";
    VEXDeviceSensorMode[VEXDeviceSensorMode["SENSOR_MODE_COLOR_PROX"] = 2] = "SENSOR_MODE_COLOR_PROX";
    VEXDeviceSensorMode[VEXDeviceSensorMode["SENSOR_MODE_GESTURE"] = 3] = "SENSOR_MODE_GESTURE";
    VEXDeviceSensorMode[VEXDeviceSensorMode["SENSOR_MODE_PROX_ONLY"] = 4] = "SENSOR_MODE_PROX_ONLY";
})(VEXDeviceSensorMode || (VEXDeviceSensorMode = {}));
var VEXMotorBrakeMode;
(function (VEXMotorBrakeMode) {
    VEXMotorBrakeMode[VEXMotorBrakeMode["Brake"] = 1] = "Brake";
    VEXMotorBrakeMode[VEXMotorBrakeMode["Coast"] = 2] = "Coast";
    VEXMotorBrakeMode[VEXMotorBrakeMode["Hold"] = 3] = "Hold";
})(VEXMotorBrakeMode || (VEXMotorBrakeMode = {}));
var BotSensors;
(function (BotSensors) {
    BotSensors[BotSensors["Gyro"] = 105] = "Gyro";
    BotSensors[BotSensors["Light"] = 57] = "Light";
})(BotSensors || (BotSensors = {}));
var SensorRegConst;
(function (SensorRegConst) {
    SensorRegConst[SensorRegConst["RegCmdFlagSetReg"] = 1] = "RegCmdFlagSetReg";
    SensorRegConst[SensorRegConst["RegCmdFlagGetReg"] = 2] = "RegCmdFlagGetReg";
})(SensorRegConst || (SensorRegConst = {}));


var VEXUserSettingsUpdateStatus;
(function (VEXUserSettingsUpdateStatus) {
    VEXUserSettingsUpdateStatus[VEXUserSettingsUpdateStatus["SUCCESS"] = 0] = "SUCCESS";
    VEXUserSettingsUpdateStatus[VEXUserSettingsUpdateStatus["VERSION_ERR"] = 255] = "VERSION_ERR";
    VEXUserSettingsUpdateStatus[VEXUserSettingsUpdateStatus["PARSE_ERROR"] = 254] = "PARSE_ERROR";
})(VEXUserSettingsUpdateStatus || (VEXUserSettingsUpdateStatus = {}));
/// Data type representing the Coder user settings
class CoderUserSettings {
    constructor() {
        /// What does th coder do on boot?
        this.CommandOnBoot = CoderCommandState.Nothing;
        /// Does the coder auto connect to last paired device?
        this.ConnectToPair = true;
        /// Idle timeout in ms
        this.IdleTimeout = 30000;
    }
}
var VEXAckValue;
(function (VEXAckValue) {
    VEXAckValue[VEXAckValue["success"] = 118] = "success";
    VEXAckValue[VEXAckValue["genericError"] = 255] = "genericError";
})(VEXAckValue || (VEXAckValue = {}));
// Data type representing the 123 Robot user settings
class VEX123RobotUserSettings {
    constructor() {
        /// Idle timeout in ms. Default is 5 minutes
        this.IdleTimeout = 300000;
        /// Sound volume (0-15). Default value = 15
        this.SoundVolume = 15;
    }
}