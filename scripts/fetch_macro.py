"""Monthly Turkish macro history for the rent-or-buy simulator, from FRED (no key needed).

    python scripts/fetch_macro.py      # writes site/data/macro.json

Series (all monthly unless noted):
  cpi    consumer prices, HICP for Türkiye (Eurostat)            CP0000TRM086NEST
  rent   actual rentals for housing, HICP for Türkiye (Eurostat)  CP0410TRM086NEST
  house  nominal residential property prices (BIS, quarterly)    QTRN628BIS
  rate   interbank overnight rate, % a year (OECD)               IRSTCI01TRM156N
  usd    TRY per USD, monthly average (OECD)                     CCUSMA02TRM618N

Quarterly house prices are interpolated geometrically to months. The output keeps the months
where every series is present, so the simulator can resample whole months jointly.
"""

from __future__ import annotations

import csv
import io
import json
import math
import urllib.request
from datetime import date
from pathlib import Path

SERIES = {
    "cpi": "CP0000TRM086NEST",
    "rent": "CP0410TRM086NEST",
    "house": "QTRN628BIS",
    "rate": "IRSTCI01TRM156N",
    "usd": "CCUSMA02TRM618N",
}
URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={}"
OUT = Path(__file__).resolve().parents[1] / "site" / "data" / "macro.json"


def fetch(series_id: str) -> dict[str, float]:
    with urllib.request.urlopen(URL.format(series_id), timeout=60) as r:
        rows = list(csv.reader(io.StringIO(r.read().decode())))
    out = {}
    for d, v in rows[1:]:
        if v not in ("", "."):
            out[d[:7]] = float(v)
    return out


def months(start: str, end: str) -> list[str]:
    y, m = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def monthly_from_quarterly(q: dict[str, float]) -> dict[str, float]:
    """Quarter values sit on the quarter's first month; fill the months between geometrically."""
    keys = sorted(q)
    out = {}
    for a, b in zip(keys, keys[1:]):
        span = months(a, b)
        step = (q[b] / q[a]) ** (1 / (len(span) - 1))
        for i, mth in enumerate(span[:-1]):
            out[mth] = q[a] * step**i
    out[keys[-1]] = q[keys[-1]]
    return out


# HICP by spending category (COICOP), for the personal inflation rate
HICP = {
    "all": "CP0000TRM086NEST",
    "food": "CP0100TRM086NEST",  # food and non-alcoholic drinks
    "clothing": "CP0300TRM086NEST",
    "rent": "CP0410TRM086NEST",
    "electricity": "CP0451TRM086NEST",
    "furnishings": "CP0500TRM086NEST",
    "health": "CP0600TRM086NEST",
    "transport": "CP0700TRM086NEST",
    "fuel": "CP0722TRM086NEST",
    "communication": "CP0800TRM086NEST",
    "recreation": "CP0900TRM086NEST",
    "education": "CP1000TRM086NEST",
    "restaurants": "CP1100TRM086NEST",  # restaurants and hotels
}
HICP_OUT = OUT.parent / "hicp.json"


def hicp() -> None:
    data = {k: fetch(v) for k, v in HICP.items()}
    common = sorted(set.intersection(*(set(v) for v in data.values())))
    common = [m for m in common if m >= "2018-01"]
    HICP_OUT.write_text(json.dumps({
        "source": {k: f"FRED {v} (Eurostat HICP)" for k, v in HICP.items()},
        "fetched": date.today().isoformat(),
        "months": common,
        "index": {k: [round(data[k][m], 4) for m in common] for k in HICP},
    }))  # fmt: skip
    print(f"hicp: {len(common)} months {common[0]}..{common[-1]}")


def main() -> None:
    hicp()
    data = {k: fetch(v) for k, v in SERIES.items()}
    data["house"] = monthly_from_quarterly(data["house"])
    common = sorted(set.intersection(*(set(v) for v in data.values())))
    common = [m for m in common if m >= "2010-01"]
    rows = [{"month": m, **{k: round(data[k][m], 6) for k in SERIES}} for m in common]
    # sanity: indices positive, rates plausible
    assert all(r[k] > 0 for r in rows for k in ("cpi", "rent", "house", "usd"))
    assert all(0 <= r["rate"] < 200 for r in rows)
    first, last = rows[0], rows[-1]
    years = len(rows) / 12
    summary = {
        k: round((math.pow(last[k] / first[k], 1 / years) - 1) * 100, 1)
        for k in ("cpi", "rent", "house", "usd")
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": {k: f"FRED {v}" for k, v in SERIES.items()},
        "fetched": date.today().isoformat(),
        "annual_growth_pct": summary,
        "rows": rows,
    }, ensure_ascii=False))  # fmt: skip
    print(f"{len(rows)} months {first['month']}..{last['month']}; yearly growth %: {summary}")


if __name__ == "__main__":
    main()
