"""Download ENC cells from NOAA, or Inland ENCs from the US Army Corps."""

from __future__ import annotations

import subprocess
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

from .inland import is_inland_cell

if TYPE_CHECKING:
    from .progress import PipelineProgress

# Download base URLs: NOAA's ENCs, and the Corps' Inland ENCs (U37…)
NOAA_ENC_BASE = "https://charts.noaa.gov/ENCs"
IENC_BASE = "https://ienccloud.us/ienc/products/files/u37/ienc_s57"


def cell_download_url(cell_name: str) -> str:
    """Where a cell's zip is published: NOAA, or the Corps for an Inland ENC."""
    base = IENC_BASE if is_inland_cell(cell_name) else NOAA_ENC_BASE
    return f"{base}/{cell_name}.zip"


def download_enc_cell(
    cell_name: str,
    output_dir: Path,
    progress: PipelineProgress | None = None,
) -> Path | None:
    """Download a single ENC cell zip (from cell_download_url) and extract it.

    Downloads to a temp file first to avoid partial zips on failure.
    Only searches the cell's own subdirectory to avoid race conditions
    with parallel downloads.

    Args:
        cell_name: ENC cell name (e.g., "US5MA22M").
        output_dir: Directory to extract into.
        progress: Optional progress reporter.

    Returns:
        Path to the extracted .000 file, or None on failure.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    zip_path = output_dir / f"{cell_name}.zip"
    tmp_path = output_dir / f"{cell_name}.zip.tmp"

    url = cell_download_url(cell_name)

    if progress:
        progress.download_cell_started(cell_name)
    else:
        print(f"Downloading {url} ...")

    result = subprocess.run(
        ["curl", "-fsSL", "-o", str(tmp_path), url],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        err = f"curl failed: {result.stderr.strip()}"
        if progress:
            progress.download_cell_error(cell_name, err)
        else:
            print(f"Download failed for {cell_name}: {result.stderr}")
        tmp_path.unlink(missing_ok=True)
        return None

    # Atomic rename from temp to final zip
    tmp_path.rename(zip_path)

    if progress:
        progress.download_cell_extracting(cell_name)

    # Remove stale update files (.001, .002, etc.) from previous editions.
    # GDAL's S-57 driver auto-applies update files in the same directory;
    # stale updates from a prior edition cause "not recognized as supported
    # file format" errors.
    for pattern in (f"{cell_name}/{cell_name}.*", f"ENC_ROOT/{cell_name}/{cell_name}.*"):
        for old_file in output_dir.glob(pattern):
            if old_file.suffix not in (".zip", ".zip.tmp"):
                old_file.unlink(missing_ok=True)

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
        err = "bad zip file"
        if progress:
            progress.download_cell_error(cell_name, err)
        else:
            print(f"Bad zip file for {cell_name}")
        zip_path.unlink(missing_ok=True)
        return None

    zip_path.unlink(missing_ok=True)

    # Find the .000 file — search only for this cell's name to avoid
    # picking up files from other cells during parallel downloads.
    # NOAA zips may extract to {cell_name}/ or ENC_ROOT/{cell_name}/.
    enc_files = list(output_dir.rglob(f"{cell_name}/{cell_name}.000"))

    if enc_files:
        if progress:
            progress.download_cell_done(cell_name)
        else:
            print(f"Extracted {enc_files[0]}")
        return enc_files[0]

    err = "no .000 file found after extraction"
    if progress:
        progress.download_cell_error(cell_name, err)
    else:
        print(f"No .000 file found after extracting {cell_name}")
    return None
