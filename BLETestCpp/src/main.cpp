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
auto inches = vex::inches;


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
#include "iq_cpp.h"

#include "structured_logger.h"
#include <cstdint>
#include <cstring>
#include <type_traits>

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

void print_something(void)
{
    print("Hello from the boring console!!!");
}

void print_num(void)
{
    static int32_t num = 0;
    num += 1;
    print("%lu", num);
}

uint16_t get_button_states(void)
{
    return (
          (controller.ButtonRDown.pressing() << 0)
        | (controller.ButtonRUp.pressing()   << 1)
        | (controller.ButtonR3.pressing()    << 2)
        | (controller.ButtonFUp.pressing()   << 3)
        | (controller.ButtonFDown.pressing() << 4)
        | (controller.ButtonEDown.pressing() << 5)
        | (controller.ButtonEUp.pressing()   << 6)
        | (controller.ButtonL3.pressing()    << 7)
        | (controller.ButtonLUp.pressing()   << 8)
        | (controller.ButtonLDown.pressing() << 9)
    );
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

    logger.add("ButtonStates", get_button_states);

    logger.add("Axis A",     []() -> int8_t { return controller.AxisA.position(); });
    logger.add("Axis B",     []() -> int8_t { return controller.AxisB.position(); });
    logger.add("Axis C",     []() -> int8_t { return controller.AxisC.position(); });
    logger.add("Axis D",     []() -> int8_t { return controller.AxisD.position(); });
    logger.add("Heading",    []() -> float { return brain_inertial.orientation(vex::yaw, degrees); });
    logger.add("Roll",       []() -> float { return brain_inertial.orientation(vex::roll, degrees); });
    logger.add("Pitch",      []() -> float { return brain_inertial.orientation(vex::pitch, degrees); });
    //logger.add("ax",         []() -> float { return brain_inertial.acceleration(vex::xaxis); }, true);
    //logger.add("ay",         []() -> float { return brain_inertial.acceleration(vex::yaxis); }, true);
    //logger.add("az",         []() -> float { return brain_inertial.acceleration(vex::zaxis); }, true);
    //logger.add("gx",         []() -> float { return brain_inertial.gyroRate(vex::xaxis, vex::dps); }, true);
    //logger.add("gy",         []() -> float { return brain_inertial.gyroRate(vex::yaxis, vex::dps); }, true);
    //logger.add("gz",         []() -> float { return brain_inertial.gyroRate(vex::zaxis, vex::dps); }, true);
    logger.add("dist_front", []() -> int16_t { return dist_front.objectDistance(mm); });
    logger.add("dist_rear",  []() -> int16_t { return dist_rear.objectDistance(mm); });
    //logger.add("optical_left.brightness", []() -> float { return optical_left.brightness(); });
    //logger.add("optical_right.brightness",[]() -> float { return optical_right.brightness(); });

    while (true)
    {
        logger.send_data_format();
        for (int i = 0; i < 50; i++)
        {
            logger.send_structured_data();
            if ((i % 2))
            {
                ai_vision.takeSnapshot(vex::aivision::ALL_OBJECTS);
                logger.send_vision_data(ai_vision.objects);
            }
            wait(20, msec);
        }
    }
}
