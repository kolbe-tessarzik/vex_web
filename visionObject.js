function getName(id, type, _config) {
    const config = _config ?? "GameElementsMixAndMatch"; // "ClassroomElements"
    switch (type) {
        case 0:
            return "Color Object"
        case 1:
            return "Code Object"
        case 2:
            // AI classified objects
            // Classroom objects or VIQRC Mix and Match objects, depeding on configuration
            if (config === "GameElementsMixAndMatch") {
                switch (id) {
                    case 0:
                        return "Beam";
                    case 1:
                        return "Blue Pin";
                    case 2:
                        return "Red Pin";
                    case 3:
                        return "Orange Pin";
                    default:
                        return `GameElementsMixAndMatch(${id})`;
                }
            } else { // ClassroomElements
                switch (id) {
                    case 0:
                        return "Blue Ball";
                    case 1:
                        return "Green Ball";
                    case 2:
                        return "Red Ball";
                    case 3:
                        return "Blue Ring";
                    case 4:
                        return "Green Ring";
                    case 5:
                        return "Red Ring";
                    case 6:
                        return "Blue Cube";
                    case 7:
                        return "Green Cube";
                    case 8:
                        return "Red Cube";
                    default:
                        return `ClassroomElements(${id})`;
                }
            }
        case 3:
            return `AprilTag ${id}`;
        default:
            return "Unknown";
    }
}

/**
* @param {DataView} dv
* @param {Number} offset
*/
function unpackVarInt(dv, offset) {
    let result = dv.getUint8(offset);
    if (result & 0x80) {
        // 16 bit value
        result = dv.getUint16(offset) & 0x7FFF;
        return [result, offset + 2];
    } else {
        // 8 bit value
        return [result, offset + 1];
    }
}

const unpackInt8    = (d, i) => [d.getInt8(i),    i+1];
const unpackUint8   = (d, i) => [d.getUint8(i),   i+1];
const unpackInt16   = (d, i) => [d.getInt16(i),   i+2];
const unpackUint16  = (d, i) => [d.getUint16(i),  i+2];
const unpackInt32   = (d, i) => [d.getInt32(i),   i+4];
const unpackUint32  = (d, i) => [d.getUint32(i),  i+4];
const unpackInt64   = (d, i) => [d.getInt64(i),   i+8];
const unpackUint64  = (d, i) => [d.getUint64(i),  i+8];
const unpackFloat16 = (d, i) => [d.getFloat16(i), i+2];
const unpackFloat32 = (d, i) => [d.getFloat32(i), i+4];
const unpackFloat64 = (d, i) => [d.getFloat64(i), i+8];

class VisionObject {
    /*
    * @constructor
    * @param {DataView} dv
    */
    constructor(dv) {
        let i = 0;
        const obj_id = dv.getUint8(i++);
        this.id = obj_id & 0b111111;
        this.type = (obj_id & 0b11000000) >> 6;
        this.name = getName(this.id, this.type, "GameElementsMixAndMatch");

        if (this.type == 3) {
            // AprilTag: build quad from tag points
            this.quad = [];
            for (let j = 0; j < 4; j++) {
                let x, y;
                [x, i] = unpackVarInt(dv, i);
                [y, i] = unpackUint8(dv, i);
                this.quad.push({x: x, y: y});
            }
            [this.angle, i] = unpackVarInt(dv, i);
            this.angle /= 10.0;

            this.quad.reverse();

            this.centerX = this.quad.reduce((s, p) => s + p.x, 0) / 4;
            this.centerY = this.quad.reduce((s, p) => s + p.y, 0) / 4;
            this.quad9 = this.quad.map(p => ({
                x: this.centerX + (p.x - this.centerX) * (9 / 5),
                y: this.centerY + (p.y - this.centerY) * (9 / 5)
            }));

            this.originX = Math.min(...this.quad.map(p => p.x));
            this.originY = Math.min(...this.quad.map(p => p.y));

            const maxX = Math.max(...this.quad.map(p => p.x));
            const maxY = Math.max(...this.quad.map(p => p.y));

            this.width  = maxX - this.originX;
            this.height = maxY - this.originY;
        } else {
            [this.originX, i] = unpackVarInt(dv, i);
            [this.originY, i] = unpackUint8(dv, i);
            [this.width,   i] = unpackVarInt(dv, i);
            [this.height,  i] = unpackUint8(dv, i);
            [this.score,   i] = unpackUint8(dv, i);

            this.centerX = this.originX + (this.width / 2.0);
            this.centerY = this.originY + (this.height / 2.0);
        }

        this.byteLength = i;
    }
}
