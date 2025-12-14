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
    FILE_INIT: { cmd: 0x11, replyLength: 17 },
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
    SYS_DASH_SEL: { cmd: 0x2B, replyLength: 8 },
    SYS_KV_LOAD: { cmd: 0x2E, replyLength: 0xFFFF },
    SYS_KV_SAVE: { cmd: 0x2F, replyLength: 8 },
    AI2CAM_SETTINGS: { cmd: 0x61, replyLength: 8 },
    AI2CAM_DETSET: { cmd: 0x62, replyLength: 8 },
    AI2CAM_DETGET: { cmd: 0x63, replyLength: 0xFFFF },
    AI2CAM_OBJECTS: { cmd: 0x68, replyLength: 0xFFFF },
    AI2CAM_CLASSES: { cmd: 0x69, replyLength: 0xFFFF },
    AI2CAM_CLEAR: { cmd: 0x6E, replyLength: 8 },
    AI2CAM_STATUS: { cmd: 0x6F, replyLength: 0xFFFF },
    FACTORY_STATUS: { cmd: 0xF1, replyLength: 10 },
    FACTORY_RESET: { cmd: 0xF2, replyLength: 0 },
    FACTORY_PING: { cmd: 0xF4, replyLength: 8 },
    FACTORY_PONG: { cmd: 0xF5, replyLength: 0xFFFF },
    FACTORY_SPECIAL: { cmd: 0xFE, replyLength: 8 },
    FACTORY_EBL: { cmd: 0xFF, replyLength: 8 },
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
// Offset from unix time for timestamp fields
// timestamp = (unix time) - J2000_EPOCH
VexCDC.J2000_EPOCH = 946684800;
//VexCDC.js.map

/***/ }),