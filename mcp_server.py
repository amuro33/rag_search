"""FastMCP tools for RAG search evaluation.

Only the MCP tool surface is implemented here. Fill in `fetch_api_registry_rows`
with your real database access code.
"""

from typing import Any

from fastmcp import FastMCP

mcp = FastMCP("rag-search")


async def fetch_api_registry_rows(limit: int = 500, offset: int = 0) -> list[dict[str, Any]]:
    """Fetch rows from api_registry.

    TODO: Replace this placeholder with the real DB query.

    Expected SQL shape:

        SELECT query_id, content, app, tables, author
        FROM api_registry
        ORDER BY query_id
        LIMIT :limit OFFSET :offset;

    Expected returned row shape:

        {
            "query_id": "API_NAME",
            "content": "description\\nsummary\\nx-question1\\nx-question2\\nx-question3",
            "app": "dac",
            "tables": "table_a,table_b",
            "author": "name",
        }
    """
    raise NotImplementedError("Implement fetch_api_registry_rows() with your DB access code.")


def normalize_api_registry_row(row: dict[str, Any]) -> dict[str, str]:
    """Keep the tool response stable even if DB values are nullable."""
    return {
        "query_id": str(row.get("query_id") or ""),
        "content": str(row.get("content") or ""),
        "app": str(row.get("app") or ""),
        "tables": str(row.get("tables") or ""),
        "author": str(row.get("author") or ""),
    }


@mcp.tool()
async def list_api_registry(limit: int = 500, offset: int = 0) -> dict[str, Any]:
    """List api_registry rows used by the RAG search evaluation UI.

    The UI expects rows with query_id, content, app, tables, and author. The
    content field should contain five lines: description, summary, and three
    x-question lines.
    """
    if limit < 1:
        limit = 1
    if limit > 1000:
        limit = 1000
    if offset < 0:
        offset = 0

    rows = await fetch_api_registry_rows(limit=limit, offset=offset)
    normalized = [
        normalize_api_registry_row(row)
        for row in rows
        if row.get("query_id") and row.get("content")
    ]

    return {
        "rows": normalized,
        "count": len(normalized),
        "limit": limit,
        "offset": offset,
    }


if __name__ == "__main__":
    mcp.run()
