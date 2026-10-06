#!/usr/bin/env python3
"""
PreToolUse hook — enforces Sabry's absolute rule: every subagent runs on Opus.

CLAUDE.md is advisory context, not an enforcement mechanism. Anthropic's own guidance:
"Absolute prohibitions require deterministic enforcement via hooks or managed settings,
not instructions." This hook is that mechanism.

Behaviour: if an Agent/Task call omits `model` or sets anything other than "opus",
the input is rewritten to opus via `updatedInput` and the call proceeds. Nothing is
blocked; the rule simply becomes impossible to violate.

Wired to: PreToolUse, matcher "Agent|Task".
"""
import json
import sys

ALLOWED = "opus"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0  # never break the turn on a malformed payload

    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return 0

    current = tool_input.get("model")
    if current == ALLOWED:
        return 0  # already compliant — stay silent

    patched = dict(tool_input)
    patched["model"] = ALLOWED

    was = "unset (would inherit)" if current is None else f'"{current}"'
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": patched,
        },
        "systemMessage": f"[enforce-opus] subagent model {was} -> opus",
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
