"""Inland ENC support: the US Army Corps of Engineers' river charts (IENCs).

Inland ENCs are S-57 cells written to the Inland ENC standard, which adds
river-specific object classes and attributes, each with a lowercase acronym.
GDAL's S-57 tables know the older Inland ENC classes but not those added in
Inland ENC 2.x; features of an unknown class arrive as a "Generic" layer
with every attribute dropped. `s57_tables_dir` supplies the missing
definitions (from the Inland ENC 2.x feature catalogue) alongside GDAL's own.

Most inland classes are river versions of standard S-57 ones — a lateral
beacon, a shoreline construction, a bridge — so `STANDARD_LAYER` folds them
into the standard layer, where the chart styles already draw them, and
`STANDARD_ATTRIBUTE` copies inland attributes onto their standard names.
"""

from __future__ import annotations

import csv
import subprocess
import tempfile
from functools import cache
from pathlib import Path

# Object classes GDAL lacks: code, name, acronym, attribute sets A/B/C,
# class, primitives (the columns of GDAL's s57objectclasses.csv).
INLAND_OBJECT_CLASSES: list[list[str]] = [
    [
        "17021",
        "Pontoon",
        "ponton",
        "SCAMIN;",
        "OBJNAM;NOBJNM;INFORM;NINFOM;PICREP;TXTDSC;DATSTA;DATEND;PERSTA;PEREND;",
        "unlocd;SORDAT;SORIND;",
        "G",
        "Area;",
    ],
    [
        "17028",
        "Beacon, lateral",
        "bcnlat",
        "BCNSHP;catlam;COLOUR;SCAMIN;",
        "OBJNAM;NOBJNM;INFORM;NINFOM;PICREP;TXTDSC;DATSTA;DATEND;PERSTA;PEREND;",
        "COLPAT;dirimp;SORDAT;SORIND;",
        "G",
        "Point;",
    ],
    [
        "17032",
        "Shoreline Construction",
        "slcons",
        "catslc;SCAMIN;",
        "NATCON;OBJNAM;NOBJNM;INFORM;NINFOM;PICREP;TXTDSC;DATSTA;DATEND;PERSTA;PEREND;",
        "watlev;SORDAT;SORIND;",
        "G",
        "Line;Area;",
    ],
    [
        "17067",
        "Waterway gauge",
        "wtwgag",
        "SCAMIN;",
        (
            "catgag;disipd;disipu;ELEVAT;higwat;hignam;lowwat;lownam;meawat;meanam;"
            "othwat;othnam;reflev;sdrlev;vcrlev;verdat;wtwdis;NOBJNM;INFORM;NINFOM;"
            "PICREP;TXTDSC;DATSTA;DATEND;PERSTA;PEREND;"
        ),
        "unlocd;hunits;OBJNAM;SORDAT;SORIND;",
        "G",
        "Point;Area;",
    ],
]

# Attributes GDAL lacks: code, name, acronym, type, class (the columns of
# GDAL's s57attributes.csv).
INLAND_ATTRIBUTES: list[list[str]] = [
    ["17011", "Category of lateral mark", "catlam", "E", "F"],
    ["17012", "Category of shoreline construction", "catslc", "E", "F"],
    ["17078", "Category of waterway gauge", "catgag", "L", "F"],
    ["17080", "Value at relevant high water level", "higwat", "F", "F"],
    ["17081", "Name of relevant high water level", "hignam", "S", "F"],
    ["17082", "Value at relevant low water level", "lowwat", "F", "F"],
    ["17083", "Name of relevant low water level", "lownam", "S", "F"],
    ["17084", "Value at relevant mean water level", "meawat", "F", "F"],
    ["17085", "Name of relevant mean water level", "meanam", "S", "F"],
    ["17086", "Value at other locally relevant water level", "othwat", "F", "F"],
    ["17087", "Name of other locally relevant water level", "othnam", "S", "F"],
    ["17088", "Reference gravitational level", "reflev", "E", "F"],
    ["17089", "Name of Sounding datum reference level", "sdrlev", "S", "F"],
    ["17090", "Name of vertical river datum reference level", "vcrlev", "S", "F"],
    ["17103", "Height/length units", "hunits", "E", "F"],
    ["17104", "Water level effect", "watlev", "E", "F"],
]

# Inland layers drawn as the standard layer they are the river version of.
STANDARD_LAYER: dict[str, str] = {
    "bcnlat": "BCNLAT",
    "bridge": "BRIDGE",
    "cblohd": "CBLOHD",
    "dismar": "DISMAR",
    "lokbsn": "LOKBSN",
    "m_nsys": "M_NSYS",
    "ponton": "PONTON",
    "resare": "RESARE",
    "sistat": "SISTAT",
    "slcons": "SLCONS",
}

# Inland attributes whose values mean what the standard attribute's do.
STANDARD_ATTRIBUTE: dict[str, str] = {
    "catbrg": "CATBRG",
    "catlam": "CATLAM",
    "catslc": "CATSLC",
    "hunits": "HUNITS",
    "watlev": "WATLEV",
}


def is_inland_cell(cell_name: str) -> bool:
    """Inland ENC cells are named U37…, e.g. U37UM723 (Upper Mississippi)."""
    return cell_name.startswith("U37")


@cache
def s57_tables_dir() -> Path:
    """A directory of S-57 tables for GDAL's S57_CSV: GDAL's own, plus the
    inland definitions it lacks. Built once per process."""
    gdal_data = Path(
        subprocess.run(
            ["gdal-config", "--datadir"], capture_output=True, text=True, check=True
        ).stdout.strip()
    )
    out = Path(tempfile.mkdtemp(prefix="s57-tables-"))
    for name, extra in (
        ("s57objectclasses.csv", INLAND_OBJECT_CLASSES),
        ("s57attributes.csv", INLAND_ATTRIBUTES),
    ):
        text = (gdal_data / name).read_text(encoding="latin-1")
        known = {row[0] for row in csv.reader(text.splitlines()) if row}
        with open(out / name, "w", encoding="latin-1", newline="") as f:
            f.write(text if text.endswith("\n") else text + "\n")
            writer = csv.writer(f, lineterminator="\n")
            writer.writerows(row for row in extra if row[0] not in known)
    for name in ("s57agencies.csv", "s57expectedinput.csv"):
        (out / name).write_bytes((gdal_data / name).read_bytes())
    return out


def standardize_attributes(props: dict[str, object]) -> None:
    """Copy inland attributes onto their standard names, where unset."""
    for inland, standard in STANDARD_ATTRIBUTE.items():
        if props.get(standard) is None and props.get(inland) is not None:
            props[standard] = props[inland]
