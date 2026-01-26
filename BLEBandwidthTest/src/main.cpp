/*----------------------------------------------------------------------------*/
/*                                                                            */
/*    Module:       main.cpp                                                  */
/*    Author:       kolbe                                                     */
/*    Created:      1/25/2026, 12:28:30 PM                                    */
/*    Description:  IQ2 project                                               */
/*                                                                            */
/*----------------------------------------------------------------------------*/
#include <string>
#include "vex.h"

using namespace vex;

// A global instance of vex::brain used for printing to the IQ2 brain screen
vex::brain       Brain;

// define your global instances of motors and other devices here

int packetsize = 8;
const int increment = 8;

void packetSizeUp() {
    // packetsize += increment;
    uint8_t c = 'A';
    int row = 1;
    int col = 1;
    for (int i = 0; i < 10; i++)
    {
        int ret = printf("%s", std::string(400, c).c_str());
        fflush(stdout);
        this_thread::sleep_for(100);
        Brain.Screen.setCursor(row, col);
        if (++row > 5)
        {
            row = 1;
            col = (col > 8) ? 1 : col + 8;
        }
        Brain.Screen.print("p(%c):%d", c, ret);
        c++;
    }
    printf("\n");
    fflush(stdout);
}

void packetSizeDown() {
    packetsize -= increment;
}

#define CUSTOM_BUFFER_SIZE  10240
char custom_buffer[CUSTOM_BUFFER_SIZE];

int main()
{
    setvbuf(stdout, custom_buffer, _IOFBF, CUSTOM_BUFFER_SIZE);

    Brain.buttonUp.pressed( packetSizeUp );
    Brain.buttonDown.pressed( packetSizeDown );

    while(1) {
        // std::string s(packetsize - 7, 'A');
        // printf("%4d %s\n", packetsize, s.c_str());
        // Allow other tasks to run
        this_thread::sleep_for(100);
    }
}
