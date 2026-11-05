"""
Shared configuration for every sabry-kit hook.

One source of truth for what the owner turned on or off, so the hooks, the setup
skill and the doctor never disagree. Resolution, lowest to highest:

    DEFAULTS  <  ~/.agents/profile.json  <  <project>/.agents/profile.json  <  env

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
    "comment_discipline": True,
    "nextjs_structure": True,
    "duplication_warning": True,
    "team_review_reminder": True,
    "deal_economics": False,
    "usage_meter": True,
    "read_budget": True,
    "verify_reminder": True,
    "project_brief": True,
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


def load_profile(root=None):
    """Merged profile: user file (or the env profile when there is no file), then the
    project file on top. `settings` merges by key."""
    user = _load(user_profile_path()) or _env_profile()
    proj = _load(project_profile_path(root))
    merged = dict(user)
    merged.update({k: v for k, v in proj.items() if k != "settings"})
    settings = dict(DEFAULTS)
    settings.update(user.get("settings") or {})
    settings.update(proj.get("settings") or {})
    merged["settings"] = settings
    return merged


def has_profile(root=None):
    return (os.path.isfile(user_profile_path()) or bool(_env_profile())
            or bool(_load(project_profile_path(root))))


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
