#!/usr/bin/env python3

import argparse
import os
import struct
import sys
from collections import Counter
from datetime import datetime, timezone

import requests

try:
    from fitparse import FitFile
except ImportError:
    sys.exit("Missing dependency: pip install fitparse")


BASE_URL = "https://intervals.icu/api/v1"

GLOBAL_SESSION = 18
FIELD_START_TIME = 2
FIELD_SPORT = 5
"""
SPORTS = {
    "Generic": 0,
    "Run": 1,
    "Running": 1,
    "Bike": 2,
    "Cycling": 2,
    "Transition": 3,
    "Fitness": 4,
    "Swim": 5,
    "Swimming": 5,
    "Walk": 6,
    "Walking": 6,
    "Hike": 7,
    "Hiking": 7,
    "Row": 12,
    "Rowing": 12,
    "Training": 14,
    "Workout": 14,
    "Elliptical": 15,
}
"""
SPORTS = {
    "Generic": 0,
    "Run": 1,
    "Running": 1,
    "Bike": 2,
    "Cycling": 2,
    "Transition": 3,
    "Fitness": 4,
    "FitnessEquipment": 4,
    "Swim": 5,
    "Swimming": 5,
    "Basketball": 6,
    "Soccer": 7,
    "Tennis": 8,
    "AmericanFootball": 9,
    "Training": 10,
    "Walk": 11,
    "Walking": 11,
    "CrossCountrySkiing": 12,
    "AlpineSkiing": 13,
    "Snowboarding": 14,
    "Row": 15,
    "Rowing": 15,
    "Mountaineering": 16,
    "Hike": 17,
    "Hiking": 17,
    "Multisport": 18,
    "Paddling": 19,
    "Flying": 20,
    "EBiking": 21,
    "Motorcycling": 22,
    "Boating": 23,
    "Driving": 24,
    "Golf": 25,
    "HangGliding": 26,
    "HorsebackRiding": 27,
    "Hunting": 28,
    "Fishing": 29,
    "InlineSkating": 30,
    "RockClimbing": 31,
    "Sailing": 32,
    "IceSkating": 33,
    "Skydiving": 34,
}

CRC_TABLE = (
    0x0000, 0xCC01, 0xD801, 0x1400,
    0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401,
    0x5000, 0x9C01, 0x8801, 0x4400,
)


def fit_crc(data):
    crc = 0

    for byte in data:
        tmp = CRC_TABLE[crc & 0x0F]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ CRC_TABLE[byte & 0x0F]

        tmp = CRC_TABLE[crc & 0x0F]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ CRC_TABLE[(byte >> 4) & 0x0F]

    return crc


def load_fit(file_path):
    if not os.path.isfile(file_path):
        raise FileNotFoundError(file_path)

    return FitFile(file_path)


def format_timestamp(value):
    if not isinstance(value, datetime):
        return str(value)

    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)

    return value.isoformat()


def parse_date(value):
    value = value.strip()

    if value.endswith("Z"):
        value = value[:-1] + "+00:00"

    try:
        result = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError(
            "Invalid --date. Use ISO-8601, e.g. "
            "2026-08-08T08:57:54+00:00"
        ) from error

    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)

    return result


def fit_timestamp(value):
    epoch = datetime(
        1989,
        12,
        31,
        tzinfo=timezone.utc,
    )

    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)

    return int((value - epoch).total_seconds())


def fit_summary(file_path):
    fit = load_fit(file_path)

    messages = Counter()
    fields = {}

    start_time = None
    end_time = None
    sport = None
    sub_sport = None
    manufacturer = None
    product = None
    device_type = None

    for message in fit.get_messages():
        name = message.name
        messages[name] += 1
        fields.setdefault(name, set())

        for i, field in enumerate(message.fields):
            #print(i, field.name, field.value )
            fields[name].add(field.name)

            if name == "session":
                if field.name == "start_time":
                    start_time = field.value
                elif field.name == "sport":
                    sport = field.value
                elif field.name == "sub_sport":
                    sub_sport = field.value

            elif name == "file_id":
                if field.name == "manufacturer":
                    manufacturer = field.value
                elif field.name == "product":
                    product = field.value
                elif field.name == "type":
                    device_type = field.value

            elif name == "record":
                if field.name == "timestamp":
                    if start_time is None or field.value < start_time:
                        start_time = field.value
                    if end_time is None or field.value > end_time:
                        end_time = field.value

    print(f"File:         {os.path.basename(file_path)}")
    print(f"Size:         {os.path.getsize(file_path):,} bytes")
    print()
    print("FIT CONTENT")
    print("-----------")
    print(f"File type:    {device_type}")
    print(f"Manufacturer: {manufacturer}")
    print(f"Product:      {product}")
    print(f"Sport:        {sport}")
    print(f"Sub-sport:    {sub_sport}")

    if start_time:
        print(f"Start:        {format_timestamp(start_time)}")

    if end_time:
        print(f"End:          {format_timestamp(end_time)}")

    if start_time and end_time:
        print(f"Duration:     {end_time - start_time}")

    print()
    print("MESSAGES")
    print("--------")

    for name, count in sorted(messages.items()):
        print(f"{name:<20} {count}")

    print()
    print("FIELDS")
    print("------")

    for name in sorted(fields):
        print(f"{name}:")
        print(f"  {', '.join(sorted(fields[name]))}")


def parse_definition(
    data,
    offset,
    developer,
):
    if offset + 5 > len(data):
        raise ValueError("Invalid FIT definition")

    architecture = data[offset + 1]

    if architecture not in (0, 1):
        raise ValueError("Invalid FIT architecture")

    endian = "<" if architecture == 0 else ">"

    global_message = struct.unpack_from(
        endian + "H",
        data,
        offset + 2,
    )[0]

    field_count = data[offset + 4]
    position = offset + 5
    fields = []

    for _ in range(field_count):
        if position + 3 > len(data):
            raise ValueError("Invalid FIT field definition")

        fields.append(
            (
                data[position],
                data[position + 1],
                data[position + 2],
            )
        )

        position += 3

    developer_fields = []

    if developer:
        if position >= len(data):
            raise ValueError("Invalid FIT developer definition")

        developer_count = data[position]
        position += 1

        for _ in range(developer_count):
            if position + 3 > len(data):
                raise ValueError(
                    "Invalid FIT developer field"
                )

            developer_fields.append(
                (
                    data[position],
                    data[position + 1],
                    data[position + 2],
                )
            )

            position += 3

    return {
        "global_message": global_message,
        "architecture": architecture,
        "fields": fields,
        "developer_fields": developer_fields,
        "end": position,
    }


def data_size(definition):
    native = sum(
        size
        for _, size, _ in definition["fields"]
    )

    developer = sum(
        size
        for _, size, _ in definition["developer_fields"]
    )

    return native + developer


def patch_fit(file_path, sport=None, date=None):
    with open(file_path, "rb") as file:
        data = bytearray(file.read())

    if len(data) < 14:
        raise ValueError("File is too small to be FIT")

    header_size = data[0]

    if header_size < 12:
        raise ValueError("Invalid FIT header")

    if data[8:12] != b".FIT":
        raise ValueError("Not a FIT file")

    file_data_size = struct.unpack_from(
        "<I",
        data,
        4,
    )[0]

    data_start = header_size
    data_end = data_start + file_data_size

    if data_end + 2 > len(data):
        raise ValueError("Invalid FIT data size")

    sport_value = None

    if sport is not None:
        if sport not in SPORTS:
            valid = ", ".join(SPORTS)
            raise ValueError(
                f"Unsupported sport '{sport}'. "
                f"Valid values: {valid}"
            )

        sport_value = SPORTS[sport]

    date_value = (
        fit_timestamp(date)
        if date is not None
        else None
    )

    definitions = {}
    offset = data_start
    sport_changed = False
    date_changed = False

    while offset < data_end:
        header = data[offset]
        offset += 1

        compressed = bool(header & 0x80)

        if compressed:
            local_message = (header >> 5) & 0x03
        else:
            local_message = header & 0x0F

        if not compressed and (header & 0x40):
            developer = bool(header & 0x20)

            definition = parse_definition(
                data,
                offset,
                developer,
            )

            definitions[local_message] = definition
            offset = definition["end"]
            continue

        definition = definitions.get(local_message)

        if definition is None:
            raise ValueError(
                f"No definition for local message "
                f"{local_message}"
            )

        payload_start = offset
        payload_length = data_size(definition)
        payload_end = payload_start + payload_length

        if payload_end > data_end:
            raise ValueError(
                "FIT record exceeds data section"
            )

        if definition["global_message"] == GLOBAL_SESSION:
            position = payload_start

            endian = (
                "<"
                if definition["architecture"] == 0
                else ">"
            )

            for field_number, field_size, _ in (
                definition["fields"]
            ):
                if field_number == FIELD_SPORT:
                    if sport_value is not None:
                        if field_size != 1:
                            raise ValueError(
                                "Invalid session.sport field"
                            )

                        data[position] = sport_value
                        sport_changed = True

                elif field_number == FIELD_START_TIME:
                    if date_value is not None:
                        if field_size != 4:
                            raise ValueError(
                                "Invalid session.start_time field"
                            )

                        struct.pack_into(
                            endian + "I",
                            data,
                            position,
                            date_value,
                        )

                        date_changed = True

                position += field_size

        offset = payload_end

    if sport is not None and not sport_changed:
        raise ValueError(
            "session.sport was not found"
        )

    if date is not None and not date_changed:
        raise ValueError(
            "session.start_time was not found"
        )

    crc = fit_crc(data[:data_end])

    struct.pack_into(
        "<H",
        data,
        data_end,
        crc,
    )

    return bytes(data)


def write_fit(data, output):
    directory = os.path.dirname(
        os.path.abspath(output)
    )

    os.makedirs(
        directory,
        exist_ok=True,
    )

    with open(output, "wb") as file:
        file.write(data)

    if not os.path.isfile(output):
        raise OSError(
            f"Failed to create {output}"
        )


def upload_activity(file_path, api_key):
    url = f"{BASE_URL}/athlete/0/activities"

    with open(file_path, "rb") as file:
        response = requests.post(
            url,
            auth=("API_KEY", api_key),
            files={
                "file": (
                    os.path.basename(file_path),
                    file,
                    "application/octet-stream",
                )
            },
            timeout=60,
        )

    response.raise_for_status()
    return response.json()


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--file",
        required=True,
    )

    parser.add_argument(
        "--api-key",
        default=os.getenv("INTERVALS_API_KEY"),
    )

    parser.add_argument(
        "--sport",
    )

    parser.add_argument(
        "--date",
    )

    parser.add_argument(
        "--output",
    )

    args = parser.parse_args()

    try:
        has_modifications = bool(
            args.sport or args.date
        )

        if not args.api_key and not has_modifications:
            fit_summary(args.file)
            return

        upload_file = args.file

        if has_modifications:
            date = (
                parse_date(args.date)
                if args.date
                else None
            )

            modified = patch_fit(
                args.file,
                sport=args.sport,
                date=date,
            )

            output = args.output

            if output is None:
                base, extension = os.path.splitext(
                    args.file
                )
                output = (
                    f"{base}_modified{extension}"
                )

            write_fit(
                modified,
                output,
            )

            upload_file = output

            print(f"Modified: {output}")
            print(
                f"Size:     "
                f"{os.path.getsize(output):,} bytes"
            )

            if args.sport:
                print(f"Sport:    {args.sport}")

            if date:
                print(
                    f"Date:     "
                    f"{format_timestamp(date)}"
                )

        if args.api_key:
            result = upload_activity(
                upload_file,
                args.api_key,
            )

            print(
                f"Uploaded: "
                f"{result.get('id')}"
            )

    except (
        requests.RequestException,
        OSError,
        ValueError,
        KeyError,
    ) as error:
        sys.exit(f"Error: {error}")


if __name__ == "__main__":
    main()