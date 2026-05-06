#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "matplotlib"]
# ///
"""
Standalone RTS (Rauch-Tung-Striebel) smoother experiment for Pelorus Nav
GPX tracks. Forward Kalman pass with the same constant-velocity model the
JS GPSFilter uses, then a backward pass that combines forward+backward
estimates. Plots the original samples (coloured by Δt to the previous
fix) with the smoothed trajectory overlaid, plus a residuals subplot
showing how far each smoothed point moved from its raw position.

Usage:
    ./smooth_track.py [path-to.gpx]

Outputs /tmp/rts-comparison.png.
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection

# Defaults mirrored from src/navigation/GPSFilter.ts
M_PER_DEG = 111_111.0
DEFAULT_ACCURACY_M = 10.0
PROCESS_NOISE_ACCEL = 5e-6   # deg/s² — same constant-velocity process noise
MIN_ACCURACY_M = 3.0
MIN_ACCURACY_BAD_M = 20.0

NS = {"gpx": "http://www.topografix.com/GPX/1/1"}


def parse_gpx(path: Path) -> list[dict]:
    root = ET.parse(path).getroot()
    pts: list[dict] = []
    for trk in root.findall("gpx:trk", NS):
        for seg in trk.findall("gpx:trkseg", NS):
            for trkpt in seg.findall("gpx:trkpt", NS):
                t_el = trkpt.find("gpx:time", NS)
                if t_el is None or t_el.text is None:
                    continue
                pts.append({
                    "lat": float(trkpt.attrib["lat"]),
                    "lon": float(trkpt.attrib["lon"]),
                    "time": datetime.fromisoformat(
                        t_el.text.replace("Z", "+00:00")
                    ),
                })
    return pts


def kalman_forward(points: list[dict], accuracy_m: float = DEFAULT_ACCURACY_M):
    """Forward Kalman pass. Returns
        states[k]    = filtered  x_{k|k}
        covs[k]      = filtered  P_{k|k}
        pred_states  = predicted x_{k+1|k}     (length N-1, indexed by k+1)
        pred_covs    = predicted P_{k+1|k}
        Fs           = state-transition matrices (length N-1)
    State vector: [lat, lon, vLat, vLon] in degrees and degrees/sec.
    """
    n = len(points)
    x = np.array([points[0]["lat"], points[0]["lon"], 0.0, 0.0])
    # Same initial uncertainty as GPSFilter.initState
    P = np.diag([
        (100.0 / M_PER_DEG) ** 2,
        (100.0 / M_PER_DEG) ** 2,
        (5.0 / (M_PER_DEG * 3600.0 / 1852.0)) ** 2,  # ~5 kn in deg/s
        (5.0 / (M_PER_DEG * 3600.0 / 1852.0)) ** 2,
    ])
    states = [x.copy()]
    covs = [P.copy()]
    pred_states: list[np.ndarray] = [x.copy()]   # placeholder for k=0
    pred_covs: list[np.ndarray] = [P.copy()]
    Fs: list[np.ndarray] = [np.eye(4)]

    q = PROCESS_NOISE_ACCEL ** 2

    for k in range(1, n):
        dt = (points[k]["time"] - points[k - 1]["time"]).total_seconds()
        if dt <= 0:
            dt = 1.0   # safety; matches filter's negative-dt guard

        F = np.array([
            [1.0, 0.0, dt, 0.0],
            [0.0, 1.0, 0.0, dt],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ])
        x_pred = F @ x
        Q = q * np.array([
            [dt ** 3 / 3.0, 0.0,           dt ** 2 / 2.0, 0.0],
            [0.0,           dt ** 3 / 3.0, 0.0,           dt ** 2 / 2.0],
            [dt ** 2 / 2.0, 0.0,           dt,            0.0],
            [0.0,           dt ** 2 / 2.0, 0.0,           dt],
        ])
        P_pred = F @ P @ F.T + Q

        cos_lat = np.cos(np.radians(points[k]["lat"]))
        a = max(MIN_ACCURACY_M, accuracy_m)
        r_lat = (a / M_PER_DEG) ** 2
        r_lon = (a / (M_PER_DEG * cos_lat)) ** 2
        R = np.diag([r_lat, r_lon])
        H = np.array([[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]])

        z = np.array([points[k]["lat"], points[k]["lon"]])
        innov = z - H @ x_pred
        S = H @ P_pred @ H.T + R
        K = P_pred @ H.T @ np.linalg.inv(S)
        x = x_pred + K @ innov
        P = (np.eye(4) - K @ H) @ P_pred

        states.append(x.copy())
        covs.append(P.copy())
        pred_states.append(x_pred.copy())
        pred_covs.append(P_pred.copy())
        Fs.append(F)

    return states, covs, pred_states, pred_covs, Fs


def rts_smooth(states, covs, pred_states, pred_covs, Fs):
    """Backward Rauch-Tung-Striebel pass over the forward results."""
    n = len(states)
    sm_x = [None] * n
    sm_P = [None] * n
    sm_x[-1] = states[-1].copy()
    sm_P[-1] = covs[-1].copy()
    for k in range(n - 2, -1, -1):
        # C_k = P_{k|k} F_{k+1}^T (P_{k+1|k})^-1
        C = covs[k] @ Fs[k + 1].T @ np.linalg.inv(pred_covs[k + 1])
        sm_x[k] = states[k] + C @ (sm_x[k + 1] - pred_states[k + 1])
        sm_P[k] = covs[k] + C @ (sm_P[k + 1] - pred_covs[k + 1]) @ C.T
    return sm_x, sm_P


def project_to_metres(lats: np.ndarray, lons: np.ndarray):
    """Local-tangent-plane projection so the plot is metric."""
    lat0 = np.mean(lats)
    lon0 = np.mean(lons)
    cos_lat = np.cos(np.radians(lat0))
    x = (lons - lon0) * M_PER_DEG * cos_lat
    y = (lats - lat0) * M_PER_DEG
    return x, y


def smooth_once(pts):
    """Forward Kalman + RTS, returns smoothed lat/lon arrays + per-point
    shift in metres (distance raw → smoothed)."""
    states, covs, pred_states, pred_covs, Fs = kalman_forward(pts)
    sm_states, _ = rts_smooth(states, covs, pred_states, pred_covs, Fs)
    raw_lat = np.array([p["lat"] for p in pts])
    raw_lon = np.array([p["lon"] for p in pts])
    sm_lat = np.array([s[0] for s in sm_states])
    sm_lon = np.array([s[1] for s in sm_states])
    cos_lat = np.cos(np.radians(raw_lat))
    dx = (sm_lon - raw_lon) * M_PER_DEG * cos_lat
    dy = (sm_lat - raw_lat) * M_PER_DEG
    shifts = np.hypot(dx, dy)
    return sm_lat, sm_lon, shifts


def flag_outliers(shifts: np.ndarray, floor_m: float = 20.0,
                  k_mad: float = 8.0) -> tuple[np.ndarray, float]:
    """Robust outlier flag using MAD on the smoother-shift distribution.
    Threshold = max(floor, median + k · 1.4826 · MAD).

    The floor (20 m) catches lone spikes in low-noise tracks where the
    MAD-based term is tiny. The MAD-based term widens the threshold on
    inherently noisier tracks (faster vehicle motion, weaker GPS) so we
    don't flag run-of-the-mill tail samples. k=8 ≈ 5.4σ for normal data
    — well past where real GPS jitter sits, so false-positive rate stays
    near zero across the tracks we've tested."""
    median = float(np.median(shifts))
    mad = float(np.median(np.abs(shifts - median)))
    sigma_est = 1.4826 * mad
    threshold = max(floor_m, median + k_mad * sigma_est)
    return shifts > threshold, threshold


def main(path: Path):
    pts = parse_gpx(path)
    if not pts:
        print(f"No track points found in {path}", file=sys.stderr)
        sys.exit(1)
    print(f"Loaded {len(pts)} points from {path.name}")

    # First pass: smooth everything, then flag outliers from the shift dist.
    sm_lat1, sm_lon1, shifts1 = smooth_once(pts)
    is_outlier, threshold = flag_outliers(shifts1)
    n_flagged = int(np.sum(is_outlier))

    # Second pass: drop flagged points, re-run smoother on the survivors.
    kept = [p for p, bad in zip(pts, is_outlier) if not bad]
    sm_lat2, sm_lon2, shifts2 = smooth_once(kept)

    raw_lat = np.array([p["lat"] for p in pts])
    raw_lon = np.array([p["lon"] for p in pts])
    sm_lat = sm_lat1
    sm_lon = sm_lon1

    # Δt to previous fix (s)
    dts = np.zeros(len(pts))
    for k in range(1, len(pts)):
        dts[k] = (pts[k]["time"] - pts[k - 1]["time"]).total_seconds()

    residuals_m = shifts1

    # Project everything into a common metric frame for plotting
    rx, ry = project_to_metres(raw_lat, raw_lon)
    cos_lat_mean = np.cos(np.radians(np.mean(raw_lat)))
    sx = (sm_lon - np.mean(raw_lon)) * M_PER_DEG * cos_lat_mean
    sy = (sm_lat - np.mean(raw_lat)) * M_PER_DEG
    sx2 = (sm_lon2 - np.mean(raw_lon)) * M_PER_DEG * cos_lat_mean
    sy2 = (sm_lat2 - np.mean(raw_lat)) * M_PER_DEG

    fig = plt.figure(figsize=(15, 9), constrained_layout=True)
    gs = fig.add_gridspec(2, 2, height_ratios=[3, 1])
    ax_map = fig.add_subplot(gs[0, :])
    ax_res = fig.add_subplot(gs[1, 0])
    ax_dt = fig.add_subplot(gs[1, 1])

    # Faint connector for raw, then dt-coloured scatter on top
    ax_map.plot(rx, ry, color="0.7", linewidth=0.5, alpha=0.6, zorder=1)
    sc = ax_map.scatter(
        rx, ry, c=dts, cmap="viridis", s=22, edgecolor="none",
        vmin=0, vmax=max(30, np.percentile(dts[1:], 95)) if len(dts) > 1 else 30,
        zorder=2, label="raw fixes (colour = Δt s)",
    )
    plt.colorbar(sc, ax=ax_map, label="Δt to previous fix (s)", shrink=0.7)
    # First-pass smoothed trajectory (faint — superseded by re-smoothed)
    ax_map.plot(sx, sy, color="crimson", linewidth=1.0, alpha=0.45,
                zorder=3, label="RTS smoothed (1st pass)")
    # Re-smoothed trajectory after dropping outliers
    ax_map.plot(sx2, sy2, color="crimson", linewidth=1.8, zorder=4,
                label=f"RTS re-smoothed (after dropping {n_flagged} outlier"
                      f"{'s' if n_flagged != 1 else ''})")
    # Highlight flagged outliers
    if n_flagged:
        ax_map.scatter(
            rx[is_outlier], ry[is_outlier], s=140, facecolor="none",
            edgecolor="black", linewidth=1.4, zorder=5,
            label=f"flagged (shift > {threshold:.1f} m)",
        )

    ax_map.set_aspect("equal")
    ax_map.set_xlabel("east (m)")
    ax_map.set_ylabel("north (m)")
    ax_map.set_title(f"{path.name}: raw vs RTS-smoothed")
    ax_map.legend(loc="best", fontsize=9)
    ax_map.grid(True, alpha=0.3)

    # Residuals over time, with the rejection threshold drawn in
    t0 = pts[0]["time"]
    elapsed_s = np.array([(p["time"] - t0).total_seconds() for p in pts])
    ax_res.plot(elapsed_s, residuals_m, color="crimson", linewidth=1)
    ax_res.fill_between(elapsed_s, 0, residuals_m, color="crimson", alpha=0.2)
    ax_res.axhline(threshold, color="black", linestyle="--", linewidth=1,
                   label=f"outlier threshold ({threshold:.1f} m)")
    if n_flagged:
        ax_res.scatter(elapsed_s[is_outlier], residuals_m[is_outlier],
                       s=60, facecolor="none", edgecolor="black",
                       linewidth=1.4, zorder=3)
    ax_res.set_xlabel("elapsed (s)")
    ax_res.set_ylabel("smoothing shift (m)")
    ax_res.set_title("Per-point shift (1st pass) + rejection threshold")
    ax_res.legend(loc="best", fontsize=8)
    ax_res.grid(True, alpha=0.3)

    # Δt distribution over time
    ax_dt.plot(elapsed_s, dts, color="navy", linewidth=1)
    ax_dt.set_xlabel("elapsed (s)")
    ax_dt.set_ylabel("Δt (s)")
    ax_dt.set_title("Sample interval over time")
    ax_dt.grid(True, alpha=0.3)

    out = Path("/tmp/rts-comparison.png")
    fig.savefig(out, dpi=150)
    worst = int(np.argmax(residuals_m))
    print(f"\n--- 1st pass ---")
    print(f"Max smoothing shift: {residuals_m[worst]:.1f} m at idx {worst} "
          f"(t={elapsed_s[worst]:.0f}s, Δt={dts[worst]:.1f}s)")
    print(f"Median shift: {np.median(residuals_m):.2f} m")
    print(f"95th-pct shift: {np.percentile(residuals_m, 95):.2f} m")
    print(f"\n--- outlier rejection ---")
    print(f"Threshold: {threshold:.1f} m")
    print(f"Flagged: {n_flagged} of {len(pts)} points")
    if n_flagged:
        for idx in np.where(is_outlier)[0]:
            print(f"  idx {idx}: shift {residuals_m[idx]:.1f} m at "
                  f"t={elapsed_s[idx]:.0f}s, Δt={dts[idx]:.1f}s")
    print(f"\n--- 2nd pass (after dropping outliers) ---")
    print(f"Max shift: {np.max(shifts2):.1f} m")
    print(f"Median shift: {np.median(shifts2):.2f} m")
    print(f"95th-pct shift: {np.percentile(shifts2, 95):.2f} m")
    print(f"\nSaved → {out}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
    else:
        path = Path(
            "/Users/garyo/Google Drive/My Drive/tmp/Track 2026-05-06 16_38.gpx"
        )
    main(path)
