#!/usr/bin/env python3
"""Compute unified coverage mask from per-region coverage GeoJSONs.

Each per-region file is world-minus-region-coverage. Their intersection
gives world-minus-union-of-all-coverage, which is the single mask we want.

Usage: python unify-coverage.py public/nautical-*.coverage.geojson -o public/nautical-unified.coverage.geojson
"""

import argparse
import json
import sys

from shapely.geometry import shape, mapping
from shapely import make_valid


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", help="Per-region coverage GeoJSON files")
    parser.add_argument("-o", "--output", required=True, help="Output unified coverage GeoJSON")
    args = parser.parse_args()

    result = None
    for path in args.inputs:
        with open(path) as f:
            data = json.load(f)
        # Each file has a single feature: the no-coverage polygon
        geom = shape(data["features"][0]["geometry"])
        geom = make_valid(geom)
        if result is None:
            result = geom
        else:
            result = make_valid(result.intersection(geom))

    if result is None:
        print("No input files", file=sys.stderr)
        sys.exit(1)

    output = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": mapping(result),
            }
        ],
    }
    with open(args.output, "w") as f:
        json.dump(output, f)
    print(f"Wrote unified coverage to {args.output}")


if __name__ == "__main__":
    main()
