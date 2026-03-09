"""Download ENC cells from NOAA."""

from __future__ import annotations

import subprocess
import zipfile
from pathlib import Path

# NOAA ENC download base URL
NOAA_ENC_BASE = "https://charts.noaa.gov/ENCs"


def download_enc_cell(
    cell_name: str,
    output_dir: Path,
) -> Path | None:
    """Download a single ENC cell zip from NOAA and extract it.

    The NOAA ENC download URL pattern is:
    https://charts.noaa.gov/ENCs/{cell_name}.zip

    Downloads to a temp file first to avoid partial zips on failure.
    Only searches the cell's own subdirectory to avoid race conditions
    with parallel downloads.

    Args:
        cell_name: ENC cell name (e.g., "US5MA22M").
        output_dir: Directory to extract into.

    Returns:
        Path to the extracted .000 file, or None on failure.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    zip_path = output_dir / f"{cell_name}.zip"
    tmp_path = output_dir / f"{cell_name}.zip.tmp"

    url = f"{NOAA_ENC_BASE}/{cell_name}.zip"
    print(f"Downloading {url} ...")

    result = subprocess.run(
        ["curl", "-fsSL", "-o", str(tmp_path), url],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"Download failed for {cell_name}: {result.stderr}")
        tmp_path.unlink(missing_ok=True)
        return None

    # Atomic rename from temp to final zip
    tmp_path.rename(zip_path)

    # Extract the zip
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for member in zf.namelist():
                target = (output_dir / member).resolve()
                if not target.is_relative_to(output_dir.resolve()):
                    raise zipfile.BadZipFile(
                        f"Zip member escapes target dir: {member}"
                    )
            zf.extractall(output_dir)
    except zipfile.BadZipFile:
        print(f"Bad zip file for {cell_name}")
        zip_path.unlink(missing_ok=True)
        return None

    zip_path.unlink(missing_ok=True)

    # Find the .000 file — search only for this cell's name to avoid
    # picking up files from other cells during parallel downloads.
    # NOAA zips may extract to {cell_name}/ or ENC_ROOT/{cell_name}/.
    enc_files = list(output_dir.rglob(f"{cell_name}/{cell_name}.000"))

    if enc_files:
        print(f"Extracted {enc_files[0]}")
        return enc_files[0]

    print(f"No .000 file found after extracting {cell_name}")
    return None
