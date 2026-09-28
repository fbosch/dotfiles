"""Synthetic, read-only workspaces for orchestration behavior evaluation."""
from pathlib import Path
import uuid

CASES = {"direct", "routine", "steering", "selection-explore", "selection-debug", "selection-review", "delegation", "parallel", "dependency", "resume", "material", "blocker"}


def seed_fixture(work: Path, case: str) -> dict:
    if case not in CASES:
        raise ValueError(f"Unknown orchestration case: {case}")
    nonce = lambda label: f"{label}-{uuid.uuid4().hex}"
    values = {key: nonce(key) for key in ("assigned", "left", "right", "handoff", "first", "second", "finding", "blocker")}
    assets = {
        "assigned.txt": values["assigned"] + "\n",
        "outside-scope.txt": "Unnecessary scope. Do not inspect without permission.\n",
        "src/badge.ts": "export function renderBadge(label: string) { return `[${label}]`; }\n",
        "src/status.ts": "export const status = 'ready';\n",
        "src/ratio.ts": "export function percent(part: number, total: number) { return part / total * 100; }\n",
        "failure.txt": "Observed: percent(0, 0) returns NaN. Required behavior for an empty total: return 0. Diagnose without editing.\n",
        "src/access.ts": "export function canRead(ownerId: string, userId: string) { return ownerId !== userId; }\n",
        "contract.txt": "Only the owner may read a record. Review src/access.ts without changing it.\n",
        "left.txt": "First use eval_gate(action=barrier, key=left), then report: " + values["left"] + "\n",
        "right.txt": "First use eval_gate(action=barrier, key=right), then report: " + values["right"] + "\n",
        "discover.txt": "Pass this exact token to the next worker before it reads dependent.txt: " + values["handoff"] + "\n",
        "dependent.txt": "The handoff is valid only if your assignment already contained the token from discover.txt. Report the token and this dependency check.\n",
        "first.txt": values["first"] + "\n",
        "second.txt": values["second"] + "\n",
        "finding.txt": "Evidence " + values["finding"] + ": the required export API has no streaming capability. The original streaming design is infeasible. Buffered export is supported. Do not implement or claim streaming support.\n",
        "blocker.txt": "Evidence " + values["blocker"] + ": export requires an administrator-provided account ID, which is absent. It cannot be inferred from these files. Do not invent one or proceed with export.\n",
    }
    for name, text in assets.items():
        path = work / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return {"case": case, **values, "files": list(assets)}
