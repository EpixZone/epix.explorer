#!/usr/bin/env python3
"""Refresh the bundled Epix operator index from a pinned public registry revision.

This index is an offline discovery fallback. The browser rechecks a selected
entry against the live registry before offering a new authorization.
"""
import argparse
import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import urllib.request


def download(url, limit):
    request = urllib.request.Request(url, headers={"User-Agent": "Epix-Explorer-registry"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Registry download exceeds size limit")
    return data


def valid_address(value, prefix):
    alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    if not isinstance(value, str) or value != value.lower() or not value.startswith(prefix + "1"):
        return False
    data = value[len(prefix) + 1:]
    if len(data) != 38 or any(char not in alphabet for char in data):
        return False
    values = [ord(char) >> 5 for char in prefix] + [0] + [ord(char) & 31 for char in prefix]
    values += [alphabet.index(char) for char in data]
    check = 1
    generators = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    for value in values:
        top = check >> 25
        check = ((check & 0x1FFFFFF) << 5) ^ value
        for index, generator in enumerate(generators):
            if (top >> index) & 1:
                check ^= generator
    return check == 1


def snapshot(archive, revision):
    records = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar:
            parts = member.name.split("/")
            if len(parts) != 3 or parts[2] not in ("chains.json", "profile.json") or not member.isfile():
                continue
            if not re.fullmatch(r"[A-Za-z0-9_.-]+", parts[1]):
                continue
            if member.size > 1024 * 1024:
                raise ValueError("Oversized registry entry")
            stream = tar.extractfile(member)
            if stream is None:
                raise ValueError("Missing registry entry")
            records[(parts[1], parts[2])] = json.load(stream)
    entries, seen = [], set()
    for (directory, filename), document in sorted(records.items()):
        if filename != "chains.json":
            continue
        for chain in document.get("chains", []):
            if chain.get("name") != "epix" or not chain.get("restake"):
                continue
            bot = chain["restake"]
            if not valid_address(chain.get("address"), "epixvaloper") or not valid_address(bot.get("address"), "epix"):
                raise ValueError("Invalid Epix address in " + directory)
            threshold = bot.get("minimum_reward")
            if isinstance(threshold, bool) or not isinstance(threshold, (str, int)) or not re.fullmatch(r"\d+", str(threshold)):
                raise ValueError("Invalid exact minimum_reward in " + directory)
            if chain["address"] in seen:
                raise ValueError("Duplicate validator in registry")
            seen.add(chain["address"])
            bot["minimum_reward"] = str(threshold)
            profile = records.get((directory, "profile.json"), {})
            entries.append({"name": profile.get("name", directory), "path": directory + "/chains.json", "chain": chain})
    if not entries:
        raise ValueError("Registry contains no Epix operators")
    return {
        "repository": "https://github.com/eco-stake/validator-registry",
        "revision": revision,
        "archiveSha256": hashlib.sha256(archive).hexdigest(),
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "entries": entries,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="Full reviewed validator-registry Git commit")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public/autocompound/operators.json")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.revision):
        parser.error("--revision must be a full Git commit")
    data = download("https://codeload.github.com/eco-stake/validator-registry/tar.gz/" + args.revision, 32 * 1024 * 1024)
    result = snapshot(data, args.revision)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(str(len(result["entries"])) + " Epix operator entries at " + args.revision)


if __name__ == "__main__":
    main()
