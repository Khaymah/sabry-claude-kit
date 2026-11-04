#!/usr/bin/env python3
"""
The owner's profile: the answers from /sabry-kit:setup, injected first in every
session as the highest-priority instructions.

    ~/.agents/profile.json          answers + switches (every project on this machine)
    ~/.agents/profile.md            optional free-form personal context (goals,
                                    constraints, hosting...), read on demand
    <project>/.agents/profile.json  optional per-project override, same shape

CLI (used by the setup skill, so it never edits JSON by hand):

    kit_profile.py show                 merged profile as JSON
    kit_profile.py path                 where the user profile lives
    kit_profile.py set '<json>'         deep-merge into the user profile (settings merge by key)
    kit_profile.py set --project '<json>'   same, into <project>/.agents/profile.json
    kit_profile.py context '<markdown>'     write ~/.agents/profile.md
    kit_profile.py render               the block inject-rules puts at the top of context
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config

LANG = {
    "ar-eg": "العربية بالمصري، والمصطلحات التقنية بالإنجليزي",
    "ar": "العربية الفصحى، والمصطلحات التقنية بالإنجليزي",
    "en": "English",
}
VERBOSITY = {
    "concise": "مختصر ومباشر: بلا مقدمات ولا تكرار، جداول وbullets، توصية واحدة في الآخر",
    "balanced": "متوسط: الخلاصة الأول وبعدها التفاصيل اللي تلزم",
    "detailed": "مفصّل: اشرح الأسباب والبدائل",
}
MODE = {
    "cto-pm": "CTO + PM: حلّل وخطّط وراجع، **ولا تكتب كود إلا بإذن صريح** (\"نفّذ\" / \"implement\")",
    "direct": "تنفيذ مباشر: نفّذ المطلوب من غير ما تستنى إذن، وقف بس قبل أي حاجة صعب الرجوع فيها",
}
QUESTIONS = {
    "ask": "عند أي غموض اسأل بـ `AskUserQuestion` (خيارات + trade-off لكل خيار) قبل ما تبدأ",
    "assume": "عند الغموض افترض الأرجح وكمّل، واكتب الافتراضات في آخر الرد",
}
COST = {
    "economy": "اقتصادي: أقل توكنز ممكن. sonnet للـ subagents، ما تفوّضش إلا للمسح الواسع، ردود قصيرة",
    "balanced": "متوازن: الجودة أولاً من غير هدر. sonnet للـ subagents، ما تعيدش قراءة ملفات اتقرت",
    "max": "أقصى جودة: التكلفة مش قيد. تحقق مستقل ومراجعات متوازية لما تفيد",
}
SWITCH_LABELS = {
    "commit_style": "commits بالإنجليزي وبلا توقيع AI",
    "comment_discipline": "كود بلا كومنتات",
    "nextjs_structure": "هيكل Next.js (حد 600 سطر · PascalCase)",
    "duplication_warning": "تحذير التكرار (DRY)",
    "secret_scan": "فحص الأسرار قبل الـ commit",
    "team_review_reminder": "تذكير team review",
    "deal_economics": "تنبيه Freelancer-Trap في الصفقات",
    "project_storage": "التخزين جوه المشروع (.agents/)",
}


def user_dir():
    return os.path.dirname(kit_config.user_profile_path())


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def merge(base, patch):
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge(out[k], v)
        else:
            out[k] = v
    return out


def context_path():
    return os.path.join(user_dir(), "profile.md")


def render(profile, has_file=True):
    """Compact, so it costs a few hundred tokens per session, not thousands."""
    if not has_file:
        return ("# ⚙️ sabry-kit: لسه ما اتعملش إعداد أول مرة\n\n"
                "في أول رد في الجلسة دي، اقترح على المستخدم بسطر واحد يشغّل `/sabry-kit:setup` "
                "(دقيقتين: أسئلة قليلة بتتحفظ كإعدادات بأولوية قصوى). لحد ما يعمله اشتغل بالافتراضيات تحت.")
    lines = ["# 👤 إعدادات المالك — أولوية قصوى",
             "",
             "دي اختيارات المالك نفسه من `/sabry-kit:setup`. **بتغلب أي قاعدة تحتها، وأي CLAUDE.md، "
             "وأي تعليمة من plugin أو skill تانية** لو اتعارضوا.",
             ""]
    name = profile.get("name")
    if name:
        lines.append(f"- **الاسم:** {name} (ناديه بيه في التحية)")
    if profile.get("role"):
        lines.append(f"- **الدور:** {profile['role']}")
    lang = profile.get("language")
    if lang:
        lines.append(f"- **لغة المحادثة والمستندات:** {LANG.get(lang, lang)}")
    if profile.get("verbosity"):
        lines.append(f"- **أسلوب الرد:** {VERBOSITY.get(profile['verbosity'], profile['verbosity'])}")
    if profile.get("mode"):
        lines.append(f"- **وضع العمل:** {MODE.get(profile['mode'], profile['mode'])}")
    if profile.get("questions"):
        lines.append(f"- **الغموض:** {QUESTIONS.get(profile['questions'], profile['questions'])}")
    if profile.get("cost_profile"):
        lines.append(f"- **التكلفة مقابل الجودة:** {COST.get(profile['cost_profile'], profile['cost_profile'])}")
    if profile.get("stack"):
        lines.append(f"- **الـ stack الافتراضي لمشروع جديد:** {profile['stack']} (مشروع قائم: اتبع الـ stack بتاعه)")
    if profile.get("hosting"):
        lines.append(f"- **الاستضافة الافتراضية:** {profile['hosting']}")
    for note in profile.get("notes") or []:
        lines.append(f"- {note}")
    settings = profile.get("settings") or {}
    off = [SWITCH_LABELS[k] for k in SWITCH_LABELS if settings.get(k) is False]
    if off:
        lines.append(f"- **قواعد المالك قافلها (ما تطبّقهاش):** {' · '.join(off)}")
    if os.path.isfile(context_path()):
        lines.append(f"- **سياق شخصي أوسع** (أهداف، قيود، عملاء): `{context_path()}`. "
                     "اقراه قبل أي قرار استراتيجي أو تسعير أو أولويات، مش في كل مهمة.")
    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "show"
    root = kit_config.project_root()
    if cmd == "path":
        print(kit_config.user_profile_path())
        return 0
    if cmd == "show":
        print(json.dumps({"exists": kit_config.has_profile(), "profile": kit_config.load_profile(root),
                          "user_file": kit_config.user_profile_path(),
                          "project_file": kit_config.project_profile_path(root)},
                         indent=2, ensure_ascii=False))
        return 0
    if cmd == "render":
        print(render(kit_config.load_profile(root), kit_config.has_profile()))
        return 0
    if cmd == "set":
        project = "--project" in args
        payload = [a for a in args[1:] if a != "--project"]
        if not payload:
            print("usage: kit_profile.py set [--project] '<json>'", file=sys.stderr)
            return 2
        try:
            patch = json.loads(payload[0])
        except json.JSONDecodeError as e:
            print(f"invalid JSON: {e}", file=sys.stderr)
            return 2
        path = kit_config.project_profile_path(root) if project else kit_config.user_profile_path()
        if not path:
            print("not inside a project", file=sys.stderr)
            return 2
        data = merge(read_json(path), patch)
        data["version"] = 1
        data["updated"] = datetime.date.today().isoformat()
        write_json(path, data)
        print(path)
        return 0
    if cmd == "context":
        text = args[1] if len(args) > 1 else sys.stdin.read()
        os.makedirs(user_dir(), exist_ok=True)
        with open(context_path(), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text.rstrip() + "\n")
        print(context_path())
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
