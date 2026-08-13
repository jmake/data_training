#!/usr/bin/env python3

import argparse
import os
import sys

import requests


BASE_URL = "https://intervals.icu/api/v1"


def upload_activity(file_path, api_key):
    if not os.path.isfile(file_path):
        raise FileNotFoundError(file_path)

    url = f"{BASE_URL}/athlete/0/activities"

    with open(file_path, "rb") as file:
        response = requests.post(
            url,
            auth=("API_KEY", api_key),
            files={"file": (os.path.basename(file_path), file)},
        )

    response.raise_for_status()
    return response.json()


def update_activity(activity_id, sport, date, api_key):
    url = f"{BASE_URL}/activity/{activity_id}"

    response = requests.put(
        url,
        auth=("API_KEY", api_key),
        json={
            "type": sport,
            "start_date_local": date,
        },
    )

    response.raise_for_status()
    return response.json()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--api-key", default=os.getenv("INTERVALS_API_KEY"))
    parser.add_argument("--sport", required=True)
    parser.add_argument("--date", required=True)

    args = parser.parse_args()

    if not args.api_key:
        sys.exit("Missing API key.")

    try:
        upload = upload_activity(args.file, args.api_key)
        activity_id = upload["id"]

        print(f"Uploaded: {activity_id}")

        activity = update_activity(
            activity_id,
            args.sport,
            args.date,
            args.api_key,
        )

        print(f"Activity: {activity['id']}")
        print(f"Sport:    {activity.get('type')}")
        print(f"Date:     {activity.get('start_date_local')}")

    except (requests.RequestException, OSError, KeyError) as error:
        sys.exit(f"Error: {error}")


if __name__ == "__main__":
    main()