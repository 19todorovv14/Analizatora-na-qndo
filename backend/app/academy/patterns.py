"""Candlestick Lab (S3b): pattern gallery content, "find it on a real chart" examples and HMAC-signed practice.

* PATTERNS — 24 educational pattern cards (Bulgarian text, English trading terms). Every card carries a synthetic
  OHLC illustration (5 context candles + the pattern) that the rule-based detector in app.analysis.candles
  recognises on its last candle (tested), so the gallery, the practice rounds and the real-chart search agree.
* examples() — real/demo occurrences of one pattern on CLOSED candles and what happened over the next 5/10 bars
  (historical behaviour on this data, not a prediction).
* practice_rounds() / grade_practice() / submit_practice() — HMAC-signed rounds; the correct answer is NOT readable
  from a token (only a keyed hash of it), the score is stored as QuizResult(module="lab:candlesticks").

A pattern is a description of past candles — never a signal on its own.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import random
import secrets
import statistics
import time

from app.academy.levels import lesson_href
from app.analysis.candles import DETECTABLE_PATTERNS, PATTERN_DEFS, detect_patterns, patterns_at
from app.config import get_settings
from app.market.base import Candle, MarketDataError
from app.market.timeframes import tf_seconds

PATTERN_DISCLAIMER = (
    "Моделът описва какво вече се е случило — не е сигнал сам по себе си и не е прогноза. "
    "Гледай контекста (тренд, ниво) и чакай потвърждение."
)
EXAMPLES_DISCLAIMER = (
    "Historical behaviour on this data, not a prediction. Историческо поведение на тези данни — не е прогноза "
    "и не показва какво ще се случи следващия път."
)
PRACTICE_QUESTION = "Кой модел завършва на последната свещ?"
PRACTICE_MAX_ROUNDS = 20
PRACTICE_TTL = 3600  # seconds a practice set stays valid
ILLUSTRATION_START = 1_704_067_200  # 2024-01-01 00:00 UTC — synthetic daily times for the illustrations
EXAMPLE_HORIZONS: tuple[int, ...] = (5, 10)
EXAMPLES_DEFAULT_BARS = 500
EXAMPLES_MAX_SHOWN = 30
EXAMPLES_SMALL_SAMPLE = 20
ATR_PERIOD = 14
TYPE_OF_BARS = {1: "single", 2: "double", 3: "triple"}


class PracticeError(ValueError):
    """Invalid practice submission (→ 400)."""


class PracticeAlreadySubmitted(PracticeError):
    """The practice set was already submitted (→ 409)."""


# ---------------------------------------------------------------------------------------------- illustrations
def _down() -> list[tuple[float, float, float, float]]:
    """5 bearish candles stepping down from 110 to a close of 100 (o, h, l, c)."""
    out, o = [], 110.0
    for _ in range(5):
        c = o - 2
        out.append((o, o + 0.4, c - 0.4, c))
        o = c
    return out


def _up() -> list[tuple[float, float, float, float]]:
    """5 bullish candles stepping up from 90 to a close of 100."""
    out, o = [], 90.0
    for _ in range(5):
        c = o + 2
        out.append((o, c + 0.4, o - 0.4, c))
        o = c
    return out


def _flat() -> list[tuple[float, float, float, float]]:
    """5 small alternating candles around 100 (a range)."""
    return [
        (100.0, 101.0, 99.2, 100.6),
        (100.6, 101.2, 99.4, 99.8),
        (99.8, 100.8, 99.0, 100.4),
        (100.4, 101.0, 99.5, 99.7),
        (99.7, 100.7, 99.1, 100.2),
    ]


_CONTEXTS = {"down": _down, "up": _up, "flat": _flat}
CONTEXT_TEXT = {
    "down": "Преди модела: спад (5 мечи свещи).",
    "up": "Преди модела: покачване (5 бичи свещи).",
    "flat": "Преди модела: странично движение (range).",
}

# key → (context before the pattern, the pattern's own candles as (open, high, low, close))
ILLUSTRATIONS: dict[str, tuple[str, list[tuple[float, float, float, float]]]] = {
    "doji": ("up", [(100.1, 101.0, 99.2, 100.12)]),
    "dragonfly_doji": ("down", [(99.9, 100.0, 97.9, 99.95)]),
    "gravestone_doji": ("up", [(100.1, 102.1, 100.0, 100.05)]),
    "spinning_top": ("up", [(100.2, 101.4, 99.4, 100.6)]),
    "hammer": ("down", [(99.6, 100.35, 97.0, 100.2)]),
    "hanging_man": ("up", [(100.4, 101.05, 97.8, 100.9)]),
    "inverted_hammer": ("down", [(99.0, 102.1, 98.9, 99.5)]),
    "shooting_star": ("up", [(100.5, 103.1, 99.9, 100.0)]),
    "bullish_marubozu": ("flat", [(100.1, 103.1, 100.0, 103.0)]),
    "bearish_marubozu": ("flat", [(100.0, 100.1, 97.0, 97.1)]),
    "bullish_engulfing": ("down", [(100.0, 100.7, 98.3, 98.6), (98.5, 100.6, 97.9, 100.4)]),
    "bearish_engulfing": ("up", [(100.0, 102.0, 99.3, 101.4), (101.5, 101.5, 99.2, 99.6)]),
    "bullish_harami": ("down", [(100.0, 100.2, 97.0, 97.3), (97.8, 98.6, 97.6, 98.4)]),
    "bearish_harami": ("up", [(100.0, 103.0, 99.8, 102.7), (102.2, 102.4, 101.4, 101.6)]),
    "piercing_line": ("down", [(100.0, 100.2, 97.3, 97.5), (97.0, 99.3, 96.8, 99.1)]),
    "dark_cloud_cover": ("up", [(100.0, 102.7, 99.8, 102.5), (103.0, 103.2, 100.7, 100.9)]),
    "tweezer_bottom": ("down", [(100.0, 100.2, 98.0, 98.4), (98.4, 99.9, 97.98, 99.6)]),
    "tweezer_top": ("up", [(100.0, 102.0, 99.8, 101.6), (101.6, 102.02, 100.1, 100.4)]),
    "inside_bar": ("up", [(100.0, 102.5, 99.5, 102.0), (101.2, 102.3, 100.6, 102.2)]),
    "outside_bar": ("down", [(99.8, 100.4, 98.9, 99.3), (99.9, 100.9, 98.4, 98.7)]),
    "morning_star": ("down", [(100.0, 100.2, 97.1, 97.4), (97.0, 97.4, 96.4, 96.9), (97.3, 99.4, 97.1, 99.2)]),
    "evening_star": ("up", [(100.0, 102.9, 99.8, 102.6), (103.0, 103.6, 102.6, 103.1), (102.7, 102.9, 100.6, 100.8)]),
    "three_white_soldiers": (
        "down",
        [(100.0, 101.3, 99.8, 101.1), (100.8, 102.5, 100.6, 102.3), (102.0, 103.7, 101.8, 103.5)],
    ),
    "three_black_crows": (
        "up",
        [(100.0, 100.2, 98.7, 98.9), (99.2, 99.4, 97.5, 97.7), (98.0, 98.2, 96.3, 96.5)],
    ),
}

# Patterns that look alike (used as practice distractors before random ones).
CONFUSABLE: dict[str, tuple[str, ...]] = {
    "doji": ("spinning_top", "dragonfly_doji", "gravestone_doji"),
    "dragonfly_doji": ("hammer", "doji", "gravestone_doji"),
    "gravestone_doji": ("shooting_star", "doji", "dragonfly_doji"),
    "spinning_top": ("doji", "inside_bar", "hammer"),
    "hammer": ("hanging_man", "inverted_hammer", "dragonfly_doji", "shooting_star"),
    "hanging_man": ("hammer", "shooting_star", "dragonfly_doji"),
    "inverted_hammer": ("shooting_star", "hammer", "gravestone_doji"),
    "shooting_star": ("inverted_hammer", "hanging_man", "gravestone_doji"),
    "bullish_marubozu": ("three_white_soldiers", "bullish_engulfing", "bearish_marubozu"),
    "bearish_marubozu": ("three_black_crows", "bearish_engulfing", "bullish_marubozu"),
    "bullish_engulfing": ("piercing_line", "bullish_harami", "outside_bar", "bearish_engulfing"),
    "bearish_engulfing": ("dark_cloud_cover", "bearish_harami", "outside_bar", "bullish_engulfing"),
    "bullish_harami": ("bullish_engulfing", "inside_bar", "bearish_harami"),
    "bearish_harami": ("bearish_engulfing", "inside_bar", "bullish_harami"),
    "piercing_line": ("bullish_engulfing", "dark_cloud_cover", "bullish_harami"),
    "dark_cloud_cover": ("bearish_engulfing", "piercing_line", "bearish_harami"),
    "tweezer_bottom": ("tweezer_top", "bullish_engulfing", "hammer"),
    "tweezer_top": ("tweezer_bottom", "bearish_engulfing", "shooting_star"),
    "inside_bar": ("outside_bar", "bullish_harami", "bearish_harami"),
    "outside_bar": ("inside_bar", "bullish_engulfing", "bearish_engulfing"),
    "morning_star": ("evening_star", "bullish_engulfing", "three_white_soldiers"),
    "evening_star": ("morning_star", "bearish_engulfing", "three_black_crows"),
    "three_white_soldiers": ("three_black_crows", "bullish_marubozu", "morning_star"),
    "three_black_crows": ("three_white_soldiers", "bearish_marubozu", "evening_star"),
}

# ------------------------------------------------------------------------------------------------- content
# name, short, looks_like, means, does_not_mean, common_mistake, context_rule, confirmation, practice_hint, lesson
_TEXT: dict[str, dict] = {
    "doji": {
        "name": "Doji",
        "short": "Тяло почти нула — Open ≈ Close: равновесие между купувачи и продавачи.",
        "looks_like": "Много малко тяло (≤ 10% от диапазона High–Low) и сенки от двете страни. Прилича на кръст "
        "или знак плюс.",
        "means": "През периода цената се е движила, но е затворила почти там, където е отворила. Нито купувачите, "
        "нито продавачите са успели да наложат посоката — пазарът се колебае.",
        "does_not_mean": "Не означава автоматично обръщане на тренда и не е сигнал за вход сам по себе си. В силен "
        "тренд doji често е само кратка пауза.",
        "common_mistake": "Да се продава всеки doji в uptrend. Без ниво (support/resistance) и без потвърждение "
        "doji е просто нерешителност.",
        "context_rule": "По-информативен е след продължително движение и при важно ниво (resistance след "
        "покачване, support след спад). В средата на range почти нищо не казва.",
        "confirmation": "Изчакай следващата свещ: затваряне под Low на doji (след покачване) или над High (след "
        "спад) показва накъде се е решило колебанието.",
        "practice_hint": "Сравни тялото с целия диапазон: ако тялото е под ~10% от High–Low и не е Т-образно, "
        "това е doji.",
        "lesson": "doji",
    },
    "dragonfly_doji": {
        "name": "Dragonfly doji",
        "short": "Doji с дълга долна сянка и почти без горна — по-ниските цени са отхвърлени.",
        "looks_like": "Open, Close и High са почти на едно ниво в горната част на свещта; долната сянка е ≥ 60% "
        "от диапазона, горната ≤ 10%. Прилича на буквата Т.",
        "means": "Продавачите са свалили цената силно надолу, но до края на периода купувачите са я върнали до "
        "Open. Долните нива са отхвърлени.",
        "does_not_mean": "Не е сигнал за покупка сам по себе си. След покачване същата форма може да показва "
        "изтощение, а не сила.",
        "common_mistake": "Да се тълкува винаги като bullish. Посоката зависи от контекста — затова bias-ът е "
        "context-dependent.",
        "context_rule": "Значим е при support или след спад, където показва отхвърляне на по-ниските цени. В "
        "средата на range е шум.",
        "confirmation": "Следваща свещ, която затваря над High на dragonfly doji-то, показва, че купувачите "
        "задържат контрола.",
        "practice_hint": "Търси Т-образна свещ: тялото горе, дълга сянка надолу, почти никаква сянка нагоре.",
        "lesson": "doji",
    },
    "gravestone_doji": {
        "name": "Gravestone doji",
        "short": "Doji с дълга горна сянка и почти без долна — по-високите цени са отхвърлени.",
        "looks_like": "Open, Close и Low са почти на едно ниво в долната част на свещта; горната сянка е ≥ 60% от "
        "диапазона, долната ≤ 10%. Прилича на обърнато Т.",
        "means": "Купувачите са качили цената високо, но до края на периода продавачите са я върнали до Open. "
        "Горните нива са отхвърлени.",
        "does_not_mean": "Не е сигнал за продажба сам по себе си и не значи, че uptrend-ът е приключил.",
        "common_mistake": "Да се отваря short на всеки gravestone doji, без ниво и без потвърждение.",
        "context_rule": "Значим е при resistance или след покачване. След дълъг спад може да е просто тест на "
        "по-високи цени.",
        "confirmation": "Следваща свещ, която затваря под Low на gravestone doji-то, показва, че продавачите "
        "поемат контрола.",
        "practice_hint": "Търси обърнато Т: тялото долу, дълга сянка нагоре, почти без сянка надолу.",
        "lesson": "doji",
    },
    "spinning_top": {
        "name": "Spinning top",
        "short": "Малко тяло в средата и дълги сенки от двете страни — колебание.",
        "looks_like": "Тяло между ~10% и 35% от диапазона, разположено в средата; горната и долната сянка са поне "
        "по 25% от диапазона.",
        "means": "И двете страни са опитали да поемат контрол, но нито една не е успяла. Импулсът на текущото "
        "движение отслабва.",
        "does_not_mean": "Не означава обръщане. В тренд spinning top често е пауза, след която трендът продължава.",
        "common_mistake": "Да се бърка с doji (там тялото е почти нула) или да се търгува като сигнал сам по себе си.",
        "context_rule": "Има смисъл след силно движение или при ниво — показва, че натискът намалява. В тих range "
        "е обикновена свещ.",
        "confirmation": "Посоката на следващото затваряне извън диапазона на spinning top-а показва коя страна "
        "надделява.",
        "practice_hint": "Малко тяло в средата + две дълги сенки = spinning top. Ако тялото почти липсва, е doji.",
        "lesson": None,
    },
    "hammer": {
        "name": "Hammer",
        "short": "След спад: малко тяло горе и дълга долна сянка — по-ниските цени са отхвърлени.",
        "looks_like": "Малко тяло в горната част на свещта, долна сянка поне 2× тялото (≥ 55% от диапазона), "
        "почти без горна сянка (≤ 15%). Цветът на тялото е второстепенен.",
        "means": "По време на спад продавачите са свалили цената ниско, но купувачите са я върнали близо до High. "
        "Показва отхвърляне на по-ниските нива.",
        "does_not_mean": "Не означава, че спадът е приключил или че цената ще се обърне — описва една свещ и не е "
        "сигнал сам по себе си.",
        "common_mistake": "Да се нарича hammer всяка свещ с дълга долна сянка, независимо от контекста. Същата "
        "форма след покачване е hanging man.",
        "context_rule": "Изисква предходен спад. Най-значим е при support зона или след продължителен спад.",
        "confirmation": "Следваща свещ, която затваря над High на hammer-а. Invalidation: затваряне под Low-а му.",
        "practice_hint": "Първо провери контекста (спад ли има преди свещта?), после формата: долна сянка ≥ 2× тялото.",
        "lesson": "hammer",
    },
    "hanging_man": {
        "name": "Hanging man",
        "short": "След покачване: формата на hammer — предупреждение за слабост, не сигнал.",
        "looks_like": "Същата форма като hammer: малко тяло горе, долна сянка ≥ 2× тялото, почти без горна сянка. "
        "Разликата е само в контекста — появява се след покачване.",
        "means": "В uptrend продавачите са успели да свалят цената значително по време на периода. Купувачите са "
        "я върнали, но натискът от продажби вече се е появил.",
        "does_not_mean": "Не означава, че uptrend-ът е приключил. Често цената продължава нагоре след hanging man.",
        "common_mistake": "Да се бърка с hammer (същата форма, обратен контекст) или да се отваря short без "
        "потвърждение.",
        "context_rule": "Изисква предходно покачване; по-значим е при resistance или след разтегнато движение.",
        "confirmation": "Следваща свещ, която затваря под Low на hanging man-а. Без нея моделът е само предупреждение.",
        "practice_hint": "Hammer или hanging man? Погледни свещите ПРЕДИ: покачване означава hanging man.",
        "lesson": "hammer",
    },
    "inverted_hammer": {
        "name": "Inverted hammer",
        "short": "След спад: малко тяло долу и дълга горна сянка — първи опит на купувачите.",
        "looks_like": "Малко тяло в долната част, горна сянка поне 2× тялото (≥ 55% от диапазона), почти без "
        "долна сянка (≤ 15%).",
        "means": "След спад купувачите са опитали да качат цената. Опитът не е задържан до затварянето, но "
        "показва, че продавачите вече не контролират напълно.",
        "does_not_mean": "Не е потвърдено обръщане — горната сянка показва, че по-високите цени все още са отхвърлени.",
        "common_mistake": "Да се бърка със shooting star — същата форма, но shooting star идва след покачване.",
        "context_rule": "Изисква предходен спад; по-значим е при support.",
        "confirmation": "Следваща свещ, която затваря над High на inverted hammer-а.",
        "practice_hint": "Дълга горна сянка след спад = inverted hammer; след покачване = shooting star.",
        "lesson": "hammer",
    },
    "shooting_star": {
        "name": "Shooting star",
        "short": "След покачване: малко тяло долу и дълга горна сянка — по-високите цени са отхвърлени.",
        "looks_like": "Малко тяло в долната част на свещта, горна сянка поне 2× тялото (≥ 55% от диапазона), "
        "почти без долна сянка.",
        "means": "В uptrend купувачите са качили цената високо, но продавачите са я върнали близо до Low. "
        "Горните нива са отхвърлени.",
        "does_not_mean": "Не означава, че цената ще падне. Описва един период и не е сигнал сам по себе си.",
        "common_mistake": "Да се търси shooting star без предходно покачване (там формата е inverted hammer) или "
        "да се игнорира нивото.",
        "context_rule": "Изисква предходно покачване; най-значим е при resistance.",
        "confirmation": "Следваща свещ, която затваря под Low на shooting star-а. Invalidation: затваряне над "
        "High-а му.",
        "practice_hint": "Провери контекста (покачване?) и дали горната сянка е поне 2× тялото.",
        "lesson": "shooting-star",
    },
    "bullish_marubozu": {
        "name": "Bullish marubozu",
        "short": "Голямо бичо тяло почти без сенки — купувачите контролират целия период.",
        "looks_like": "Close > Open, тялото е ≥ 90% от диапазона и поне 1.3× по-голямо от средното тяло на "
        "предходните свещи. Сенките почти липсват.",
        "means": "Цената отваря близо до Low и затваря близо до High — купувачите доминират от началото до края "
        "на периода.",
        "does_not_mean": "Не означава, че и следващата свещ ще е бича. След много голяма свещ често следва пауза "
        "или връщане.",
        "common_mistake": "Да се купува на затварянето на огромен marubozu, далеч от нивото, с много широк stop.",
        "context_rule": "Marubozu, който излиза от range или пробива resistance, описва ясен импулс; след дълго "
        "покачване може да е изтощение.",
        "confirmation": "Задържане над средата на тялото в следващите свещи или retest на пробитото ниво.",
        "practice_hint": "Почти няма сенки? Тялото ≥ 90% от свещта и по-голямо от обичайното → marubozu.",
        "lesson": "bullish-candle",
    },
    "bearish_marubozu": {
        "name": "Bearish marubozu",
        "short": "Голямо мечо тяло почти без сенки — продавачите контролират целия период.",
        "looks_like": "Close < Open, тялото е ≥ 90% от диапазона и поне 1.3× по-голямо от средното тяло на "
        "предходните свещи. Сенките почти липсват.",
        "means": "Цената отваря близо до High и затваря близо до Low — продавачите доминират от началото до края "
        "на периода.",
        "does_not_mean": "Не означава, че и следващата свещ ще е меча. След много голяма свещ често следва пауза "
        "или връщане.",
        "common_mistake": "Да се продава на затварянето на огромен marubozu, далеч от нивото, с много широк stop.",
        "context_rule": "Marubozu, който излиза от range или пробива support, описва ясен импулс; след дълъг "
        "спад може да е изтощение.",
        "confirmation": "Задържане под средата на тялото в следващите свещи или retest на пробитото ниво.",
        "practice_hint": "Почти няма сенки и тялото е голямо и мечо → bearish marubozu.",
        "lesson": "bearish-candle",
    },
    "bullish_engulfing": {
        "name": "Bullish engulfing",
        "short": "След спад: бичо тяло, което покрива изцяло предходното мечо тяло.",
        "looks_like": "Две свещи: мечя, след нея бича, чието тяло (Open → Close) обхваща цялото тяло на първата.",
        "means": "Купувачите са поели контрол над целия диапазон на тялото на предишния период — промяна в "
        "краткосрочния баланс.",
        "does_not_mean": "Не означава, че downtrend-ът е приключил. Без ниво и потвърждение е само една силна свещ.",
        "common_mistake": "Да се сравняват сенките вместо телата или моделът да се търси в средата на range.",
        "context_rule": "Изисква предходен спад; най-значим е при support или след ясен downtrend.",
        "confirmation": "Следващите свещи остават над средата на engulfing тялото; invalidation под Low-а на модела.",
        "practice_hint": "Сравни само телата: покрива ли второто тяло изцяло първото?",
        "lesson": "engulfing",
    },
    "bearish_engulfing": {
        "name": "Bearish engulfing",
        "short": "След покачване: мечо тяло, което покрива изцяло предходното бичо тяло.",
        "looks_like": "Две свещи: бича, след нея меча, чието тяло обхваща цялото тяло на първата.",
        "means": "Продавачите са поели контрол над целия диапазон на тялото на предишния период — промяна в "
        "краткосрочния баланс.",
        "does_not_mean": "Не означава, че uptrend-ът е приключил. Без ниво и потвърждение е само една силна свещ.",
        "common_mistake": "Да се сравняват сенките вместо телата или да се отваря short в средата на range.",
        "context_rule": "Изисква предходно покачване; най-значим е при resistance или след ясен uptrend.",
        "confirmation": "Следващите свещи остават под средата на engulfing тялото; invalidation над High-а на модела.",
        "practice_hint": "Сравни телата: покрива ли мечото тяло изцяло предишното бичо?",
        "lesson": "engulfing",
    },
    "bullish_harami": {
        "name": "Bullish harami",
        "short": "След спад: малко тяло изцяло вътре в тялото на предходната дълга мечя свещ.",
        "looks_like": "1) дълга мечя свещ; 2) малка свещ (тяло ≤ 50% от първото), чието тяло е изцяло вътре в "
        "тялото на първата. Обикновено е и inside bar.",
        "means": "Спадът спира: след голяма мечя свещ пазарът се колебае в тесен диапазон.",
        "does_not_mean": "Не означава обръщане — често е само пауза в downtrend-а.",
        "common_mistake": "Да се бърка с engulfing (там второто тяло е ПО-ГОЛЯМО) или да се търгува без потвърждение.",
        "context_rule": "Изисква предходен спад; при support е по-информативен.",
        "confirmation": "Затваряне над Open (горния край на тялото) на първата свещ.",
        "practice_hint": "Второто тяло е вътре в първото? Harami. Второто покрива първото? Engulfing.",
        "lesson": "engulfing",
    },
    "bearish_harami": {
        "name": "Bearish harami",
        "short": "След покачване: малко тяло изцяло вътре в тялото на предходната дълга бича свещ.",
        "looks_like": "1) дълга бича свещ; 2) малка свещ (тяло ≤ 50% от първото), чието тяло е изцяло вътре в "
        "тялото на първата. Обикновено е и inside bar.",
        "means": "Покачването спира: след голяма бича свещ пазарът се колебае в тесен диапазон.",
        "does_not_mean": "Не означава обръщане — често е само пауза в uptrend-а.",
        "common_mistake": "Да се бърка с engulfing или да се отваря short веднага след модела.",
        "context_rule": "Изисква предходно покачване; при resistance е по-информативен.",
        "confirmation": "Затваряне под Open (долния край на тялото) на първата свещ.",
        "practice_hint": "Малко тяло, сгушено в голямо бичо тяло след покачване → bearish harami.",
        "lesson": "engulfing",
    },
    "piercing_line": {
        "name": "Piercing line",
        "short": "След спад: бича свещ отваря под предишния Close и затваря над средата на мечото тяло.",
        "looks_like": "1) дълга мечя свещ; 2) бича свещ, която отваря под Close на първата и затваря над средата "
        "на тялото ѝ, но под нейния Open.",
        "means": "Купувачите са върнали повече от половината от тялото на предишния спад.",
        "does_not_mean": "Не е обръщане на тренда — по-слаб е от bullish engulfing, защото не покрива цялото тяло.",
        "common_mistake": "Да се приеме за piercing line свещ, която затваря под средата на мечото тяло.",
        "context_rule": "Изисква предходен спад; при support е по-информативен.",
        "confirmation": "Следваща свещ над Close на piercing line; invalidation под Low-а на модела.",
        "practice_hint": "Намери средата на мечото тяло: затваря ли бичата свещ над нея (но под Open-а му)?",
        "lesson": "engulfing",
    },
    "dark_cloud_cover": {
        "name": "Dark cloud cover",
        "short": "След покачване: меча свещ отваря над предишния Close и затваря под средата на бичото тяло.",
        "looks_like": "1) дълга бича свещ; 2) меча свещ, която отваря над Close на първата и затваря под средата "
        "на тялото ѝ, но над нейния Open.",
        "means": "Продавачите са върнали повече от половината от тялото на предишното покачване.",
        "does_not_mean": "Не е обръщане на тренда — по-слаб е от bearish engulfing, защото не покрива цялото тяло.",
        "common_mistake": "Да се приеме за dark cloud cover свещ, която затваря над средата на бичото тяло.",
        "context_rule": "Изисква предходно покачване; при resistance е по-информативен.",
        "confirmation": "Следваща свещ под Close на модела; invalidation над High-а му.",
        "practice_hint": "Намери средата на бичото тяло: затваря ли мечата свещ под нея (но над Open-а му)?",
        "lesson": "engulfing",
    },
    "tweezer_bottom": {
        "name": "Tweezer bottom",
        "short": "След спад: мечя и бича свещ с почти еднакви Low — двоен отказ на едно ниво.",
        "looks_like": "Две свещи с почти равни Low (разлика ≤ 10% от по-големия диапазон): първата мечя, втората бича.",
        "means": "Цената два пъти поред спира на едно и също ниво — купувачите го защитават.",
        "does_not_mean": "Не означава, че нивото ще издържи и следващия път.",
        "common_mistake": "Да се търсят равни Low-ове без предходен спад или да се игнорира колко голяма е "
        "разликата между тях.",
        "context_rule": "Изисква предходен спад; най-значим е при известен support.",
        "confirmation": "Затваряне над High-а на двете свещи; invalidation под общия Low.",
        "practice_hint": "Сравни Low-овете на двете свещи — почти на едно ниво ли са?",
        "lesson": None,
    },
    "tweezer_top": {
        "name": "Tweezer top",
        "short": "След покачване: бича и меча свещ с почти еднакви High — двоен отказ на едно ниво.",
        "looks_like": "Две свещи с почти равни High (разлика ≤ 10% от по-големия диапазон): първата бича, втората "
        "меча.",
        "means": "Цената два пъти поред спира на едно и също ниво — продавачите го защитават.",
        "does_not_mean": "Не означава, че нивото ще издържи и следващия път.",
        "common_mistake": "Да се търсят равни High-ове без предходно покачване.",
        "context_rule": "Изисква предходно покачване; най-значим е при известен resistance.",
        "confirmation": "Затваряне под Low-а на двете свещи; invalidation над общия High.",
        "practice_hint": "Сравни High-овете на двете свещи — почти на едно ниво ли са?",
        "lesson": None,
    },
    "inside_bar": {
        "name": "Inside bar",
        "short": "Свещ, която е изцяло вътре в диапазона на предходната — свиване на волатилността.",
        "looks_like": "High ≤ предходния High и Low ≥ предходния Low: цялата свещ (със сенките) е в диапазона на "
        "предишната (mother bar).",
        "means": "Волатилността се свива — пазарът „почива“ след движението на mother bar-а.",
        "does_not_mean": "Не показва посока. Пробивът може да е във всяка посока, а често е и фалшив (fakeout).",
        "common_mistake": "Да се предполага посока преди пробива или да се забравя, че в range inside bar-ове има "
        "постоянно.",
        "context_rule": "Има смисъл в тренд (пауза преди продължение) или при ниво. В шумен range е без значение.",
        "confirmation": "Затваряне извън диапазона на mother bar-а; внимавай за връщане обратно в диапазона.",
        "practice_hint": "Сравни High и Low със свещта преди: и двата вътре ли са?",
        "lesson": None,
    },
    "outside_bar": {
        "name": "Outside bar",
        "short": "Свещ, която надхвърля и High, и Low на предходната — разширяване на волатилността.",
        "looks_like": "High > предходния High и Low < предходния Low: свещта „обгръща“ целия диапазон на предишната.",
        "means": "Волатилността се разширява: пазарът е тествал и двете страни. Посоката се вижда от затварянето.",
        "does_not_mean": "Сама по себе си не казва посока — важно е къде затваря свещта и в какъв контекст.",
        "common_mistake": "Да се бърка с engulfing: engulfing сравнява телата, outside bar — целия диапазон (сенките).",
        "context_rule": "При ниво или след тренд показва борба между двете страни; затваряне близо до края на "
        "диапазона е по-информативно.",
        "confirmation": "Следващата свещ продължава в посоката на затварянето на outside bar-а.",
        "practice_hint": "Сравни сенките: и High, и Low ли са извън предишната свещ?",
        "lesson": None,
    },
    "morning_star": {
        "name": "Morning star",
        "short": "Три свещи след спад: дълга мечя, малко тяло, силна бича.",
        "looks_like": "1) дълга мечя свещ; 2) малко тяло ниско (≤ 35% от първото тяло); 3) бича свещ, която "
        "затваря над средата на първото тяло.",
        "means": "Спадът губи сила (малкото тяло), после купувачите си връщат голяма част от загубеното.",
        "does_not_mean": "Не потвърждава нов uptrend — показва само, че натискът на продавачите е отслабнал.",
        "common_mistake": "Да се приеме всяко малко тяло между две свещи за morning star, без третата свещ да "
        "затвори над средата на първата.",
        "context_rule": "Изисква предходен спад; при support е по-информативен.",
        "confirmation": "Продължение над High-а на третата свещ; invalidation под Low-а на средната свещ.",
        "practice_hint": "Брои три свещи: голяма надолу → малка → голяма нагоре над средата на първата.",
        "lesson": None,
    },
    "evening_star": {
        "name": "Evening star",
        "short": "Три свещи след покачване: дълга бича, малко тяло, силна меча.",
        "looks_like": "1) дълга бича свещ; 2) малко тяло високо (≤ 35% от първото тяло); 3) меча свещ, която "
        "затваря под средата на първото тяло.",
        "means": "Покачването губи сила (малкото тяло), после продавачите вземат голяма част от покачването.",
        "does_not_mean": "Не потвърждава нов downtrend — показва само, че натискът на купувачите е отслабнал.",
        "common_mistake": "Да се приеме всяко малко тяло между две свещи за evening star, без третата свещ да "
        "затвори под средата на първата.",
        "context_rule": "Изисква предходно покачване; при resistance е по-информативен.",
        "confirmation": "Продължение под Low-а на третата свещ; invalidation над High-а на средната свещ.",
        "practice_hint": "Брои три свещи: голяма нагоре → малка → голяма надолу под средата на първата.",
        "lesson": None,
    },
    "three_white_soldiers": {
        "name": "Three white soldiers",
        "short": "Три последователни силни бичи свещи с все по-високи затваряния.",
        "looks_like": "Три бичи свещи с тяло ≥ 50% от диапазона и малка горна сянка; всяка отваря в тялото на "
        "предишната и затваря по-високо.",
        "means": "Устойчив натиск от купувачите в продължение на три периода — след спад или range това е смяна "
        "на импулса.",
        "does_not_mean": "Не означава, че покачването ще продължи; след три големи свещи цената често е разтегната.",
        "common_mistake": "Да се купува след третата свещ далеч от ниво и без план за stop — голяма част от "
        "движението вече е станала.",
        "context_rule": "След спад или странично движение; след дълго покачване е по-скоро изтощение.",
        "confirmation": "Плитко връщане (pullback), което се задържа над средата на третата свещ.",
        "practice_hint": "Три бичи тела подред — всяко отваря в предишното тяло и затваря по-високо.",
        "lesson": None,
    },
    "three_black_crows": {
        "name": "Three black crows",
        "short": "Три последователни силни мечи свещи с все по-ниски затваряния.",
        "looks_like": "Три мечи свещи с тяло ≥ 50% от диапазона и малка долна сянка; всяка отваря в тялото на "
        "предишната и затваря по-ниско.",
        "means": "Устойчив натиск от продавачите в продължение на три периода — след покачване или range това е "
        "смяна на импулса.",
        "does_not_mean": "Не означава, че спадът ще продължи; след три големи свещи цената често е разтегната.",
        "common_mistake": "Да се продава след третата свещ далеч от ниво и без план за stop.",
        "context_rule": "След покачване или странично движение; след дълъг спад е по-скоро изтощение.",
        "confirmation": "Слабо връщане нагоре, което остава под средата на третата свещ.",
        "practice_hint": "Три мечи тела подред — всяко отваря в предишното тяло и затваря по-ниско.",
        "lesson": None,
    },
}
TEXT_FIELDS = (
    "looks_like",
    "means",
    "does_not_mean",
    "common_mistake",
    "context_rule",
    "confirmation",
    "practice_hint",
)


def _candle_dicts(rows: list[tuple[float, float, float, float]], decimals: int = 6) -> list[dict]:
    return [
        {
            "time": ILLUSTRATION_START + i * 86400,
            "open": round(o, decimals),
            "high": round(h, decimals),
            "low": round(lo, decimals),
            "close": round(c, decimals),
            "volume": 0.0,
        }
        for i, (o, h, lo, c) in enumerate(rows)
    ]


def _to_candles(rows: list[dict]) -> list[Candle]:
    return [Candle(r["time"], r["open"], r["high"], r["low"], r["close"], r.get("volume", 0.0)) for r in rows]


def _build_pattern(key: str) -> dict:
    d = PATTERN_DEFS[key]
    t = _TEXT[key]
    context, rows = ILLUSTRATIONS[key]
    ctx = _CONTEXTS[context]()
    candles = _candle_dicts(ctx + rows)
    start = len(ctx)
    trend_rule = {
        None: "any",
        "down": "down",
        "up": "up",
        "not_up": "down_or_flat",
        "not_down": "up_or_flat",
    }[d["trend"]]
    return {
        "key": key,
        "name": t["name"],
        "type": TYPE_OF_BARS[d["bars"]],
        "bars": d["bars"],
        "bias": d["bias"],
        "short": t["short"],
        **{f: t[f] for f in TEXT_FIELDS},
        "rule": d["rule"],
        "requires_trend": trend_rule,
        "context": context,
        "context_text": CONTEXT_TEXT[context],
        "candles": candles,
        "pattern_start": start,
        "highlight": list(range(start, len(candles))),
        "lesson": t["lesson"],
        "lesson_href": lesson_href(t["lesson"]) if t["lesson"] else None,
        "disclaimer": PATTERN_DISCLAIMER,
    }


PATTERNS: list[dict] = [_build_pattern(k) for k in DETECTABLE_PATTERNS]
PATTERNS_BY_KEY: dict[str, dict] = {p["key"]: p for p in PATTERNS}
PATTERN_KEYS: tuple[str, ...] = tuple(PATTERNS_BY_KEY)


def gallery() -> dict:
    """GET /api/learn/candlesticks."""
    return {
        "patterns": PATTERNS,
        "count": len(PATTERNS),
        "types": ["single", "double", "triple"],
        "biases": ["bullish", "bearish", "neutral", "context-dependent"],
        "disclaimer": PATTERN_DISCLAIMER,
    }


# ------------------------------------------------------------------------------------------ signed tokens
def sign_lab_token(payload: dict) -> str:
    """HMAC-signed, URL-safe token (base64 JSON + 32 hex MAC) — shared by the S3b labs."""
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    mac = hmac.new(get_settings().secret_key.encode(), b"s3b-lab|" + raw, hashlib.sha256).hexdigest()[:32]
    return base64.urlsafe_b64encode(raw).decode().rstrip("=") + "." + mac


def read_lab_token(token: str, kind: str, now: float | None = None) -> dict | None:
    """The payload of a valid, unexpired token of `kind` (payload["k"]), else None."""
    if not isinstance(token, str) or "." not in token or len(token) > 8000:
        return None
    try:
        body, mac = token.rsplit(".", 1)
        raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
    except (ValueError, TypeError):
        return None
    good = hmac.new(get_settings().secret_key.encode(), b"s3b-lab|" + raw, hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(good, mac):
        return None
    try:
        payload = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(payload, dict) or payload.get("k") != kind:
        return None
    if payload.get("exp", 0) < (time.time() if now is None else now):
        return None
    return payload


def _answer_mac(nonce: str, key: str) -> str:
    """Keyed hash of the correct answer — the token proves the answer without revealing it to the client."""
    msg = f"cl-answer|{nonce}|{key}".encode()
    return hmac.new(get_settings().secret_key.encode(), msg, hashlib.sha256).hexdigest()[:20]


# -------------------------------------------------------------------------------------------- practice
def detected_at_end(rows: list[dict]) -> set[str]:
    candles = _to_candles(rows)
    return {h.key for h in patterns_at(candles, len(candles) - 1)}


def _decimals_for(level: float) -> int:
    return max(2, min(8, 6 - int(math.floor(math.log10(level)))))


def _variant(key: str, rng: random.Random) -> list[dict]:
    """A randomised copy of the illustration (4–5 context candles, random price level, small jitter) that the
    detector still recognises as `key` on its last candle."""
    context, rows = ILLUSTRATIONS[key]
    ctx = _CONTEXTS[context]()[rng.randint(0, 1) :]
    base = ctx + rows
    level = 10 ** rng.uniform(-0.5, 4.5)
    factor = level / 100
    decimals = _decimals_for(level)
    for attempt in range(7):
        jitter = 0.04 if attempt < 6 else 0.0
        out = []
        for o, h, lo, c in base:
            r = h - lo
            o2 = o + rng.uniform(-jitter, jitter) * r
            c2 = c + rng.uniform(-jitter, jitter) * r
            h2 = max(h + rng.uniform(-jitter, jitter) * r, o2, c2)
            l2 = min(lo + rng.uniform(-jitter, jitter) * r, o2, c2)
            out.append((o2 * factor, h2 * factor, l2 * factor, c2 * factor))
        cand = _candle_dicts(out, decimals)
        if key in detected_at_end(cand):
            return cand
    return _candle_dicts(base)  # the base illustration is always recognised (tested)


def _options(key: str, excluded: set[str], rng: random.Random, n: int = 4) -> list[str]:
    pool = [k for k in CONFUSABLE[key] if k not in excluded and k != key]
    rng.shuffle(pool)
    picks = pool[: n - 1]
    rest = [k for k in PATTERN_KEYS if k != key and k not in excluded and k not in picks]
    rng.shuffle(rest)
    picks += rest[: n - 1 - len(picks)]
    opts = [key, *picks]
    rng.shuffle(opts)
    return opts


def practice_rounds(n: int = 10, *, seed: int | None = None, now: int | None = None) -> dict:
    """GET /api/learn/candlesticks/practice — `n` signed rounds (synthetic pattern + context, 4 options)."""
    n = max(1, min(int(n), PRACTICE_MAX_ROUNDS))
    rng = random.Random(seed if seed is not None else secrets.randbits(64))
    now = int(time.time()) if now is None else int(now)
    exp = now + PRACTICE_TTL
    set_id = f"{rng.getrandbits(64):016x}"
    keys = rng.sample(PATTERN_KEYS, min(n, len(PATTERN_KEYS)))
    while len(keys) < n:
        keys.append(rng.choice(PATTERN_KEYS))
    rounds = []
    for i, key in enumerate(keys):
        candles = _variant(key, rng)
        others = detected_at_end(candles) - {key}
        options = _options(key, others, rng)
        nonce = f"{rng.getrandbits(48):012x}"
        token = sign_lab_token(
            {"k": "cl", "s": set_id, "i": i, "t": n, "o": options, "n": nonce, "h": _answer_mac(nonce, key), "exp": exp}
        )
        rounds.append(
            {
                "index": i,
                "question": PRACTICE_QUESTION,
                "candles": candles,
                "options": [{"key": k, "name": PATTERNS_BY_KEY[k]["name"]} for k in options],
                "token": token,
            }
        )
    return {
        "set_id": set_id,
        "rounds": rounds,
        "total": n,
        "expires_ts": exp,
        "pass_score": _pass_score(),
        "module": _lab_module(),
        "disclaimer": PATTERN_DISCLAIMER,
    }


def _pass_score() -> float:
    from app.academy.content import PASS_SCORE

    return PASS_SCORE


def _lab_module() -> str:
    from app.services.learning_service import CANDLESTICK_LAB_QUIZ

    return CANDLESTICK_LAB_QUIZ


def _explain(expected: str, given: str | None) -> str:
    p = PATTERNS_BY_KEY[expected]
    if given == expected:
        return f"Вярно: {p['name']} — {p['short']} Правило: {p['rule']}"
    head = f"Това е {p['name']} — {p['short']} Правило: {p['rule']}"
    if not given:
        return f"Без отговор. {head}"
    g = PATTERNS_BY_KEY.get(given)
    if g is None:
        return f"Непознат отговор. {head}"
    return f"Не е {g['name']} ({g['short']}) {head}"


def grade_practice(answers: list[dict], *, now: float | None = None) -> dict:
    """Grade signed rounds. answers: [{token, answer: pattern key}]. Rounds of the set that were not answered count
    as wrong (score = correct / rounds in the set). Raises PracticeError when no round is valid."""
    results: list[dict] = []
    set_id: str | None = None
    total = 0
    seen: set[int] = set()
    for a in answers:
        token = a.get("token") if isinstance(a, dict) else None
        given = a.get("answer") if isinstance(a, dict) else None
        given = given.strip() if isinstance(given, str) and given.strip() else None
        payload = read_lab_token(token or "", "cl", now)
        if payload is None or (set_id is not None and payload.get("s") != set_id):
            results.append(
                {
                    "index": None,
                    "valid": False,
                    "correct": False,
                    "answer": given,
                    "expected": None,
                    "expected_name": None,
                    "explanation": "Невалиден или изтекъл рунд.",
                }
            )
            continue
        idx = int(payload.get("i", -1))
        if idx in seen:
            results.append(
                {
                    "index": idx,
                    "valid": False,
                    "correct": False,
                    "answer": given,
                    "expected": None,
                    "expected_name": None,
                    "explanation": "Този рунд вече е отговорен.",
                }
            )
            continue
        options = [k for k in payload.get("o", []) if k in PATTERNS_BY_KEY]
        expected = next((k for k in options if hmac.compare_digest(_answer_mac(payload["n"], k), payload["h"])), None)
        if expected is None:
            results.append(
                {
                    "index": idx,
                    "valid": False,
                    "correct": False,
                    "answer": given,
                    "expected": None,
                    "expected_name": None,
                    "explanation": "Невалиден рунд.",
                }
            )
            continue
        set_id = payload.get("s")
        total = max(total, int(payload.get("t", 0)))
        seen.add(idx)
        ok = given == expected
        results.append(
            {
                "index": idx,
                "valid": True,
                "correct": ok,
                "answer": given,
                "answer_name": PATTERNS_BY_KEY[given]["name"] if given in PATTERNS_BY_KEY else None,
                "expected": expected,
                "expected_name": PATTERNS_BY_KEY[expected]["name"],
                "bias": PATTERNS_BY_KEY[expected]["bias"],
                "explanation": _explain(expected, given),
            }
        )
    if set_id is None:
        raise PracticeError("Невалиден или изтекъл practice set — зареди нови рундове.")
    total = max(total, len(seen))
    correct = sum(1 for r in results if r["valid"] and r["correct"])
    score = correct / total if total else 0.0
    results.sort(key=lambda r: (r["index"] is None, r["index"] if r["index"] is not None else 0))
    return {
        "set_id": set_id,
        "results": results,
        "correct": correct,
        "answered": len(seen),
        "total": total,
        "score": round(score, 4),
        "score_pct": round(score * 100),
        "passed": score >= _pass_score(),
        "pass_score": _pass_score(),
    }


def submit_practice(db, user, answers: list[dict], *, now: float | None = None) -> dict:
    """POST /api/learn/candlesticks/practice — grade and store QuizResult(module="lab:candlesticks").

    A set can be stored once (PracticeAlreadySubmitted → 409)."""
    from sqlalchemy import select

    from app.models import QuizResult

    graded = grade_practice(answers, now=now)
    module = _lab_module()
    for prev in db.scalars(select(QuizResult).where(QuizResult.user_id == user.id, QuizResult.module == module)):
        if isinstance(prev.answers, dict) and prev.answers.get("set_id") == graded["set_id"]:
            raise PracticeAlreadySubmitted("Този practice set вече е предаден — зареди нови рундове.")
    row = QuizResult(
        user_id=user.id,
        module=module,
        score=graded["score"],
        correct=graded["correct"],
        total=graded["total"],
        passed=graded["passed"],
        answers={
            "set_id": graded["set_id"],
            "rounds": [
                {"i": r["index"], "given": r["answer"], "expected": r["expected"], "correct": r["correct"]}
                for r in graded["results"]
                if r["valid"]
            ],
        },
    )
    db.add(row)
    db.commit()
    return {**graded, "stored": True, "result_id": row.id, "module": module}


# -------------------------------------------------------------------------------------------- examples
def _r(x: float) -> float:
    """10 significant digits (drops binary noise such as 1180.7399999999907)."""
    return float(f"{x:.10g}")


def _atr_series(candles: list[Candle]) -> list[float | None]:
    from app import indicators as ind

    return ind.atr([c.high for c in candles], [c.low for c in candles], [c.close for c in candles], ATR_PERIOD)


def _horizon_stats(examples: list[dict]) -> list[dict]:
    out = []
    for i, h in enumerate(EXAMPLE_HORIZONS):
        moves = [e["next"][i] for e in examples if e["next"][i] is not None]
        atr_moves = [m["move_atr"] for m in moves if m["move_atr"] is not None]
        pct_moves = [m["move_pct"] for m in moves]
        n = len(moves)
        up = sum(1 for m in moves if m["direction"] == "up")
        down = sum(1 for m in moves if m["direction"] == "down")
        out.append(
            {
                "bars": h,
                "n": n,
                "median_move_atr": round(statistics.median(atr_moves), 3) if atr_moves else None,
                "median_move_pct": round(statistics.median(pct_moves), 3) if pct_moves else None,
                "pct_up": round(up / n * 100, 1) if n else None,
                "pct_down": round(down / n * 100, 1) if n else None,
            }
        )
    return out


def find_examples(candles: list[Candle], key: str, *, max_shown: int = EXAMPLES_MAX_SHOWN) -> dict:
    """Occurrences of `key` in `candles` (all CLOSED) with the move over the next 5/10 bars (pure, no I/O).

    move = close[i + h] − close[i]; move_atr = move / ATR(14) at the pattern bar; direction up/down/flat.
    Occurrences without h later bars have outcome null (they are still listed)."""
    if key not in PATTERN_DEFS:
        raise KeyError(key)
    atr = _atr_series(candles) if candles else []
    hits = detect_patterns(candles, [key])
    examples = []
    for hit in hits:
        i = hit.index
        c = candles[i]
        a = atr[i] if i < len(atr) else None
        nxt = []
        for h in EXAMPLE_HORIZONS:
            if i + h >= len(candles):
                nxt.append(None)
                continue
            move = candles[i + h].close - c.close
            nxt.append(
                {
                    "bars": h,
                    "close": candles[i + h].close,
                    "move": _r(move),
                    "move_pct": round(move / c.close * 100, 4) if c.close else 0.0,
                    "move_atr": round(move / a, 3) if a else None,
                    "direction": "up" if move > 0 else "down" if move < 0 else "flat",
                }
            )
        examples.append(
            {
                "time": c.ts,
                "start_time": candles[hit.start].ts,
                "index": i,
                "start_index": hit.start,
                "bars": hit.index - hit.start + 1,
                "prior_trend": hit.prior_trend,
                "close": c.close,
                "atr": _r(a) if a is not None else None,
                "next": nxt,
            }
        )
    stats = _horizon_stats(examples)
    n = stats[0]["n"] if stats else 0
    if not examples:
        note = (
            f"Няма случаи на този модел в последните {len(candles)} затворени свещи — пробвай друг инструмент или "
            "timeframe. Моделите с gap (piercing line, dark cloud cover) са редки при пазари, които търгуват 24/7."
        )
    elif n < EXAMPLES_SMALL_SAMPLE:
        note = f"Малка извадка ({n} случая с известен резултат) — статистиката е ненадеждна."
    else:
        note = f"{n} случая с известен резултат. Дори голяма извадка описва миналото, не бъдещето."
    shown = list(reversed(examples))[:max_shown]
    return {"total_found": len(examples), "examples": shown, "stats": stats, "sample_note": note}


def examples(key: str, symbol: str, timeframe: str, *, now: int, bars: int = EXAMPLES_DEFAULT_BARS) -> dict:
    """GET /api/learn/candlesticks/{key}/examples — recent occurrences on CLOSED candles (DATA_NOT_AVAILABLE safe:
    a provider problem gives available:false + code + reason instead of an error)."""
    from app.market.base import DataNotAvailableError
    from app.services import market_service

    p = PATTERNS_BY_KEY[key]
    spec = market_service.spec(symbol)
    base = {
        "key": key,
        "name": p["name"],
        "bias": p["bias"],
        "rule": p["rule"],
        "symbol": spec.symbol,
        "timeframe": timeframe,
        "precision": spec.price_precision,
        "horizons": list(EXAMPLE_HORIZONS),
        "atr_period": ATR_PERIOD,
        "disclaimer": EXAMPLES_DISCLAIMER,
    }
    empty_stats = [
        {"bars": h, "n": 0, "median_move_atr": None, "median_move_pct": None, "pct_up": None, "pct_down": None}
        for h in EXAMPLE_HORIZONS
    ]
    try:
        source = market_service.source_of(symbol)
        sec = tf_seconds(timeframe)
        rows = market_service.candles(symbol, timeframe, limit=bars, now=now, include_partial=False)
        closed = [c for c in rows if c.ts + sec <= now]
    except MarketDataError as exc:
        return {
            **base,
            "available": False,
            "code": exc.code if isinstance(exc, DataNotAvailableError) else "MARKET_DATA_ERROR",
            "reason": getattr(exc, "reason", None) or str(exc),
            "source": None,
            "candles": [],
            "total_found": 0,
            "examples": [],
            "stats": empty_stats,
            "sample_note": None,
        }
    found = find_examples(closed, key)
    return {
        **base,
        "available": bool(closed),
        "code": None if closed else "DATA_NOT_AVAILABLE",
        "reason": None if closed else "Няма затворени свещи от доставчика за този timeframe.",
        "source": source,
        "candles": [c.to_dict() for c in closed],
        **found,
    }
