import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const HOOKS = path.join(KIT, "hooks")
const CACHE_MS = 60000
const CHECKS = {
  Bash: ["enforce-commit-style.py", "scan-secrets.py"],
  Write: ["enforce-comment-discipline.py", "enforce-nextjs-structure.py"],
  Edit: ["enforce-comment-discipline.py", "enforce-nextjs-structure.py"],
}
const cache = new Map()
let python = null

function run(script, args, payload) {
  const candidates = python ? [python] : [process.env.SABRY_KIT_PYTHON, "python3", "python"].filter(Boolean)
  for (const candidate of candidates) {
    const result = spawnSync(candidate, [path.join(HOOKS, script), ...args], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 30000,
    })
    if (result.error && result.error.code === "ENOENT") continue
    python = candidate
    return result.stdout || ""
  }
  return ""
}

function parse(text) {
  try {
    return text && text.trim() ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export function rules(cwd) {
  const hit = cache.get(cwd)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text
  const parts = []
  for (let part = 1; part <= 4; part++) {
    const out = parse(run("inject-rules.py", ["--part", String(part)], { hook_event_name: "SessionStart", cwd }))
    const text = out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext
    if (text) parts.push(text)
  }
  const text = parts.join("\n\n")
  cache.set(cwd, { at: Date.now(), text })
  return text
}

export function toClaude(tool, args) {
  const name = String(tool || "").toLowerCase()
  const input = args || {}
  const file = input.filePath ?? input.file_path ?? input.path
  if (name === "bash" || name === "shell") return { tool_name: "Bash", tool_input: { command: String(input.command ?? "") } }
  if (name === "write") return { tool_name: "Write", tool_input: { file_path: file, content: input.content ?? "" } }
  if (name === "edit")
    return {
      tool_name: "Edit",
      tool_input: { file_path: file, old_string: input.oldString ?? input.old_string ?? "", new_string: input.newString ?? input.new_string ?? "" },
    }
  if (name === "patch" || name === "apply_patch")
    return { tool_name: "apply_patch", tool_input: { command: String(input.patchText ?? input.patch ?? input.input ?? "") } }
  return null
}

function reasonOf(out) {
  if (!out) return null
  const hso = out.hookSpecificOutput || {}
  if (hso.permissionDecision === "deny") return hso.permissionDecisionReason || "Blocked by sabry-kit."
  if (out.decision === "block" || out.decision === "deny") return out.reason || "Blocked by sabry-kit."
  return null
}

export function check(tool, args, cwd) {
  const call = toClaude(tool, args)
  if (!call) return null
  if (call.tool_name === "apply_patch") {
    for (const script of CHECKS.Write) {
      const out = parse(run("adapt.py", ["codex", script], { hook_event_name: "PreToolUse", cwd, ...call }))
      const reason = reasonOf(out)
      if (reason) return reason
    }
    return null
  }
  for (const script of CHECKS[call.tool_name] || []) {
    const reason = reasonOf(parse(run(script, [], { hook_event_name: "PreToolUse", cwd, ...call })))
    if (reason) return reason
  }
  return null
}

function addRules(push) {
  const text = rules(process.cwd())
  if (text) push(text)
}

function guard(tool, args) {
  const reason = check(tool, args, process.cwd())
  if (reason) throw new Error(reason)
}

export default {
  id: "sabry-kit",

  async setup(ctx) {
    const withRules = (event) => addRules((text) => event.system.push({ type: "text", text }))
    await ctx.session.hook("context", withRules)
    await ctx.session.hook("compaction", withRules)
    await ctx.tool.hook("execute.before", (event) => guard(event.tool, event.input))
  },

  async server() {
    return {
      "experimental.chat.system.transform": async (_input, output) => addRules((text) => output.system.push(text)),
      "tool.execute.before": async (input, output) => guard(input && input.tool, output && output.args),
    }
  },
}
