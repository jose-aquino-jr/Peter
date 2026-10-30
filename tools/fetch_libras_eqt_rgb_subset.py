#!/usr/bin/env python3
"""Fetch only selected LIBRAS-EQT-UECE RGB videos using ZIP byte ranges."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import struct
import urllib.request
import zlib
from pathlib import Path
from typing import Any

DATASET_URL = (
    "https://zenodo.org/records/21398895/files/"
    "Libras-EQT-UECE%20(RGB).zip?download=1"
)
DATASET_ROOT = "Libras-EQT-UECE (RGB)"
LICENSE = "CC BY-NC 4.0"
CLASS_IDS = {"SIM": "2", "CAIR": "100", "LUZ": "115", "JA": "146"}
SPLITS = {
    "train": ("INFORMANTE 1", "INFORMANTE 2", "INFORMANTE 3"),
    "validation": ("INFORMANTE 4",),
    "test": ("INFORMANTE 5",),
}


def range_request(url: str, start: int, end: int) -> bytes:
    request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_range = response.headers.get("Content-Range", "")
        if response.status != 206 or not content_range.startswith(f"bytes {start}-{end}/"):
            raise RuntimeError(f"Servidor não honrou Range bytes={start}-{end}: {content_range}")
        return response.read()


def zip_central_directory(url: str) -> tuple[int, list[dict[str, Any]]]:
    head = urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30)
    file_size = int(head.headers["Content-Length"])
    tail_start = max(0, file_size - 65_536)
    tail = range_request(url, tail_start, file_size - 1)
    eocd = tail.rfind(b"PK\x05\x06")
    locator = tail.rfind(b"PK\x06\x07", 0, eocd)
    if eocd < 0 or locator < 0:
        raise RuntimeError("ZIP64 End of Central Directory não encontrado.")
    zip64_offset = struct.unpack_from("<4sLQL", tail, locator)[2]
    zip64 = range_request(url, zip64_offset, zip64_offset + 55)
    fields = struct.unpack_from("<4sQ2H2L4Q", zip64)
    entry_count, directory_size, directory_offset = fields[-3:]
    directory = range_request(
        url,
        directory_offset,
        directory_offset + directory_size - 1,
    )

    entries: list[dict[str, Any]] = []
    offset = 0
    while offset < len(directory) and directory[offset : offset + 4] == b"PK\x01\x02":
        fields = struct.unpack_from("<4s6H3L5H2L", directory, offset)
        flags, method = fields[2], fields[4]
        compressed_size, uncompressed_size = fields[8], fields[9]
        filename_length, extra_length, comment_length = fields[10:13]
        local_offset = fields[16]
        filename = directory[offset + 46 : offset + 46 + filename_length]
        name = filename.decode("utf-8" if flags & 0x800 else "cp437")
        extra_start = offset + 46 + filename_length
        extra = directory[extra_start : extra_start + extra_length]
        entry = {
            "name": name,
            "method": method,
            "compressedSize": compressed_size,
            "uncompressedSize": uncompressed_size,
            "localOffset": local_offset,
            "crc32": fields[7],
        }
        entry = apply_zip64_sizes(entry, extra)
        entries.append(entry)
        offset += 46 + filename_length + extra_length + comment_length
    if len(entries) != entry_count:
        raise RuntimeError(f"Central directory truncado: {len(entries)} de {entry_count}.")
    return file_size, entries


def apply_zip64_sizes(entry: dict[str, Any], extra: bytes) -> dict[str, Any]:
    offset = 0
    while offset + 4 <= len(extra):
        tag, size = struct.unpack_from("<HH", extra, offset)
        payload = extra[offset + 4 : offset + 4 + size]
        if tag == 0x0001:
            cursor = 0
            if entry["uncompressedSize"] == 0xFFFFFFFF:
                entry["uncompressedSize"] = struct.unpack_from("<Q", payload, cursor)[0]
                cursor += 8
            if entry["compressedSize"] == 0xFFFFFFFF:
                entry["compressedSize"] = struct.unpack_from("<Q", payload, cursor)[0]
                cursor += 8
            if entry["localOffset"] == 0xFFFFFFFF:
                entry["localOffset"] = struct.unpack_from("<Q", payload, cursor)[0]
        offset += 4 + size
    return entry


def sample_entries(entries: list[dict[str, Any]]) -> list[dict[str, str]]:
    selected: list[dict[str, str]] = []
    for split, informants in SPLITS.items():
        glosses = ("SIM",) if split == "train" else tuple(CLASS_IDS)
        for gloss in glosses:
            prefix = f"{DATASET_ROOT}/"
            class_id = CLASS_IDS[gloss]
            for informant in informants:
                candidates = sorted(
                    (
                        entry
                        for entry in entries
                        if entry["name"].startswith(prefix)
                        and entry["name"].split("/")[1].startswith(f"{class_id}_")
                        and entry["name"].split("/")[-2] == informant
                        and entry["name"].lower().endswith(".mp4")
                    ),
                    key=lambda entry: entry["name"],
                )
                if len(candidates) != 6:
                    raise RuntimeError(
                        f"{split}/{gloss}/{informant}: esperadas 6 gravações, "
                        f"encontradas {len(candidates)}."
                    )
                for entry in candidates:
                    filename = Path(entry["name"]).name
                    stem = re.sub(r"[^A-Za-z0-9_.-]", "-", Path(filename).stem)
                    selected.append(
                        {
                            "fileName": f"{split}__{gloss}__{informant.replace(' ', '-')}"
                            f"__{stem}.mp4",
                            "split": split,
                            "gloss": gloss,
                            "informant": informant,
                            "sourceEntry": entry["name"],
                            "entryKey": entry["name"],
                        }
                    )
    return selected


def extract_entry(url: str, entry: dict[str, Any], output: Path, file_size: int) -> None:
    local_offset = entry["localOffset"]
    range_end = min(
        file_size - 1,
        local_offset + 30 + (2 * 65_535) + entry["compressedSize"] - 1,
    )
    payload = range_request(url, local_offset, range_end)
    header = payload[:30]
    if header[:4] != b"PK\x03\x04":
        raise RuntimeError(f"{entry['name']}: cabeçalho ZIP local inválido.")
    filename_length, extra_length = struct.unpack_from("<HH", header, 26)
    data_start = 30 + filename_length + extra_length
    compressed = payload[data_start : data_start + entry["compressedSize"]]
    if entry["method"] == 0:
        content = compressed
    elif entry["method"] == 8:
        content = zlib.decompress(compressed, -15)
    else:
        raise RuntimeError(f"{entry['name']}: método ZIP não suportado: {entry['method']}.")
    if (
        len(content) != entry["uncompressedSize"]
        or zlib.crc32(content) & 0xFFFFFFFF != entry["crc32"]
    ):
        raise RuntimeError(f"{entry['name']}: checksum/tamanho inválido após extração.")
    output.write_bytes(content)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    file_size, entries = zip_central_directory(DATASET_URL)
    by_name = {entry["name"]: entry for entry in entries}
    samples = sample_entries(entries)
    manifest_samples = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        jobs = []
        for sample in samples:
            output = args.output_dir / sample["fileName"]
            jobs.append(
                executor.submit(
                    extract_entry,
                    DATASET_URL,
                    by_name[sample["entryKey"]],
                    output,
                    file_size,
                )
            )
            manifest_samples.append({key: value for key, value in sample.items() if key != "entryKey"})
        for job in jobs:
            job.result()

    manifest = {
        "sourceDataset": "LIBRAS-EQT-UECE",
        "sourceRecord": "https://zenodo.org/records/21398895",
        "sourceDoi": "10.5281/zenodo.21398895",
        "sourceLicense": LICENSE,
        "attribution": "LIBRAS-EQT-UECE Authors (2026)",
        "splitPolicy": {
            "train": "INFORMANTE 1-3; somente exemplos SIM",
            "validation": "INFORMANTE 4; positivos SIM e negativos CAIR/LUZ/JA",
            "test": "INFORMANTE 5; positivos SIM e negativos CAIR/LUZ/JA",
            "limitation": "Os identificadores de informante são locais por item; não garantem pessoas fisicamente disjuntas entre sinais.",
        },
        "samples": manifest_samples,
    }
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Extraídos {len(samples)} vídeos de referência em {args.output_dir}")
    print("O arquivo bruto foi gravado somente no diretório temporário solicitado.")


if __name__ == "__main__":
    main()
