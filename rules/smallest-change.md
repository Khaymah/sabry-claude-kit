# Smallest complete change — when writing code

Read the task and the code it touches first. List every place the change must reach (callers, tests, fixtures, config, exports) and what it could break for users. That is the scope; extra features are not.

Then take the first rung that fully works:

1. **Does it need to exist?** Skip options and flexibility nobody asked for; name them in one line.
2. **Already in this codebase** (helper, component, service, pattern)? Use it the way the surrounding code does.
3. **Standard library or a platform feature?** Use it, unless the project has its own; a house component beats a native widget.
4. **An installed dependency?** Use it. Never add a dependency for a few lines.
5. **One line a reader gets at a glance?** One line.
6. Otherwise, **the minimum code that works.**

- Lazy about the solution, never about the change: finish every caller, test and fixture it breaks. Keep the codebase's layers and conventions; no wrapper, option, config or "for later" code nobody asked for. Deletion beats addition. A one-liner that needs decoding is not short.
- **Bug fix:** grep every caller of the function first, then fix the root cause once, in the shared code.
- **New logic** with a branch, a loop, a parser, money or security leaves one small test.
- **A deliberate shortcut** with a known limit: `// shortcut: <the limit>, <when to upgrade>`.
- **Never cut:** validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything the owner asked for.
- End the reply with one or two lines: what you skipped or did not check, and any risk the owner must know.

In CTO mode the same ladder shapes the plan you propose.
