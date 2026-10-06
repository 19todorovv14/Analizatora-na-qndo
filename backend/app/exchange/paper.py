"""PaperExchangeAdapter — simulates an exchange entirely in-process.

create_order() NEVER sends anything over the network: it is executed by the
PaperBroker against market data and stored in the paper_* tables.
"""

from __future__ import annotations

import time

from sqlalchemy.orm import Session

from app.exchange.base import ExchangeAdapter
from app.models import PaperAccount, User
from app.services import market_service, paper_service


class PaperExchangeAdapter(ExchangeAdapter):
    name = "paper"
    is_live = False

    def __init__(self, db: Session, user: User, account: PaperAccount, clock=time.time):
        self.db = db
        self.user = user
        self.account = account
        self.clock = clock

    def _now(self) -> int:
        return int(self.clock())

    def get_balance(self) -> dict:
        broker = paper_service.sync_account(self.db, self.account, self._now())
        snap = broker.snapshot()
        return {
            "currency": self.account.currency,
            "balance": snap["balance"],
            "equity": snap["equity"],
            "free_margin": snap["free_margin"],
            "virtual": True,
        }

    def get_positions(self) -> list[dict]:
        broker = paper_service.sync_account(self.db, self.account, self._now())
        return [paper_service.position_to_dict(p, broker) for p in broker.open_positions()]

    def get_ticker(self, symbol: str) -> dict:
        return market_service.ticker(symbol, now=self._now()).to_dict()

    def get_ohlcv(self, symbol: str, timeframe: str, limit: int = 500) -> list[dict]:
        return [c.to_dict() for c in market_service.candles(symbol, timeframe, limit=limit, now=self._now())]

    def create_order(self, **order) -> dict:
        return paper_service.place_order(self.db, self.user, self.account, order, self._now())

    def cancel_order(self, order_id: str) -> dict:
        return paper_service.cancel_order(self.db, self.user, self.account, order_id, self._now())


class PaperExecutionAdapter(PaperExchangeAdapter):
    """V2 name of the paper execution venue (identical behaviour: simulated fills, virtual funds only)."""
