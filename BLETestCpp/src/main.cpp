#pragma region VEXcode Generated Robot Configuration
// Make sure all required headers are included.
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <math.h>
#include <string.h>

#include "vex.h"

vex::brain brain;

// Define names in this namespace
using colorType = vex::colorType;
auto degrees = vex::degrees;
auto forward = vex::forward;
auto reverse = vex::reverse;
auto msec    = vex::msec;
auto seconds = vex::seconds;


// START IQ MACROS
#define waitUntil(condition) \
    do                       \
    {                        \
        vex::wait(5, msec);  \
    } while (!(condition))

#define repeat(iterations) \
    for (int iterator = 0; iterator < iterations; iterator++)
// END IQ MACROS

// Robot configuration code.
vex::inertial brain_inertial = vex::inertial();
// AI Classification Competition Element IDs - Mix & Match
enum gameElementsMixAndMatch
{
    beam,
    bluePin,
    redPin,
    orangePin,
};

vex::motor left_drive_smart = vex::motor(vex::PORT9, 2, true);
vex::motor right_drive_smart = vex::motor(vex::PORT10, 2, false);

vex::smartdrive Drivetrain = vex::smartdrive(left_drive_smart, right_drive_smart, brain_inertial, 200);

vex::distance dist_front = vex::distance(vex::PORT11);
vex::distance dist_rear = vex::distance(vex::PORT8);
// AI Vision Color Descriptions
// AI Vision Code Descriptions
vex::aivision ai_vision(vex::PORT2, vex::aivision::ALL_TAGS, vex::aivision::ALL_AIOBJS);

vex::controller Controller = vex::controller();
vex::optical optical_left = vex::optical(vex::PORT7);
vex::optical optical_right = vex::optical(vex::PORT12);

// generating and setting random seed
void initializeRandomSeed()
{
    wait(100, msec);
    double xAxis = brain_inertial.acceleration(vex::xaxis) * 1000;
    double yAxis = brain_inertial.acceleration(vex::yaxis) * 1000;
    double zAxis = brain_inertial.acceleration(vex::zaxis) * 1000;
    // Combine these values into a single integer
    int seed = int(xAxis + yAxis + zAxis);
    // Set the seed
    srand(seed);
}

// Converts a color to a string
const char *convertColorToString(vex::color col)
{
    if (col == vex::colorType::red)
        return "red";
    else if (col == vex::colorType::green)
        return "green";
    else if (col == vex::colorType::blue)
        return "blue";
    else if (col == vex::colorType::white)
        return "white";
    else if (col == vex::colorType::yellow)
        return "yellow";
    else if (col == vex::colorType::orange)
        return "orange";
    else if (col == vex::colorType::purple)
        return "purple";
    else if (col == vex::colorType::cyan)
        return "cyan";
    else if (col == vex::colorType::black)
        return "black";
    else if (col == vex::colorType::transparent)
        return "transparent";
    else if (col == vex::colorType::red_violet)
        return "red_violet";
    else if (col == vex::colorType::violet)
        return "violet";
    else if (col == vex::colorType::blue_violet)
        return "blue_violet";
    else if (col == vex::colorType::blue_green)
        return "blue_green";
    else if (col == vex::colorType::yellow_green)
        return "yellow_green";
    else if (col == vex::colorType::yellow_orange)
        return "yellow_orange";
    else if (col == vex::colorType::red_orange)
        return "red_orange";
    else if (col == vex::colorType::none)
        return "none";
    else
        return "unknown";
}

// Convert vex::colorType to string
const char *convertColorToString(vex::colorType col)
{
    if (col == vex::colorType::red)
        return "red";
    else if (col == vex::colorType::green)
        return "green";
    else if (col == vex::colorType::blue)
        return "blue";
    else if (col == vex::colorType::white)
        return "white";
    else if (col == vex::colorType::yellow)
        return "yellow";
    else if (col == vex::colorType::orange)
        return "orange";
    else if (col == vex::colorType::purple)
        return "purple";
    else if (col == vex::colorType::cyan)
        return "cyan";
    else if (col == vex::colorType::black)
        return "black";
    else if (col == vex::colorType::transparent)
        return "transparent";
    else if (col == vex::colorType::red_violet)
        return "red_violet";
    else if (col == vex::colorType::violet)
        return "violet";
    else if (col == vex::colorType::blue_violet)
        return "blue_violet";
    else if (col == vex::colorType::blue_green)
        return "blue_green";
    else if (col == vex::colorType::yellow_green)
        return "yellow_green";
    else if (col == vex::colorType::yellow_orange)
        return "yellow_orange";
    else if (col == vex::colorType::red_orange)
        return "red_orange";
    else if (col == vex::colorType::none)
        return "none";
    else
        return "unknown";
}
bool vexcode_initial_drivetrain_calibration_completed = false;
void calibrateDrivetrain()
{
    wait(200, msec);
    brain.Screen.print("Calibrating");
    brain.Screen.newLine();
    brain.Screen.print("Inertial");
    brain_inertial.calibrate();
    while (brain_inertial.isCalibrating())
    {
        wait(25, msec);
    }
    vexcode_initial_drivetrain_calibration_completed = true;
    // Clears the screen and returns the cursor to row 1, column 1.
    brain.Screen.clearScreen();
    brain.Screen.setCursor(1, 1);
}

void vexcodeInit()
{
    // Calibrate the Drivetrain
    //calibrateDrivetrain();

    // Initializing random seed.
    initializeRandomSeed();
}

// define variable for remote controller enable/disable
bool RemoteControlCodeEnabled = true;

#pragma endregion VEXcode Generated Robot Configuration

//----------------------------------------------------------------------------
//
//    Module:       main.cpp
//    Author:       {author}
//    Created:      {date}
//    Description:  IQ project
//
//----------------------------------------------------------------------------

// Include the IQ Library
#include "iq_cpp.h"

#include <cstdint>
#include <vector>
#include <cstring>
#include <type_traits>
#include <stdexcept>

// ------------------------------------------------------------
// Core helper: append an integer value in big-endian byte order
// ------------------------------------------------------------
template<typename IntT>
void pack_integer_be(std::vector<uint8_t>& buf, IntT value)
{
    for (uint32_t i = 0; i < sizeof(IntT); ++i) {
        buf.push_back(static_cast<uint8_t>(value >> (8 * (sizeof(IntT) - 1 - i))));
    }
}

// ------------------------------------------------------------
// Generic pack<T> for integral types
// ------------------------------------------------------------
template<typename T>
void pack(std::vector<uint8_t>& buf, T value)
{
    static_assert(std::is_integral<T>::value, "pack<T>: integral types only");
    pack_integer_be(buf, value);
}

// ------------------------------------------------------------
// Overload for float
// ------------------------------------------------------------
void pack(std::vector<uint8_t>& buf, float value)
{
    uint32_t bits;
    std::memcpy(&bits, &value, sizeof(bits));
    pack_integer_be(buf, bits);
}

// ------------------------------------------------------------
// Overload for double
// ------------------------------------------------------------
void pack(std::vector<uint8_t>& buf, double value)
{
    uint64_t bits;
    std::memcpy(&bits, &value, sizeof(bits));
    pack_integer_be(buf, bits);
}

// ------------------------------------------------------------
// Variable-length integer packing
// ------------------------------------------------------------
template<typename T>
void pack_var_int(std::vector<uint8_t>& buf, T num)
{
    if ((num >= 0) && (num < 128))
    {
        pack<uint8_t>(buf, static_cast<uint8_t>(num));
        return;
    }
    if (num < 32768)
    {
        pack<uint16_t>(buf, static_cast<uint16_t>(num | 0x8000));
        return;
    }
    printf("WARNING: Number too large to pack (in pack_var_int): %lld\n", (long long)num);
}


struct valForPack {
    u_char format;
    char* name;
};

double normalize(double angle)
{
    while (angle < -180)
    {
       angle += 360;
    }
    while (angle >= 180)
    {
        angle -= 360;
    }
    return angle;
}

/*
idc = {
    0:  ("Axis A",  "b",  lambda: controller.axisA.position()),
    1:  ("Axis B",  "b",  lambda: controller.axisB.position()),
    2:  ("Axis C",  "b",  lambda: controller.axisC.position()),
    3:  ("Axis D",  "b",  lambda: controller.axisD.position()),
    4:  ("Heading", "f",  lambda: normalize(brain_inertial.heading())),
    5:  ("Rotation", "f", lambda: brain_inertial.rotation()),
    6:  ("Roll", "f",     lambda: brain_inertial.orientation(ROLL)),
    7:  ("Pitch", "f",    lambda: brain_inertial.orientation(PITCH)),
    8:  ("Yaw", "f",      lambda: brain_inertial.orientation(YAW)),
    9:  ("ax", "f",       lambda: brain_inertial.acceleration(AxisType.XAXIS)),
    10: ("ay", "f",       lambda: brain_inertial.acceleration(AxisType.YAXIS)),
    11: ("az", "f",       lambda: brain_inertial.acceleration(AxisType.ZAXIS)),
    12: ("gx", "f",       lambda: brain_inertial.gyro_rate(AxisType.XAXIS)),
    13: ("gy", "f",       lambda: brain_inertial.gyro_rate(AxisType.YAXIS)),
    14: ("gz", "f",       lambda: brain_inertial.gyro_rate(AxisType.ZAXIS)),
    15: ("dist_front", "f", lambda: dist_front.object_distance(MM)),
    16: ("dist_rear", "f",  lambda: dist_rear.object_distance(MM)),
    17: ("optical_left.brightness", "f",   lambda: optical_left.brightness()),
    18: ("optical_right.brightness", "f",  lambda: optical_right.brightness()),
}
*/
// for i in range(15, 100):
// idc[i] = ("Test {i}".format(i = i), "f", lambda : urandom.uniform(-180, 180))




void pack_len(std::vector<uint8_t>& buf, int offset)
{
    // -2 bytes for encoded length
    const int payload_len = buf.size() - offset - 2;
    if (payload_len >= 32768)
    {
        printf("WARNING: Number too large to pack (in pack_len): %d\n", payload_len);
        return;
    }

    // pack most significant byte and set most significant bit
    buf[offset]     = ((uint8_t)(payload_len >> 8)) | 0x80;
    buf[offset + 1] = (uint8_t)(payload_len);
}

/*
void send_data_format(void)
{
    special_header = b"\xc0\xde"
    format_cmd = b"\x46"
    buffer = b""
    // packing format is:
    // header(2), cmd(1), len(1 / 2), (id(2), format(1), name(null - terminated))
    for (code, (name, fmt, _) in idc.items())
    {
        // send id of value
        buffer += pack_var_int(code);
        // send format char
        buffer += fmt.encode('utf-8');
        // send name null - terminated
        buffer += name.encode('utf-8') + b"\x00";
    }
    // prefix packet with total length
    buffer = special_header + format_cmd + pack_len(buffer) + buffer
    // send data
    sys.stdout.buffer.write(buffer);
}


void send_structured_data(void)
{
    special_header = b"\xc0\xde";
    data_cmd = b"\x44";
    buffer = b"";
    for code, (name, fmt, func) in idc.items():
    {
        // send id of value
        buffer += pack_var_int(code);
        // get the value
        val = func();
        // pack the value
        buffer += struct.pack("!" + fmt, val);
    }
    // prefix packet with total length
    buffer = special_header + data_cmd + pack_len(buffer) + buffer;
    // send data
    sys.stdout.buffer.write(buffer);
}
*/

uint8_t get_vision_object_type(vex::aivision::object& obj)
{
    // encode obj.type in the top 2 bits of the returned byte
    switch (obj.type)
    {
        case vex::aivision::objectType::colorObject:
            return 0b00000000;

        case vex::aivision::objectType::codeObject:
            return 0b01000000;

        case vex::aivision::objectType::modelObject:
            return 0b10000000;

        case vex::aivision::objectType::tagObject:
            return 0b11000000;

        default:
            return 0xFF;
    }
}


void pack_vision_object(std::vector<uint8_t>& buf, vex::aivision::object& obj)
{
    // obj.id; store in bottom 6 bits of first byte
    // classroom objects: 0 - 7
    // VIQRC Mix & Match objects: 0 - 3
    // AprilTag: 0 - 36
    const uint8_t obj_type = get_vision_object_type(obj);
    if (obj_type == 0xFF)
    {
        printf("Unsupported objectType %d\n", obj.type);
        return;
    }
    uint8_t obj_id = obj_type | (obj.id & 0b111111);
    buf.push_back(obj_id);
    pack_var_int(buf, obj.originX);    //  0-320
    pack_var_int(buf, obj.originY);    //  0-240
    pack_var_int(buf, obj.centerX);    //  0-320
    pack_var_int(buf, obj.centerY);    //  0-240
    pack_var_int(buf, obj.width);      //  1-320
    pack_var_int(buf, obj.height);     //  1-240
    pack_var_int(buf, obj.score);      //  1-100
    pack(buf, obj.angle);              //  0-360; float
    if (obj.type == vex::aivision::objectType::tagObject)
    {
        // only pack if it's an AprilTag
        pack_var_int(buf, obj.tag.x[0]);
        pack_var_int(buf, obj.tag.y[0]);
        pack_var_int(buf, obj.tag.x[1]);
        pack_var_int(buf, obj.tag.y[1]);
        pack_var_int(buf, obj.tag.x[2]);
        pack_var_int(buf, obj.tag.y[2]);
        pack_var_int(buf, obj.tag.x[3]);
        pack_var_int(buf, obj.tag.y[3]);
    }
}


void send_vision_data()
{
    ai_vision.takeSnapshot(vex::aivision::ALL_OBJECTS);
    uint32_t num_objs = 0;
    uint32_t num_tags = 0;
    const int objs_len = ai_vision.objects.getLength();
    for (int i = 0; i < objs_len; i++)
    {
        vex::aivision::object obj = ai_vision.objects[i];
        if (obj.exists)
        {
            if (obj.type == vex::aivision::objectType::tagObject)
            {
                num_objs++;
            }
            else
            {
                num_tags++;
            }
        }
    }
    std::vector<uint8_t> buf{};
    const int header_len = 5;
    buf.reserve(header_len + (num_tags * 35) + (num_objs * 19));
    buf.push_back(0xc0); // special header
    buf.push_back(0xde); // special header
    buf.push_back(0x49); // ai_vision_command
    buf.push_back(0x00); // fill length in here
    buf.push_back(0x00); // fill length in here
    for (int i = 0; i < objs_len; i++)
    {
        vex::aivision::object& obj = ai_vision.objects[i];
        if (obj.exists)
        {
            pack_vision_object(buf, obj);
        }
    }
    pack_len(buf, 3);
    fwrite(buf.data(), 1, buf.size(), stdout);
    fflush(stdout);
}

void print_something(void)
{
    printf("Hello from the boring console!!!\n");
}

void print_num(void)
{
    static int32_t num = 0;
    num += 1;
    printf("%lu\n", num);
}

int main()
{
    // Disable line buffering: use fully buffered mode (_IOFBF)
    // buffer = NULL -> library allocates buffer automatically
    setvbuf(stdout, NULL, _IOFBF, BUFSIZ);
    vexcodeInit();
    brain.buttonUp.pressed(print_num);
    brain.buttonDown.pressed(print_something);
    while (true)
    {
        // send_data_format();
        for (int i = 0; i < 10; i++)
        {
            // send_structured_data();
            int last_time = brain.Timer.time(msec);
            send_vision_data();
            printf("Time: %d\n", (int)(brain.Timer.time(msec)) - last_time);
            wait(100, msec);
        }
    }
}
