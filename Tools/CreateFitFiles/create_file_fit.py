"""
Minimal .FIT file writer built from scratch (no FIT SDK dependency for writing).
Supports: file_id message + record messages (timestamp, heart_rate).
Validation of the produced file is done separately using the `fitparse` library.
"""

import struct
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone


def ensure_package(package_name, import_name=None):
    import_name = import_name or package_name
    try:
        __import__(import_name)
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package_name])


ensure_package("fitparse")
import fitparse

FIT_EPOCH = datetime(1989, 12, 31, tzinfo=timezone.utc)

# Standard FIT CRC-16 lookup table (from Garmin FIT SDK spec)
CRC_TABLE = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
]


def crc16_update(crc, byte):
    tmp = CRC_TABLE[crc & 0xF]
    crc = (crc >> 4) & 0x0FFF
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xF]

    tmp = CRC_TABLE[crc & 0xF]
    crc = (crc >> 4) & 0x0FFF
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xF]
    return crc


def fit_crc(data: bytes) -> int:
    crc = 0
    for b in data:
        crc = crc16_update(crc, b)
    return crc


class FitFileWriter:
    """Builds a .FIT file from scratch: header, definition/data records, CRC."""

    # base type: (base_type_byte, size_in_bytes, struct_fmt)
    BASE_TYPES = {
        "uint8": (0x02, 1, "B"),
        "uint16": (0x84, 2, "<H"),
        "uint32": (0x86, 4, "<I"),
        "enum": (0x00, 1, "B"),
    }

    def __init__(self):
        self._records = bytearray()
        self._local_defs = {}  # name -> (local_msg_type, field_order)
        self._next_local_type = 0

    def define_message(self, name, global_mesg_num, fields):
        """
        fields: list of (field_def_num, field_name, base_type_str)
        Writes a Definition Message and registers the layout under `name`.
        """
        local_type = self._next_local_type
        self._next_local_type += 1
        self._local_defs[name] = (local_type, fields)

        header = 0x40 | (local_type & 0x0F)  # bit6 set = definition message
        rec = bytearray()
        rec.append(header)
        rec.append(0)  # reserved
        rec.append(0)  # architecture: 0 = little endian
        rec += struct.pack("<H", global_mesg_num)
        rec.append(len(fields))
        for field_def_num, _fname, base_type_str in fields:
            base_type_byte, size, _fmt = self.BASE_TYPES[base_type_str]
            rec.append(field_def_num)
            rec.append(size)
            rec.append(base_type_byte)

        self._records += rec

    def write_data(self, name, values: dict):
        """values: dict field_name -> python value, per fields registered in define_message."""
        local_type, fields = self._local_defs[name]
        header = local_type & 0x0F  # bit6=0 = data message
        rec = bytearray()
        rec.append(header)
        for _field_def_num, fname, base_type_str in fields:
            _base_type_byte, _size, fmt = self.BASE_TYPES[base_type_str]
            rec += struct.pack(fmt, values[fname])
        self._records += rec

    def save(self, path):
        data_size = len(self._records)
        header = bytearray()
        header.append(12)          # header size
        header.append(0x10)        # protocol version
        header += struct.pack("<H", 100)  # profile version
        header += struct.pack("<I", data_size)
        header += b".FIT"

        body = bytes(header) + bytes(self._records)
        crc = fit_crc(body)

        with open(path, "wb") as f:
            f.write(body)
            f.write(struct.pack("<H", crc))


def fit_timestamp(dt: datetime) -> int:
    return int((dt - FIT_EPOCH).total_seconds())


def build_ramp_hr_fit(path, waypoints=None):
    """Piecewise-linear HR ramp, 1s sampling, built from waypoints [(t0,hr0), (t1,hr1), ...]."""
    if waypoints is None:
        waypoints = [(0, 50), (30, 60), (60, 135), (120, 150), (180, 100)]

    samples = []
    for i in range(len(waypoints) - 1):
        t0, hr0 = waypoints[i]
        t1, hr1 = waypoints[i + 1]
        for t in range(t0, t1):
            frac = (t - t0) / (t1 - t0)
            hr = round(hr0 + frac * (hr1 - hr0))
            samples.append((t, hr))
    samples.append(waypoints[-1])

    write_fit_from_samples(samples, path)
    return samples


def write_fit_from_samples(samples, path):
    """samples: list of (t_seconds_from_start, heart_rate) -> writes a .fit file."""
    writer = FitFileWriter()

    writer.define_message(
        "file_id", 0,
        [(0, "type", "enum"), (1, "manufacturer", "uint16"), (4, "time_created", "uint32")],
    )
    start_dt = datetime.now(timezone.utc)
    writer.write_data("file_id", {
        "type": 4,               # activity
        "manufacturer": 255,     # development
        "time_created": fit_timestamp(start_dt),
    })

    writer.define_message(
        "record", 20,
        [(253, "timestamp", "uint32"), (3, "heart_rate", "uint8")],
    )
    for t, hr in samples:
        writer.write_data("record", {
            "timestamp": fit_timestamp(start_dt) + t,
            "heart_rate": hr,
        })

    writer.save(path)


def read_time_hr_csv(path):
    """Reads a comma-separated file with time,hr columns (header optional).
    Returns a list of (time_seconds:int, hr:int) validated samples."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Input file not found: {path}")

    lines = [line.strip() for line in path.read_text().splitlines() if line.strip()]
    if not lines:
        raise ValueError(f"Input file is empty: {path}")

    samples = []
    for i, line in enumerate(lines):
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2:
            raise ValueError(f"Line {i + 1}: expected at least 2 comma-separated columns, got {len(parts)}")
        try:
            t = int(float(parts[0]))
            hr = int(float(parts[1]))
        except ValueError:
            if i == 0:
                continue  # header row, skip
            raise ValueError(f"Line {i + 1}: non-numeric time/hr value ({parts[0]}, {parts[1]})")

        if t < 0:
            raise ValueError(f"Line {i + 1}: negative time value ({t})")
        if not (0 <= hr <= 255):
            raise ValueError(f"Line {i + 1}: heart_rate out of uint8 range 0-255 ({hr})")

        samples.append((t, hr))

    if not samples:
        raise ValueError(f"No valid data rows found in: {path}")

    samples.sort(key=lambda s: s[0])
    return samples


def print_hr_stats(samples):
    hr_values = [hr for _t, hr in samples]
    t_values = [t for t, _hr in samples]
    print(f"Time range: {t_values[0]}s - {t_values[-1]}s ({t_values[-1] - t_values[0]}s total)")
    print(f"HR average: {sum(hr_values) / len(hr_values):.1f}")
    print(f"HR min: {min(hr_values)}")
    print(f"HR max: {max(hr_values)}")


def validate_fit(path, expected_samples):
    """Reads the .fit file back with fitparse and checks it against expected (t, hr) samples.
    fitparse verifies the CRC internally when parsing; raises if invalid."""
    f = fitparse.FitFile(str(path))
    recs = list(f.get_messages("record"))

    assert len(recs) == len(expected_samples), (
        f"record count mismatch: got {len(recs)}, expected {len(expected_samples)}"
    )

    base_ts = recs[0].get_value("timestamp")
    for rec, (t_expected, hr_expected) in zip(recs, expected_samples):
        t_actual = int((rec.get_value("timestamp") - base_ts).total_seconds())
        hr_actual = rec.get_value("heart_rate")
        assert t_actual == t_expected, f"timestamp mismatch: got {t_actual}, expected {t_expected}"
        assert hr_actual == hr_expected, (
            f"hr mismatch at t={t_expected}: got {hr_actual}, expected {hr_expected}"
        )

    file_id = list(f.get_messages("file_id"))[0]
    assert file_id.get_value("type") == "activity"

    print(f"VALIDATION OK: {len(recs)} records read back, CRC valid, all timestamps/HR match.")

    print_hr_stats(expected_samples)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Write time,hr data to a .fit file.")
    parser.add_argument("--file", help="Input .txt/.csv file with time,hr columns (comma-separated).")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent

    if args.file:
        input_path = Path(args.file)
        samples = read_time_hr_csv(input_path)
        out_path = (input_path if input_path.is_absolute() else script_dir / input_path).with_suffix(".fit")

        write_fit_from_samples(samples, out_path)
        print(f"Wrote {len(samples)} records to {out_path}")

        validate_fit(out_path, samples)
    else:
        out_path = script_dir / "ramp_hr.fit"
        samples = build_ramp_hr_fit(out_path)
        print(f"Wrote {len(samples)} records to {out_path}")

        validate_fit(out_path, samples)