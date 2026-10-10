import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from app.config import DATABASE_URL

_pool: ConnectionPool | None = None

def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=8,
                               kwargs={"row_factory": dict_row, "autocommit": True})
    return _pool

def q(sql: str, params=None):
    """Run a query and return list of dict rows (empty list for statements)."""
    with pool().connection() as conn:
        cur = conn.execute(sql, params or ())
        if cur.description:
            return cur.fetchall()
        return []

def one(sql: str, params=None):
    rows = q(sql, params)
    return rows[0] if rows else None
