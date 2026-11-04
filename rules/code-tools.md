# Code understanding tools (code-review-graph installed)

**Pick by task, not by a fixed order.**

| Task | Tool |
|---|---|
| "Where is X used?" · "where is this text?" | **Grep / Glob / Read** |
| "What breaks if I change X?" | `get_impact_radius_tool` |
| Review changes + risk score | `detect_changes_tool` → `get_review_context_tool` |
| "What is this project's structure?" | `get_architecture_overview_tool` |
| Semantic search | `semantic_search_nodes_tool` ⚠️ needs `pip install sentence-transformers` |
| Callers / callees / imports | `query_graph_tool` · `traverse_graph_tool` |
| Affected execution flows | `get_affected_flows_tool` |
| Rename planning / dead code | `refactor_tool` |
| Wide scan over many files | **Explore subagent** (`model: "sonnet"`) |

- Grep/Glob/Read are the default, not a last resort. Graph tools win on **impact and relationships**, not text search.
- ⚠️ **Verify before trusting:** `list_graph_stats_tool` — if `files_count` is far below the project size or `head_matches_build` is false, results are unreliable → `build_or_update_graph_tool` or read directly. A partial graph is worse than none.
- ⚠️ Check `/mcp` before relying on any MCP tool; never assume a tool you haven't seen.
