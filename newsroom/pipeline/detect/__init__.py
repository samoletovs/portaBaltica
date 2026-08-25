"""Stage 2 — deterministic signal detection.

Pure functions over time series. No language model participates in deciding
what is news. See :mod:`newsroom.pipeline.detect.detectors` for the detectors
themselves and the reasoning behind each one's silence conditions.
"""

from __future__ import annotations

from newsroom.pipeline.detect.detectors import (
    Threshold,
    detect_all,
    detect_divergence,
    detect_record_extreme,
    detect_seasonal_deviation,
    detect_sharp_move,
    detect_streak,
    detect_structural_divergence,
    detect_threshold_cross,
)
from newsroom.pipeline.detect.series import Observation, TimeSeries, pct_change, robust_sigma

__all__ = [
    "Observation",
    "Threshold",
    "TimeSeries",
    "detect_all",
    "detect_divergence",
    "detect_record_extreme",
    "detect_seasonal_deviation",
    "detect_sharp_move",
    "detect_streak",
    "detect_structural_divergence",
    "detect_threshold_cross",
    "pct_change",
    "robust_sigma",
]
