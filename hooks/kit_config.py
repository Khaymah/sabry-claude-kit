"""
Shared configuration for every sabry-kit hook.

One source of truth for what the owner turned on or off, so the hooks, the setup
skill and the doctor never disagree. Resolution, lowest to highest:

    DEFAULTS  <  owner profile  <  <project>/.agents/profile.json  <  SABRY_KIT_<KEY> env

The owner profile is the newer of ~/.agents/profile.json and the `sabry-profile` skill
synced from claude.ai (uploaded once, it reaches every cloud environment and machine),
falling back to the SABRY_KIT_PROFILE_JSON environment variable.

`settings` holds the switches the hooks read. Everything else in a profile (name,
language, goals...) is free-form and only rendered into context by inject-rules.

Environment overrides use SABRY_KIT_<KEY> (for example SABRY_KIT_SOUNDS=0), so a
single session or a CI job can flip a switch without touching any file.

Every reader fails soft: a missing or broken profile means the defaults.
"""
import json
import os
import subprocess

DEFAULTS = {
    "project_storage": True,
    "keep_transcripts": True,
    "secret_scan": True,
    "install_git_hook": True,
    "sounds": True,
    "commit_style": True,
    "git_identity": True,
    "git_signing": True,
    "comment_discipline": True,
    "nextjs_structure": True,
    "duplication_warning": True,
    "team_review_reminder": True,
    "deal_economics": False,
    "usage_meter": True,
    "read_budget": True,
    "verify_reminder": True,
    "project_brief": True,
    "lessons": True,
}

STORAGE_DIR = ".agents"
FALSE = ("0", "false", "off", "no")


def home():
    return os.path.expanduser("~")


def user_profile_path():
    return os.environ.get("SABRY_KIT_PROFILE") or os.path.join(home(), STORAGE_DIR, "profile.json")


def project_root(cwd=None):
    """Git top-level of cwd, else cwd itself. None for the home directory or a
    filesystem root, so the kit never sprinkles .agents/ into places that are not
    projects."""
    cwd = cwd or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    root = cwd
    try:
        p = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True, timeout=5)
        if p.returncode == 0 and p.stdout.strip():
            root = p.stdout.strip()
    except Exception:
        pass
    root = os.path.abspath(root)
    if os.path.normcase(root) == os.path.normcase(os.path.abspath(home())):
        return None
    if os.path.dirname(root) == root:
        return None
    return root


def project_profile_path(root):
    return os.path.join(root, STORAGE_DIR, "profile.json") if root else None


def _load(path):
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


PROFILE_ENV = "SABRY_KIT_PROFILE_JSON"


def _env_profile():
    """The profile as JSON in an environment variable, for cloud sessions whose HOME is
    fresh every time (set it once on the cloud environment)."""
    raw = os.environ.get(PROFILE_ENV, "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


PROFILE_SKILL = "sabry-profile"


def profile_skill_dir():
    """The owner's profile uploaded once to claude.ai as a skill: Claude Code syncs it into
    every cloud session and every machine signed in with that account, so it needs no
    per-environment or per-machine setup. A hand-installed copy in ~/.claude/skills works too."""
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(home(), ".claude")
    import glob
    hits = glob.glob(os.path.join(config, "skills", "synced", "*", PROFILE_SKILL, "profile.json"))
    hits += glob.glob(os.path.join(config, "skills", PROFILE_SKILL, "profile.json"))
    hits = [h for h in hits if os.sep + ".trash" + os.sep not in h]
    return os.path.dirname(max(hits, key=os.path.getmtime)) if hits else None


def _skill_profile():
    d = profile_skill_dir()
    return _load(os.path.join(d, "profile.json")) if d else {}


def user_level_profile():
    """The owner's own profile: the newer (by its `updated` stamp) of the local file and
    the synced profile skill, else the SABRY_KIT_PROFILE_JSON fallback."""
    local, skill = _load(user_profile_path()), _skill_profile()
    if local and skill:
        return skill if str(skill.get("updated", "")) > str(local.get("updated", "")) else local
    return local or skill or _env_profile()


def load_profile(root=None):
    """Merged profile: the owner's user-level profile, then the project file on top.
    `settings` merges by key."""
    user = user_level_profile()
    proj = _load(project_profile_path(root))
    merged = dict(user)
    merged.update({k: v for k, v in proj.items() if k != "settings"})
    settings = dict(DEFAULTS)
    settings.update(user.get("settings") or {})
    settings.update(proj.get("settings") or {})
    merged["settings"] = settings
    return merged


def has_profile(root=None):
    return bool(user_level_profile()) or bool(_load(project_profile_path(root)))


def gate(key, payload):
    """True when the hook for `key` should run for this hook payload."""
    cwd = payload.get("cwd") if isinstance(payload, dict) else None
    try:
        return enabled(key, project_root(cwd))
    except Exception:
        return True


def enabled(key, root=None):
    env = os.environ.get("SABRY_KIT_" + key.upper())
    if env is not None and env.strip() != "":
        return env.strip().lower() not in FALSE
    value = load_profile(root)["settings"].get(key, DEFAULTS.get(key, True))
    return bool(value)
