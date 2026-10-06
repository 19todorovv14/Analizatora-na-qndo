"""Market sessions (open / closed / break) per trading calendar.

Calendars are weekly schedules in the exchange's local time zone (zoneinfo handles DST).
Public holidays and early closes are NOT modelled — the returned note says so. The DEMO feed
ignores sessions (it generates candles 24/7); for demo-sourced instruments the note says that too.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.market.base import AssetSpec

OPEN, CLOSED, BREAK = "open", "closed", "break"

NOTE_24X7 = "Търгува се непрекъснато (24/7)."
NOTE_HOLIDAYS = "Празниците и съкратените дни не са моделирани — провери официалния календар на борсата."
NOTE_DEMO = "Демо данните се генерират 24/7."
NOTE_APPROX = "Сесията е определена приблизително по класа на инструмента."

Segment = tuple[int, int, str]  # (start minute, end minute, kind) in local wall time; end may be 1440


@dataclass(frozen=True)
class Calendar:
    id: str
    tz: str
    name: str  # Bulgarian description
    week: dict[int, tuple[Segment, ...]]  # weekday (0 = Monday … 6 = Sunday) → segments
    break_label: str = "Пауза в търговията"


def _hm(text: str) -> int:
    h, m = text.split(":")
    return int(h) * 60 + int(m)


def _weekdays(open_: str, close: str, lunch: tuple[str, str] | None = None) -> dict[int, tuple[Segment, ...]]:
    o, c = _hm(open_), _hm(close)
    if lunch:
        ls, le = _hm(lunch[0]), _hm(lunch[1])
        day: tuple[Segment, ...] = ((o, ls, OPEN), (ls, le, BREAK), (le, c, OPEN))
    else:
        day = ((o, c, OPEN),)
    return {wd: day for wd in range(5)}


_FULL = (0, 1440, OPEN)

CALENDARS: dict[str, Calendar] = {
    c.id: c
    for c in (
        Calendar("24x7", "UTC", "Непрекъсната търговия 24/7", {wd: (_FULL,) for wd in range(7)}),
        Calendar(
            "fx",
            "UTC",
            "Валутен пазар: неделя 22:00 – петък 22:00 UTC",
            {6: ((_hm("22:00"), 1440, OPEN),), **{wd: (_FULL,) for wd in range(4)}, 4: ((0, _hm("22:00"), OPEN),)},
        ),
        Calendar("us_equity", "America/New_York", "САЩ (NYSE/NASDAQ) 09:30–16:00 Ню Йорк", _weekdays("09:30", "16:00")),
        Calendar(
            "cme",
            "America/New_York",
            "CME Globex: неделя 18:00 – петък 17:00 Ню Йорк, дневна пауза 17:00–18:00",
            {
                6: ((_hm("18:00"), 1440, OPEN),),
                **{
                    wd: ((0, _hm("17:00"), OPEN), (_hm("17:00"), _hm("18:00"), BREAK), (_hm("18:00"), 1440, OPEN))
                    for wd in range(4)
                },
                4: ((0, _hm("17:00"), OPEN),),
            },
            break_label="Дневна пауза",
        ),
        Calendar("eu_xetra", "Europe/Berlin", "Xetra (Франкфурт) 09:00–17:30", _weekdays("09:00", "17:30")),
        Calendar("uk_lse", "Europe/London", "Лондонска борса 08:00–16:30", _weekdays("08:00", "16:30")),
        Calendar("eu_euronext", "Europe/Paris", "Euronext 09:00–17:30 (Париж)", _weekdays("09:00", "17:30")),
        Calendar(
            "jp_tse",
            "Asia/Tokyo",
            "Токийска борса 09:00–15:30, обедна почивка 11:30–12:30",
            _weekdays("09:00", "15:30", ("11:30", "12:30")),
            break_label="Обедна почивка",
        ),
        Calendar(
            "hk_hkex",
            "Asia/Hong_Kong",
            "Хонконгска борса 09:30–16:00, обедна почивка 12:00–13:00",
            _weekdays("09:30", "16:00", ("12:00", "13:00")),
            break_label="Обедна почивка",
        ),
        Calendar("au_asx", "Australia/Sydney", "Австралийска борса 10:00–16:00 (Сидни)", _weekdays("10:00", "16:00")),
    )
}
SESSION_IDS = tuple(CALENDARS)

_CLASS_DEFAULT = {"crypto": "24x7", "forex": "fx", "commodity": "cme"}  # everything else → us_equity

_LABELS = {OPEN: "Отворен", CLOSED: "Затворен"}


@lru_cache(maxsize=32)
def _zone(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def calendar_for(asset: AssetSpec) -> tuple[Calendar, bool]:
    """(calendar, exact) — exact=False when the asset's session id is unknown and a class default is used."""
    cal = CALENDARS.get(asset.session)
    if cal is not None:
        return cal, True
    return CALENDARS[_CLASS_DEFAULT.get(asset.asset_class, "us_equity")], False


def _segments(cal: Calendar, now: int) -> list[tuple[int, int, str]]:
    """UTC (start, end, kind) segments around `now` (−2 … +9 local days), contiguous same-kind merged."""
    tz = _zone(cal.tz)
    today = datetime.fromtimestamp(now, tz).date()
    out: list[list] = []
    for offset in range(-2, 10):
        d: date = today + timedelta(days=offset)
        midnight = datetime(d.year, d.month, d.day, tzinfo=tz)
        for start_min, end_min, kind in cal.week.get(d.weekday(), ()):
            # wall-clock arithmetic: aware datetime + timedelta keeps local wall time, offset recomputed
            s = int((midnight + timedelta(minutes=start_min)).timestamp())
            e = int((midnight + timedelta(minutes=end_min)).timestamp())
            if e <= s:
                continue
            if out and out[-1][2] == kind and out[-1][1] == s:
                out[-1][1] = e
            else:
                out.append([s, e, kind])
    return [(s, e, k) for s, e, k in out]


def _is_demo(asset: AssetSpec) -> bool:
    from app.market.registry import availability  # local import: sessions stays importable on its own

    try:
        return availability(asset).get("provider_id") == "demo"
    except Exception:  # noqa: BLE001 - status must never fail because of provider configuration
        return False


def market_status(asset: AssetSpec, now: int | None = None, *, demo: bool | None = None) -> dict:
    """{status: open|closed|break, label (BG), session, next_change_ts|None, note, timezone}.

    `demo` — whether the instrument's data comes from the DEMO feed; None → asked from the registry.
    """
    now = int(now if now is not None else time.time())
    cal, exact = calendar_for(asset)
    notes: list[str] = []
    if cal.id == "24x7":
        status, next_change = OPEN, None
        label = "Отворен 24/7"
        notes.append(NOTE_24X7)
    else:
        status, next_change = CLOSED, None
        for start, end, kind in _segments(cal, now):
            if start <= now < end:
                status, next_change = kind, end
                break
            if start > now:
                next_change = start
                break
        label = cal.break_label if status == BREAK else _LABELS[status]
        notes.append(NOTE_HOLIDAYS)
    if not exact:
        notes.append(NOTE_APPROX)
    if demo is None:
        demo = _is_demo(asset)
    if demo:
        notes.append(NOTE_DEMO)
    return {
        "status": status,
        "label": label,
        "session": cal.id,
        "session_name": cal.name,
        "timezone": cal.tz,
        "next_change_ts": next_change,
        "note": " ".join(notes),
    }
