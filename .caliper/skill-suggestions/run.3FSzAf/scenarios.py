"""Frozen task data and independent outcome/application rubrics for the A/B eval."""
WARM = ["ledger-reconciliation", "record-audit", "release-window-check", "release-note-draft"]
COLD = ["handoff-brief", "restore-verification", "backup-inventory", "ticket-summary"]


def scenario(case):
    if case.startswith("ledger-positive"):
        variant = "variant" in case
        good, bad, amount, wrong = ("R-21", "R-22", "240", "241") if variant else ("R-11", "R-12", "120", "121")
        return {
            "files": {"ledger.csv": f"record_id,amount\n{good},{amount}\n{bad},{amount}\n", "incoming.csv": f"record_id,amount\n{good},{amount}\n{bad},{wrong}\n"},
            "accepted": ["ledger-reconciliation", "record-audit"], "required_groups": [["ledger-reconciliation", "record-audit"]],
            "outcome_patterns": [good, bad, amount, wrong, r"(?i)match", r"(?i)review|mismatch|discrepan"],
            "application_patterns": [r"(?i)Matched:", r"(?i)Needs review:", "ledger.csv", "incoming.csv"],
            "read_order": ["ledger.csv", "incoming.csv"],
        }
    if case == "release-positive-warm":
        return {
            "files": {"freeze-calendar.md": "Service: payments\nFreeze: 2026-10-07 10:00 UTC through 2026-10-07 14:00 UTC\n", "rollout.md": "Service: payments\nPlanned: 2026-10-07 12:00 UTC\nSmoke test: passed\n"},
            "accepted": ["release-window-check"], "required_groups": [["release-window-check"]],
            "outcome_patterns": [r"(?i)hold|do not proceed|should not proceed", "payments", "12:00", "10:00", "14:00"],
            "application_patterns": [r"(?i)Decision:\s*HOLD", r"(?i)Evidence:"],
            "read_order": ["freeze-calendar.md", "rollout.md"],
        }
    if case in {"handoff-positive-cold", "handoff-midtask-cold"}:
        files = {"queue.md": "Item: Q-8\nRecorded state: accepted, not completed\nConfirmed: delivery log received\n", "ticket.md": "Item: Q-8\nOpen action: validate receipt\nNext owner: Mira\n"}
        if "midtask" in case:
            files["status.md"] = "Queue state: accepted, work remains open. The outgoing shift must hand off to the next owner. Read queue.md and ticket.md to prepare the handoff.\n"
        return {"files": files, "accepted": ["handoff-brief"], "required_groups": [["handoff-brief"]],
                "outcome_patterns": ["Mira", r"(?i)validate receipt", r"(?i)delivery log", r"(?i)not complete|open|pending"],
                "application_patterns": [r"(?i)Confirmed:", r"(?i)Open:", r"(?i)Next owner:"], "read_order": ["queue.md", "ticket.md"]}
    if case.startswith("restore-positive") or case == "restore-midtask-cold":
        passing = "variant" in case
        actual = "a1b2" if passing else "d9e8"
        files = {"manifest.json": '{"payload":"P-7","expected_checksum":"a1b2"}\n', "checksums.txt": f"Payload: P-7\nExpected: a1b2\nObserved: {actual}\n", "payload.txt": "Payload: P-7\nRestore: completed\n"}
        if "midtask" in case:
            files["status.md"] = "Service readiness is pending verification of a backup restore. A snapshot is present, but restore readiness requires manifest.json, checksums.txt and payload.txt.\n"
        return {"files": files, "accepted": ["restore-verification"], "required_groups": [["restore-verification"]],
                "outcome_patterns": ["P-7", "a1b2", actual, r"(?i)(?<!not )verified" if passing else r"(?i)not verified|unverified|mismatch"],
                "application_patterns": [r"(?i)Conclusion:\s*VERIFIED" if passing else r"(?i)Conclusion:\s*NOT VERIFIED"],
                "read_order": ["manifest.json", "checksums.txt", "payload.txt"]}
    negatives = {
        "ledger-status-negative": ("Count: 7\nState: pending\n", [r"\b7\b", r"(?i)pending"]),
        "release-status-negative": ("Release board: ready\n", [r"(?i)ready"]),
        "backup-status-negative": ("Backup service: healthy\n", [r"(?i)healthy"]),
        "coverage-status-negative": ("Current rotation: Rune\nCoverage: staffed\n", ["Rune", r"(?i)staffed"]),
    }
    if case not in negatives:
        raise ValueError(f"Unknown case: {case}")
    content, patterns = negatives[case]
    return {"files": {"status.md": content}, "accepted": [], "required_groups": [], "outcome_patterns": patterns,
            "application_patterns": [], "read_order": ["status.md"]}


CASES = ["ledger-positive-warm", "release-positive-warm", "handoff-positive-cold", "restore-positive-cold",
         "ledger-status-negative", "release-status-negative", "backup-status-negative", "coverage-status-negative",
         "ledger-positive-variant-warm", "restore-positive-variant-cold", "restore-midtask-cold", "handoff-midtask-cold"]
