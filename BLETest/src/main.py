#region VEXcode Generated Robot Configuration
from vex import *
import urandom
import math

# Brain should be defined by default
brain=Brain()

# Robot configuration code
brain_inertial = Inertial()
# AI Classification Competition Element IDs - Mix & Match
class GameElementsMixAndMatch:
    BEAM = 0
    BLUE_PIN = 1
    RED_PIN = 2
    ORANGE_PIN = 3
left_drive_smart = Motor(Ports.PORT9, 2.0, True)
right_drive_smart = Motor(Ports.PORT10, 2.0, False)

drivetrain = SmartDrive(left_drive_smart, right_drive_smart, brain_inertial, 200)
dist_front = Distance(Ports.PORT11)
dist_rear = Distance(Ports.PORT8)
# AI Vision Color Descriptions
# AI Vision Code Descriptions
ai_vision = AiVision(Ports.PORT2, AiVision.ALL_AIOBJS, AiVision.ALL_TAGS)
controller = Controller()
optical_left = Optical(Ports.PORT7)
optical_right = Optical(Ports.PORT12)


# generating and setting random seed
def initializeRandomSeed():
    wait(100, MSEC)
    xaxis = brain_inertial.acceleration(XAXIS) * 1000
    yaxis = brain_inertial.acceleration(YAXIS) * 1000
    zaxis = brain_inertial.acceleration(ZAXIS) * 1000
    systemTime = brain.timer.system() * 100
    urandom.seed(int(xaxis + yaxis + zaxis + systemTime))

# Initialize random seed
initializeRandomSeed()


# Color to String Helper
def convert_color_to_string(col):
    if col == Color.RED:
        return "red"
    if col == Color.GREEN:
        return "green"
    if col == Color.BLUE:
        return "blue"
    if col == Color.WHITE:
        return "white"
    if col == Color.YELLOW:
        return "yellow"
    if col == Color.ORANGE:
        return "orange"
    if col == Color.PURPLE:
        return "purple"
    if col == Color.CYAN:
        return "cyan"
    if col == Color.RED_VIOLET:
        return "red_violet"
    if col == Color.VIOLET:
        return "violet"
    if col == Color.BLUE_VIOLET:
        return "blue_violet"
    if col == Color.BLUE_GREEN:
        return "blue_green"
    if col == Color.YELLOW_GREEN:
        return "yellow_green"
    if col == Color.YELLOW_ORANGE:
        return "yellow_orange"
    if col == Color.RED_ORANGE:
        return "red_orange"
    if col == Color.BLACK:
        return "black"
    if col == Color.TRANSPARENT:
        return "transparent"
    return ""
vexcode_initial_drivetrain_calibration_completed = False
def calibrate_drivetrain():
    # Calibrate the Drivetrain Inertial
    global vexcode_initial_drivetrain_calibration_completed
    sleep(200, MSEC)
    brain.screen.print("Calibrating")
    brain.screen.next_row()
    brain.screen.print("Inertial")
    brain_inertial.calibrate()
    while brain_inertial.is_calibrating():
        sleep(25, MSEC)
    vexcode_initial_drivetrain_calibration_completed = True
    brain.screen.clear_screen()
    brain.screen.set_cursor(1, 1)


# Calibrate the Drivetrain
# calibrate_drivetrain()

#endregion VEXcode Generated Robot Configuration

# ------------------------------------------
#
# 	Project:      VEXcode Project
# 	Author:       VEX
# 	Created:
# 	Description:  VEXcode IQ Python Project
#
# ------------------------------------------

# Library imports
from vex import *
import sys
import struct

def normalize(angle):
    while angle < -180:
        angle += 360
    while angle >= 180:
        angle -= 360
    return angle


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

# for i in range(15, 100):
#     idc[i] = ("Test {i}".format(i=i), "f", lambda: urandom.uniform(-180, 180) )

num = 0

def print_something():
    print("Hello from the boring console!!!")


def print_num():
    global num
    num += 1
    print(num)


def pack_var_int(num):
    if num < 128:
        return struct.pack("!B", num)
    elif num < 32768:
        # two byte num
        return struct.pack("!H", num | 0x8000)
    else:
        raise(ValueError("Number too large to pack"))


def pack_len(payload):
    return pack_var_int(len(payload))


def send_data_format():
    special_header = b"\xc0\xde"
    format_cmd = b"\x46"
    buffer = b""
    # packing format is:
    # header(2), cmd(1), len(1/2), (id(2), format(1), name(null-terminated))
    for code, (name, fmt, _) in idc.items():
        # send id of value
        buffer += pack_var_int(code)
        # send format char
        buffer += fmt.encode('utf-8')
        # send name null-terminated
        buffer += name.encode('utf-8') + b"\x00"
    # prefix packet with total length
    buffer = special_header + format_cmd + pack_len(buffer) + buffer
    # send data
    sys.stdout.buffer.write(buffer)


def send_structured_data():
    special_header = b"\xc0\xde"
    data_cmd = b"\x44"
    buffer = b""
    for code, (name, fmt, func) in idc.items():
        # send id of value
        buffer += pack_var_int(code)
        # get the value
        val = func()
        # pack the value
        buffer += struct.pack("!" + fmt, val)
    # prefix packet with total length
    buffer = special_header + data_cmd + pack_len(buffer) + buffer
    # send data
    sys.stdout.buffer.write(buffer)


def convert_vision_object_type(x):
    if x == AiVision.COLOR_OBJECT:
        return 0
    elif x == AiVision.CODE_OBJECT:
        return 1
    elif x == AiVision.AI_OBJECT:
        return 2
    elif x == AiVision.TAG_OBJECT:
        return 3
    else:
        raise(ValueError("Unknown AiVision Object type"))


def pack_vision_object(obj):
    # obj.id; store in bottom 6 bits of first byte
    #   classroom objects: 0-7
    #   VIQRC Mix & Match objects: 0-3
    #   AprilTag: 0-36
    obj_type = convert_vision_object_type(obj.type)
    obj_id = ((obj_type & 0b11) << 6) | (obj.id & 0b111111)
    buffer = b""
    buffer += struct.pack("!B", obj_id)
    buffer += pack_var_int(obj.originX)    # 0-320
    buffer += pack_var_int(obj.originY)    # 0-240
    buffer += pack_var_int(obj.centerX)    # 0-320
    buffer += pack_var_int(obj.centerY)    # 0-240
    buffer += pack_var_int(obj.width)      # 1-320
    buffer += pack_var_int(obj.height)     # 1-240
    buffer += pack_var_int(obj.score)      # 1-100
    buffer += struct.pack("!f", obj.angle) # 0-360; float
    if obj.type == AiVision.TAG_OBJECT:
        # only pack if it's an AprilTag
        buffer += pack_var_int(obj.tag.x[0])
        buffer += pack_var_int(obj.tag.y[0])
        buffer += pack_var_int(obj.tag.x[1])
        buffer += pack_var_int(obj.tag.y[1])
        buffer += pack_var_int(obj.tag.x[2])
        buffer += pack_var_int(obj.tag.y[2])
        buffer += pack_var_int(obj.tag.x[3])
        buffer += pack_var_int(obj.tag.y[3])
    return buffer


def send_vision_data():
    special_header = b"\xc0\xde"
    ai_vision_command = b"\x49"
    buffer = b""
    objects = ai_vision.take_snapshot(AiVision.ALL_OBJECTS)
    for i, obj in enumerate(objects):
        buffer += pack_vision_object(obj)
    # prefix packet with total length
    buffer = special_header + ai_vision_command + pack_len(buffer) + buffer
    # send data
    sys.stdout.buffer.write(buffer)


def main():
    brain.buttonUp.pressed(print_num)
    brain.buttonDown.pressed(print_something)
    while True:
        send_data_format()
        for i in range(10):
            send_structured_data()
            send_vision_data()
            wait(100, MSEC)


main()
