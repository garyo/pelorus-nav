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

    Args:
        cell_name: ENC cell name (e.g., "US5MA22M").
        output_dir: Directory to extract into.

    Returns:
        Path to the extracted .000 file, or None on failure.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    zip_path = output_dir / f"{cell_name}.zip"

    url = f"{NOAA_ENC_BASE}/{cell_name}.zip"
    print(f"Downloading {url} ...")

    result = subprocess.run(
        ["curl", "-fsSL", "-o", str(zip_path), url],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"Download failed for {cell_name}: {result.stderr}")
        return None

    # Extract the zip
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(output_dir)
    except zipfile.BadZipFile:
        print(f"Bad zip file for {cell_name}")
        zip_path.unlink(missing_ok=True)
        return None

    zip_path.unlink(missing_ok=True)

    # Find the .000 file (may be in a subdirectory)
    enc_files = list(output_dir.rglob(f"{cell_name}/*.000"))
    if not enc_files:
        # Try without subdirectory
        enc_files = list(output_dir.rglob("*.000"))

    if enc_files:
        print(f"Extracted {enc_files[0]}")
        return enc_files[0]

    print(f"No .000 file found after extracting {cell_name}")
    return None


# Test cells at different scale bands covering Boston Harbor
TEST_CELLS: dict[str, str] = {
    "US2EC04M": "Band 2 (general) — East Coast overview",
    "US4MA13M": "Band 4 (approach) — Massachusetts Bay / Boston",
    "US5MA10M": "Band 5 (harbor) — Boston Harbor",
    "US5MA11M": "Band 5 (harbor) — Inner Boston Harbor (1:10k)",
}
