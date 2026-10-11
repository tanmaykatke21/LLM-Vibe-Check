"""Tiny stand-in for the database helpers q()/one(): answers by matching a substring of the SQL."""
class FakeDB:
    def __init__(self, answers: list[tuple[str, object]]):
        self.answers = answers          # [(sql substring, result or callable(sql, params) -> result)]
        self.calls: list[tuple[str, tuple]] = []
    def _answer(self, sql, params):
        self.calls.append((sql, params))
        for needle, res in self.answers:
            if needle in sql:
                return res(sql, params) if callable(res) else res
        return []
    def q(self, sql, params=None):
        res = self._answer(sql, params)
        return res if isinstance(res, list) else ([res] if res else [])
    def one(self, sql, params=None):
        res = self._answer(sql, params)
        if isinstance(res, list):
            return res[0] if res else None
        return res
    def writes(self, needle):
        return [p for s, p in self.calls if needle in s]
