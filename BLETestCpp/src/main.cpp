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
auto mm = vex::mm;


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

vex::controller controller = vex::controller();
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

#include "structured_logger.h"

#include <cstdint>
#include <vector>
#include <cstring>
#include <type_traits>

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

StructuredLogger logger{};

int main()
{
    // Disable line buffering: use fully buffered mode (_IOFBF)
    // buffer = NULL -> library allocates buffer automatically
    setvbuf(stdout, NULL, _IOFBF, BUFSIZ);
    vexcodeInit();

    optical_left.setLight(vex::ledState::on);
    optical_right.setLight(vex::ledState::on);

    brain.buttonUp.pressed(print_num);
    brain.buttonDown.pressed(print_something);

    logger.add("Axis A",     [](){ return controller.AxisA.position(); });
    logger.add("Axis B",     [](){ return controller.AxisB.position(); });
    logger.add("Axis C",     [](){ return controller.AxisC.position(); });
    logger.add("Axis D",     [](){ return controller.AxisD.position(); });
    logger.add("Heading",    [](){ return normalize(brain_inertial.heading()); });
    logger.add("Rotation",   [](){ return brain_inertial.rotation(); });
    logger.add("Roll",       [](){ return brain_inertial.orientation(vex::roll, degrees); });
    logger.add("Pitch",      [](){ return brain_inertial.orientation(vex::pitch, degrees); });
    logger.add("Yaw",        [](){ return brain_inertial.orientation(vex::yaw, degrees); });
    logger.add("ax",         [](){ return brain_inertial.acceleration(vex::xaxis); });
    logger.add("ay",         [](){ return brain_inertial.acceleration(vex::yaxis); });
    logger.add("az",         [](){ return brain_inertial.acceleration(vex::zaxis); });
    logger.add("gx",         [](){ return brain_inertial.gyroRate(vex::xaxis, vex::dps); });
    logger.add("gy",         [](){ return brain_inertial.gyroRate(vex::yaxis, vex::dps); });
    logger.add("gz",         [](){ return brain_inertial.gyroRate(vex::zaxis, vex::dps); });
    logger.add("dist_front", [](){ return dist_front.objectDistance(mm); });
    logger.add("dist_rear",  [](){ return dist_rear.objectDistance(mm); });
    logger.add("optical_left.brightness", [](){ return optical_left.brightness(); });
    logger.add("optical_right.brightness",[](){ return optical_right.brightness(); });

    while (true)
    {
        logger.send_data_format();
        for (int i = 0; i < 10; i++)
        {
            logger.send_structured_data();
            send_vision_data();
            wait(100, msec);
        }
    }
}
