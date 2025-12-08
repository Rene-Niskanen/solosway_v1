import json
from typing import Any, Optional, Dict


def ensure_bbox_dict(raw_bbox: Any) -> Optional[Dict[str, Any]]:
    """
    Normalize a bbox payload coming from Supabase/Reducto into a dict.

    Handles jsonb dicts returned by the client as Python dicts as well as
    legacy rows where the bbox was serialized via json.dumps before insert.
    """
    if not raw_bbox:
        return None

    if isinstance(raw_bbox, dict):
        return raw_bbox

    if isinstance(raw_bbox, str):
        try:
            parsed = json.loads(raw_bbox)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, TypeError):
            return None

    return None


def summarize_bbox(raw_bbox: Any, precision: int = 4) -> str:
    """
    Produce a concise string describing a bbox dict for logging/debugging.
    """
    bbox = ensure_bbox_dict(raw_bbox)
    if not bbox:
        return "None"

    parts = []
    for key in ("page", "original_page", "left", "top", "width", "height"):
        value = bbox.get(key)
        if value is None:
            continue
        if isinstance(value, float):
            parts.append(f"{key}={value:.{precision}f}")
        else:
            parts.append(f"{key}={value}")

    return ", ".join(parts) if parts else "empty"

