#!/usr/bin/env python3
"""
sabry-kit doctor - finds what in the owner's Claude Code setup fights the kit, and
fixes it only with consent, always reversibly.

    doctor.py scan [--json]          list findings (nothing is changed)
    doctor.py fix ID [ID...]         apply the fix of each finding, backup first
    doctor.py fix --all-safe         apply every finding whose fix is automatic
    doctor.py undo [STAMP]           restore the last (or a given) fix run
    doctor.py runs                   list fix runs that can be undone
    doctor.py brief                  SessionStart: one systemMessage line when a high-severity
                                     conflict exists, at most once a day

Looks at: user and project settings (hooks, env, attribution, memory switches,
cost knobs), every installed plugin (its hooks and the text of its skills, agents and
commands), ~/.claude/{agents,skills,commands}, project .claude/, CLAUDE.md files,
and the current repo's git hooks.

Every fix writes a backup and a manifest under ~/.agents/doctor/runs/<stamp>/ before
touching anything: edited files are copied, moved files are quarantined, removed
links are recorded. `undo` replays the manifest backwards.
"""
import datetime
import glob
import json
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT_HOOKS = ("enforce-commit-style", "enforce-comment-discipline", "enforce-nextjs-structure",
             "warn-duplication", "team-review-reminder", "inject-rules", "scan-secrets",
             "project-storage", "enforce-sonnet", "enforce-opus", "play.ps1", "play.py")
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2, "info": 3}

BUILTIN_COMMANDS = set("""
add-dir advisor agents allowed-tools android app artifacts auto-mode-setup autocompact
autofix-pr background bashes batch bg branch btw bug cd checkpoint checkup chrome clear
code-review color compact config context continue copy cost debug design desktop diff doctor
effort exit export extra-usage fast feedback fewer-permission-prompts focus fork goal heapdump
help hooks ide import init insights install-github-app install-slack-app ios keybindings
list-agents login logout loop mcp memory mobile model new output-style passes peers permissions
plan plugin powerup pr-comments privacy-settings proactive quit radio rate-limit-options rc recap
release-notes reload-plugins reload-skills remote-control remote-env rename reset restart resume
review rewind routines run sandbox schedule scroll-speed security-review settings setup-bedrock
setup-vertex share simplify skill-doctor skills slides stats status statusline stickers stop
subtask tasks team-onboarding teleport terminal-setup theme tp tui ultraplan ultrareview undo
update update-config upgrade usage usage-credits verify vim voice web-setup workflows
""".split())

THEMES = [
    ("memory", "project_storage",
     re.compile(r"(?is)\b(write|update|save|append|create|maintain)\b.{0,60}(MEMORY\.md|CLAUDE\.md|memory/|memories)"),
     "بيدير ذاكرة أو CLAUDE.md بطريقته الخاصة، فممكن يكتب برّه `.agents/` أو يكرّر ذاكرة المشروع"),
    ("attribution", "commit_style",
     re.compile(r"Co-Authored-By:\s*Claude|Generated with \[?Claude Code"),
     "بيطلب توقيع AI في الـ commits/PRs، وده بيتصادم مع `enforce-commit-style` فبيضيّع أدوار"),
    ("forced-workflow", None,
     re.compile(r"(?i)\b(you must|must always|always)\b.{0,40}\b(use|invoke|run|start with)\b.{0,40}"
                r"(brainstorm|writing-plans|executing-plans|test-driven|tdd|skill before)"),
     "بيفرض workflow إجباري على كل مهمة (brainstorm/plan/TDD)، وده بيتعارض مع وضع العمل في الـ profile وبيكلّف توكنز"),
    ("plans-elsewhere", "project_storage",
     re.compile(r"(?i)\b(docs/plans|docs/superpowers|\.plans/|plans/\d{4}-)"),
     "بيكتب الخطط في مسار تاني غير `.agents/plans/`"),
]


def config_dir():
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(kit_config.home(), ".claude")


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def read_text(path, limit=400_000):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read(limit)
    except OSError:
        return ""


def short(path):
    home = kit_config.home()
    return "~" + path[len(home):] if path.startswith(home) else path


def inside(path, root):
    try:
        return os.path.commonpath([os.path.realpath(path), os.path.realpath(root)]) == os.path.realpath(root)
    except ValueError:
        return False


class Scan:
    def __init__(self, cwd=None):
        self.root = kit_config.project_root(cwd)
        self.profile = kit_config.load_profile(self.root)
        self.settings = self.profile["settings"]
        self.findings = []
        self.user_settings_path = os.path.join(config_dir(), "settings.json")
        self.settings_files = [("user", self.user_settings_path)]
        if self.root:
            self.settings_files += [("project", os.path.join(self.root, ".claude", "settings.json")),
                                    ("local", os.path.join(self.root, ".claude", "settings.local.json"))]
        self.enabled_plugins = {}
        for _, p in self.settings_files:
            self.enabled_plugins.update(read_json(p).get("enabledPlugins") or {})

    def add(self, fid, severity, title, evidence, fix=None, why=""):
        if any(f["id"] == fid for f in self.findings):
            return
        self.findings.append({"id": fid, "severity": severity, "title": title, "evidence": evidence,
                              "why": why, "fix": fix or {"type": "manual"}})

    def run(self):
        for step in (self.check_settings, self.check_plugins, self.check_user_dirs, self.check_names,
                     self.check_claude_md, self.check_git_hooks):
            try:
                step()
            except Exception as e:
                self.add(f"doctor-error-{step.__name__}", "info", f"تعذّر فحص {step.__name__}", str(e))
        self.findings.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["id"]))
        return self.findings

    def check_settings(self):
        for scope, path in self.settings_files:
            data = read_json(path)
            if not data:
                continue
            label = short(path)
            if os.path.realpath(path) != path and inside(path, KIT):
                label += " (symlink لملف جوه الكيت)"
            for event, groups in (data.get("hooks") or {}).items():
                for gi, group in enumerate(groups or []):
                    matcher = group.get("matcher", "")
                    for hi, hook in enumerate(group.get("hooks") or []):
                        cmd = " ".join([hook.get("command", "")] + [str(a) for a in hook.get("args") or []])
                        where = {"file": path, "event": event, "group": gi, "hook": hi, "command": cmd}
                        name = next((k for k in KIT_HOOKS if k in cmd), None)
                        if event == "PreToolUse" and re.search(r"\b(Agent|Task)\b", matcher) and "model" in cmd.lower():
                            self.add(f"model-hook:{scope}:{event}:{gi}:{hi}", "high",
                                     "hook بيفرض موديل على كل الـ subagents",
                                     f"{label} · {event} `{matcher}` · {cmd[:90]}",
                                     {"type": "remove_hook", **where},
                                     "أي hook بيكتب `model` في استدعاء الـ Agent بيلغي `model:` اللي في frontmatter كل agent.")
                        elif name:
                            self.add(f"dup-hook:{scope}:{event}:{gi}:{hi}", "high" if re.search(r"[A-Za-z]:\\|powershell", cmd, re.I) else "medium",
                                     f"نسخة من hook الكيت `{name}` متسجلة في الإعدادات كمان",
                                     f"{label} · {event} · {cmd[:90]}",
                                     {"type": "remove_hook", **where},
                                     "الـ plugin بيسجّله أصلاً، فبيشتغل مرتين، ولو المسار خاص بجهاز معين بيفشل على أي جهاز تاني.")
                        elif re.search(r"[A-Za-z]:\\Users\\|/Users/[^/]+/|powershell\.exe", cmd):
                            self.add(f"machine-hook:{scope}:{event}:{gi}:{hi}", "low",
                                     "hook بمسار أو أداة خاصة بجهاز واحد",
                                     f"{label} · {event} · {cmd[:90]}", None,
                                     "مش هيشتغل على جهاز تاني أو في جلسة سحابية.")
            env = data.get("env") or {}
            if env.get("CLAUDE_CODE_SUBAGENT_MODEL") and env.get("CLAUDE_CODE_SUBAGENT_MODEL_FORCE") == "1":
                self.add(f"subagent-model-force:{scope}", "high", "`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` بيفرض موديل واحد على كل الـ subagents",
                         f"{label} · env", {"type": "settings_unset", "file": path, "keys": ["env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE"]},
                         "بيلغي `model:` في frontmatter الـ agents.")
            if self.settings.get("project_storage", True):
                if data.get("autoMemoryEnabled") is False or env.get("CLAUDE_CODE_DISABLE_AUTO_MEMORY") == "1":
                    self.add(f"automemory-off:{scope}", "high", "الـ auto memory مقفولة",
                             f"{label}", {"type": "settings_unset", "file": path,
                                          "keys": ["autoMemoryEnabled", "env.CLAUDE_CODE_DISABLE_AUTO_MEMORY"]},
                             "من غيرها مفيش `.agents/memory` ولا `memory:` في الـ agents بيشتغل.")
                if scope != "local" and data.get("autoMemoryDirectory"):
                    self.add(f"automemory-dir:{scope}", "medium", "`autoMemoryDirectory` متحدد في إعدادات عامة",
                             f"{label} · {data['autoMemoryDirectory']}",
                             {"type": "settings_unset", "file": path, "keys": ["autoMemoryDirectory"]},
                             "أي مشروع لسه ما اتجهّزش هيكتب ذاكرته هناك بدل `.agents/memory/`.")
            if data.get("disableAllHooks") is True:
                self.add(f"hooks-off:{scope}", "high", "`disableAllHooks` قافل كل الـ hooks", label,
                         {"type": "settings_unset", "file": path, "keys": ["disableAllHooks"]},
                         "كده ولا قاعدة من قواعد الكيت بتتنفذ ولا الـ profile بيتحقن.")
            if self.settings.get("commit_style", True):
                attr = data.get("attribution")
                bad = (isinstance(attr, dict) and (attr.get("commit") or attr.get("pr"))) or data.get("includeCoAuthoredBy") is True
                if bad or (scope == "user" and attr is None and "includeCoAuthoredBy" not in data):
                    self.add(f"attribution:{scope}", "medium" if bad else "low",
                             "Claude Code هيضيف توقيع AI في الـ commits والـ PRs",
                             f"{label} · attribution={json.dumps(attr, ensure_ascii=False) if attr is not None else 'الافتراضي'}",
                             {"type": "settings_set", "file": path, "values": {"attribution": {"commit": "", "pr": ""}}},
                             "`enforce-commit-style` هيرفض الـ commit فيعيد الـ agent كتابته: دور ضايع في كل commit.")
            if scope == "user":
                self.check_cost(data, label, path)

    def check_cost(self, data, label, path):
        cost = self.profile.get("cost_profile")
        if not cost:
            return
        effort = data.get("effortLevel")
        window = data.get("autoCompactWindow")
        env = data.get("env") or {}
        want = {"economy": ("medium", 160000), "balanced": ("high", 200000), "max": (None, None)}.get(cost)
        if not want or want[0] is None:
            return
        rank = {"low": 0, "medium": 1, "high": 2, "xhigh": 3, "max": 4}
        values = {}
        if effort and rank.get(effort, 0) > rank[want[0]]:
            values["effortLevel"] = want[0]
        if isinstance(window, int) and window > want[1]:
            values["autoCompactWindow"] = want[1]
        try:
            if int(env.get("CLAUDE_CODE_MAX_OUTPUT_TOKENS", "0")) > 32000:
                values["env.CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = "32000"
        except ValueError:
            pass
        if values:
            self.add("cost-knobs", "medium", f"إعدادات أغلى من اختيارك ({cost})",
                     f"{label} · " + " · ".join(f"{k}: {self._get(data, k)} ← {v}" for k, v in values.items()),
                     {"type": "settings_set", "file": path, "values": values},
                     "effort أعلى ونافذة compaction أكبر = توكنز أكتر في كل دور، حتى مع الـ cache.")

    @staticmethod
    def _get(data, dotted):
        cur = data
        for part in dotted.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        return cur

    def plugin_roots(self):
        base = os.path.join(config_dir(), "plugins")
        roots = []
        for manifest in glob.glob(os.path.join(base, "**", ".claude-plugin", "plugin.json"), recursive=True):
            rel = os.path.relpath(manifest, base).replace("\\", "/")
            if rel.startswith((".trash/", "marketplaces/", "data/")):
                continue
            root = os.path.dirname(os.path.dirname(manifest))
            meta = read_json(manifest)
            name = meta.get("name") or os.path.basename(root)
            parts = rel.split("/")
            if parts[0] == "cache" and len(parts) >= 4:
                key = f"{parts[2]}@{parts[1]}"
            else:
                side = read_json(os.path.join(os.path.dirname(root), name + ".meta.json"))
                key = f"{name}@{side.get('marketplace_name') or parts[0]}"
            roots.append({"root": root, "name": name, "key": key, "version": meta.get("version", "")})
        return roots

    def check_plugins(self):
        for p in self.plugin_roots():
            root, name, key = p["root"], p["name"], p["key"]
            if self.enabled_plugins.get(key) is False:
                continue
            if inside(root, KIT) or inside(KIT, root):
                continue
            disable = {"type": "disable_plugin", "file": self.user_settings_path, "key": key}
            hooks_file = os.path.join(root, "hooks", "hooks.json")
            hooks = read_json(hooks_file).get("hooks") or {}
            if name == "sabry-kit":
                stale = "enforce-opus" in json.dumps(hooks)
                self.add(f"kit-copy:{key}", "high", "نسخة تانية من sabry-kit متسطّبة",
                         f"{short(root)} · version {p['version'] or '?'}" + (" · فيها enforce-opus القديم" if stale else ""),
                         disable, "نسختين = كل hook وكل agent مرتين، والأقدم ممكن تلغي إصلاحات الأحدث.")
                continue
            blob = json.dumps(hooks)
            for event, groups in hooks.items():
                for group in groups or []:
                    if event == "PreToolUse" and re.search(r"\b(Agent|Task)\b", group.get("matcher", "")):
                        self.add(f"plugin-model-hook:{key}", "high", f"plugin `{name}` عنده hook على كل استدعاء Agent",
                                 f"{short(hooks_file)} · matcher `{group.get('matcher')}`", disable,
                                 "لو بيكتب `model` بيلغي frontmatter الـ agents.")
            if "SessionStart" in hooks:
                self.add(f"plugin-session-context:{key}", "low", f"plugin `{name}` بيشغّل hook في أول كل جلسة",
                         f"{name}: hooks/hooks.json", disable,
                         "لو بيحقن context كبير، بتدفعه في كل جلسة. اتأكد إنه محتاجه.")
            text_files = [f for pat in ("skills/**/*.md", "agents/**/*.md", "commands/**/*.md", "CLAUDE.md")
                          for f in glob.glob(os.path.join(root, pat), recursive=True)]
            corpus = {f: read_text(f, 60_000) for f in text_files}
            corpus[hooks_file] = blob
            for theme, switch, rx, why in THEMES:
                if switch and not self.settings.get(switch, True):
                    continue
                hits = [f for f, t in corpus.items() if t and rx.search(t)]
                if hits:
                    sev = "medium" if theme in ("memory", "attribution", "forced-workflow") else "low"
                    self.add(f"plugin-{theme}:{key}", sev, f"plugin `{name}`: {why.split('،')[0]}",
                             f"{name}: " + ", ".join(os.path.relpath(h, root).replace("\\", "/") for h in hits[:3])
                             + (f" (+{len(hits) - 3})" if len(hits) > 3 else ""),
                             disable, why)

    @staticmethod
    def command_names(root):
        """Slash-command names a plugin or config dir exposes: skill folders and command files."""
        names = {}
        for skill in glob.glob(os.path.join(root, "skills", "*", "SKILL.md")):
            text = read_text(skill, 2000)
            m = re.search(r"^name:\s*['\"]?([\w.-]+)", text, re.M)
            names[(m.group(1) if m else os.path.basename(os.path.dirname(skill))).lower()] = skill
        for cmd in glob.glob(os.path.join(root, "commands", "**", "*.md"), recursive=True):
            names[os.path.splitext(os.path.basename(cmd))[0].lower()] = cmd
        return names

    def check_names(self):
        """A bare `/name` resolves to a built-in first, and a name shared with another plugin
        makes both the slash menu and the model's skill choice ambiguous."""
        kit = self.command_names(KIT)
        for name, path in sorted(kit.items()):
            if name in BUILTIN_COMMANDS:
                self.add(f"name-builtin:{name}", "medium", f"أمر الكيت `{name}` بنفس اسم أمر مدمج في Claude Code",
                         f"/{name} بيشغّل المدمج · {short(path)}", None,
                         f"استخدم `/sabry-kit:{name}`، أو غيّر اسم الـ skill في الكيت لاسم مميّز.")
        others = []
        for p in self.plugin_roots():
            if (inside(p["root"], KIT) or inside(KIT, p["root"]) or p["name"] == "sabry-kit"
                    or self.enabled_plugins.get(p["key"]) is False):
                continue
            others.append((p["name"], p["key"], p["root"]))
        for name, key, root in others:
            clash = sorted(set(kit) & set(self.command_names(root)))
            for n in clash:
                self.add(f"name-clash:{n}:{key}", "low", f"`{n}` موجود في الكيت وفي plugin `{name}`",
                         f"/sabry-kit:{n} · /{name}:{n}", None,
                         f"لما تكتب `/{n}` أو تقول اسمه بس، ممكن يشتغل بتاع `{name}`. استخدم الاسم الكامل `/sabry-kit:{n}`.")

    def check_user_dirs(self):
        cdir = config_dir()
        kit_names = {"agents": {os.path.splitext(f)[0] for f in os.listdir(os.path.join(KIT, "agents")) if f.endswith(".md")},
                     "skills": {d for d in os.listdir(os.path.join(KIT, "skills"))}}
        for kind in ("agents", "skills", "commands", "hooks", "rules"):
            path = os.path.join(cdir, kind)
            if os.path.islink(path) and inside(os.path.realpath(path), KIT):
                if kind in ("agents", "skills", "hooks"):
                    self.add(f"kit-symlink:{kind}", "high", f"`~/.claude/{kind}` symlink لمجلد الكيت",
                             f"{short(path)} → {short(os.path.realpath(path))}",
                             {"type": "unlink", "path": path},
                             "الـ plugin بيجيبهم أصلاً، فكل agent/skill بيظهر مرتين.")
                continue
            if kind not in kit_names or not os.path.isdir(path):
                continue
            for entry in os.listdir(path):
                base = os.path.splitext(entry)[0]
                if base in kit_names[kind]:
                    full = os.path.join(path, entry)
                    self.add(f"dup-{kind}:{base}", "medium", f"{kind[:-1]} `{base}` موجود عندك وفي الكيت",
                             short(full), {"type": "quarantine", "path": full},
                             "الاتنين بيظهروا للموديل، وممكن يختار النسخة القديمة.")

    def check_claude_md(self):
        files = [os.path.join(config_dir(), "CLAUDE.md")]
        if self.root:
            files += [os.path.join(self.root, "CLAUDE.md"), os.path.join(self.root, ".claude", "CLAUDE.md"),
                      os.path.join(self.root, "AGENTS.md")]
        rules = []
        if self.settings.get("commit_style", True):
            rules.append((re.compile(r"Co-Authored-By|Generated with Claude"), "بيطلب توقيع AI في الـ commits"))
        if self.settings.get("comment_discipline", True):
            rules.append((re.compile(r"(?i)\b(add|write|always use|document with)\b.{0,30}\b(jsdoc|docstrings?|comments)\b"),
                          "بيطلب كومنتات/JSDoc وقاعدة الكيت بتمنعها"))
        rules.append((re.compile(r"(?i)model\s*[:=]?\s*[\"']?haiku|use haiku"), "بيطلب haiku"))
        for path in files:
            if inside(path, KIT):
                continue
            text = read_text(path)
            for no, line in enumerate(text.splitlines(), 1):
                for rx, why in rules:
                    if rx.search(line):
                        self.add(f"claude-md:{short(path)}:{no}", "low", f"{os.path.basename(path)} {why}",
                                 f"{short(path)}:{no} · {line.strip()[:100]}", None,
                                 "الـ profile بيغلبه، بس التعليمتين المتعارضتين بيضيّعوا توكنز وأحياناً بيلخبطوا الموديل. عدّل السطر بإيدك.")

    def check_git_hooks(self):
        if not self.root or not self.settings.get("secret_scan", True):
            return
        try:
            hp = subprocess.run(["git", "-C", self.root, "config", "--get", "core.hooksPath"],
                                capture_output=True, text=True, timeout=5).stdout.strip()
            gdir = subprocess.run(["git", "-C", self.root, "rev-parse", "--absolute-git-dir"],
                                  capture_output=True, text=True, timeout=5).stdout.strip()
        except Exception:
            return
        if not gdir:
            return
        if hp:
            self.add("secret-scan:hookspath", "medium", "فحص الأسرار مش متركّب في المشروع ده",
                     f"core.hooksPath = {hp} (husky أو مشابه)", None,
                     f"ضيف السطر ده لـ pre-commit بتاعك: `python3 \"{os.path.join(KIT, 'hooks', 'scan-secrets.py')}\" --git-pre-commit`. "
                     "الـ hook بتاع Claude Code لسه بيفحص الـ commits اللي الـ agent بيعملها.")
            return
        pre = os.path.join(gdir, "hooks", "pre-commit")
        if os.path.isfile(pre) and "Installed by sabry-kit" not in read_text(pre):
            self.add("secret-scan:foreign-pre-commit", "low", "المشروع عنده pre-commit خاص بيه، ففحص الأسرار مش فيه",
                     short(pre), None,
                     f"ضيف في آخره: `python3 \"{os.path.join(KIT, 'hooks', 'scan-secrets.py')}\" --git-pre-commit || exit 1`.")


def runs_dir():
    return os.path.join(kit_config.home(), kit_config.STORAGE_DIR, "doctor", "runs")


class Fixer:
    def __init__(self):
        self.stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        self.dir = os.path.join(runs_dir(), self.stamp)
        self.manifest = []
        self.backed_up = set()

    def backup(self, path):
        if path in self.backed_up:
            return
        self.backed_up.add(path)
        os.makedirs(self.dir, exist_ok=True)
        dst = os.path.join(self.dir, "files", str(len(self.backed_up)))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.isfile(path):
            shutil.copy2(path, dst)
            self.manifest.append({"op": "restore", "path": path, "backup": dst})
        else:
            self.manifest.append({"op": "delete", "path": path})

    def edit_json(self, path, fn):
        real = os.path.realpath(path)
        self.backup(real)
        data = read_json(real)
        fn(data)
        os.makedirs(os.path.dirname(real), exist_ok=True)
        with open(real, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")

    @staticmethod
    def set_dotted(data, dotted, value):
        parts = dotted.split(".")
        cur = data
        for part in parts[:-1]:
            cur = cur.setdefault(part, {})
        cur[parts[-1]] = value

    @staticmethod
    def unset_dotted(data, dotted):
        parts = dotted.split(".")
        cur = data
        for part in parts[:-1]:
            cur = cur.get(part) if isinstance(cur, dict) else None
            if cur is None:
                return
        if isinstance(cur, dict):
            cur.pop(parts[-1], None)

    def apply(self, finding):
        fix = finding["fix"]
        t = fix["type"]
        if t == "settings_set":
            self.edit_json(fix["file"], lambda d: [self.set_dotted(d, k, v) for k, v in fix["values"].items()])
        elif t == "settings_unset":
            self.edit_json(fix["file"], lambda d: [self.unset_dotted(d, k) for k in fix["keys"]])
        elif t == "disable_plugin":
            self.edit_json(fix["file"], lambda d: d.setdefault("enabledPlugins", {}).__setitem__(fix["key"], False))
        elif t == "remove_hook":
            def drop(d):
                groups = (d.get("hooks") or {}).get(fix["event"]) or []
                if fix["group"] < len(groups):
                    hooks = groups[fix["group"]].get("hooks") or []
                    if fix["hook"] < len(hooks):
                        hooks[fix["hook"]] = None
            self.edit_json(fix["file"], drop)
        elif t == "quarantine":
            src = fix["path"]
            dst = os.path.join(self.dir, "quarantine", os.path.basename(src))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(src, dst)
            self.manifest.append({"op": "move_back", "path": src, "backup": dst})
        elif t == "unlink":
            target = os.readlink(fix["path"])
            os.remove(fix["path"])
            self.manifest.append({"op": "relink", "path": fix["path"], "target": target})
        else:
            return False
        return True

    def finish(self):
        for entry in self.manifest:
            if entry["op"] == "restore" and entry["path"].endswith(".json"):
                data = read_json(entry["path"])
                for event, groups in list((data.get("hooks") or {}).items()):
                    for g in groups:
                        g["hooks"] = [h for h in g.get("hooks") or [] if h is not None]
                    data["hooks"][event] = [g for g in groups if g.get("hooks")]
                    if not data["hooks"][event]:
                        del data["hooks"][event]
                if "hooks" in data and not data["hooks"]:
                    del data["hooks"]
                with open(entry["path"], "w", encoding="utf-8", newline="\n") as fh:
                    json.dump(data, fh, indent=2, ensure_ascii=False)
                    fh.write("\n")
        if self.manifest:
            with open(os.path.join(self.dir, "manifest.json"), "w", encoding="utf-8") as fh:
                json.dump(self.manifest, fh, indent=2, ensure_ascii=False)
        return self.stamp if self.manifest else None


def undo(stamp=None):
    base = runs_dir()
    stamps = sorted(d for d in os.listdir(base) if os.path.isfile(os.path.join(base, d, "manifest.json"))) if os.path.isdir(base) else []
    if not stamps:
        print("مفيش إصلاحات تترجع.")
        return 1
    stamp = stamp or stamps[-1]
    manifest = read_json_list(os.path.join(base, stamp, "manifest.json"))
    for entry in reversed(manifest):
        op, path = entry["op"], entry["path"]
        if op == "restore":
            shutil.copy2(entry["backup"], path)
        elif op == "delete" and os.path.exists(path):
            os.remove(path)
        elif op == "move_back":
            os.makedirs(os.path.dirname(path), exist_ok=True)
            shutil.move(entry["backup"], path)
        elif op == "relink" and not os.path.lexists(path):
            os.symlink(entry["target"], path, target_is_directory=True)
    os.rename(os.path.join(base, stamp, "manifest.json"), os.path.join(base, stamp, "manifest.undone.json"))
    print(f"رجعت إصلاحات {stamp} ({len(manifest)} خطوة).")
    return 0


def read_json_list(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except Exception:
        return []


ICON = {"high": "🔴", "medium": "🟠", "low": "🟡", "info": "⚪"}


def print_table(findings):
    if not findings:
        print("✅ مفيش تعارضات.")
        return
    for f in findings:
        auto = "" if f["fix"]["type"] == "manual" else "  [fix: " + f["fix"]["type"] + "]"
        print(f"{ICON[f['severity']]} {f['id']}{auto}\n   {f['title']}\n   {f['evidence']}")
        if f["why"]:
            print(f"   ↳ {f['why']}")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "scan"
    if cmd == "scan":
        findings = Scan().run()
        if "--json" in args:
            print(json.dumps(findings, indent=2, ensure_ascii=False))
        else:
            print_table(findings)
        return 0
    if cmd == "fix":
        findings = {f["id"]: f for f in Scan().run()}
        ids = [f for f, v in findings.items() if v["fix"]["type"] != "manual"] if "--all-safe" in args else args[1:]
        fixer = Fixer()
        done, skipped = [], []
        for fid in ids:
            f = findings.get(fid)
            if not f or f["fix"]["type"] == "manual":
                skipped.append(fid)
                continue
            try:
                if fixer.apply(f):
                    done.append(fid)
            except Exception as e:
                skipped.append(f"{fid} ({e})")
        stamp = fixer.finish()
        print(json.dumps({"fixed": done, "skipped": skipped, "undo": f"doctor.py undo {stamp}" if stamp else None},
                         indent=2, ensure_ascii=False))
        return 0
    if cmd == "undo":
        return undo(args[1] if len(args) > 1 else None)
    if cmd == "brief":
        try:
            json.load(sys.stdin)
        except Exception:
            pass
        mark = os.path.join(kit_config.home(), kit_config.STORAGE_DIR, "doctor", "last-brief")
        today = datetime.date.today().isoformat()
        if read_text(mark).strip() == today:
            return 0
        high = [f for f in Scan().run() if f["severity"] == "high"]
        os.makedirs(os.path.dirname(mark), exist_ok=True)
        with open(mark, "w", encoding="utf-8") as fh:
            fh.write(today)
        if high:
            print(json.dumps({"systemMessage": f"[sabry-kit doctor] {len(high)} تعارض خطير مع الكيت "
                              f"({high[0]['title']}{'…' if len(high) > 1 else ''}). شغّل /sabry-kit:kit-doctor"}, ensure_ascii=False))
        return 0
    if cmd == "runs":
        base = runs_dir()
        for d in sorted(os.listdir(base)) if os.path.isdir(base) else []:
            state = "قابل للرجوع" if os.path.isfile(os.path.join(base, d, "manifest.json")) else "اترجع"
            print(f"{d}  {state}")
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
