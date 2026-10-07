#!/usr/bin/env python3
"""Compare frozen A/B evidence, retaining unavailable attempts separately."""
import json
import shutil
import sys
from collections import Counter
from pathlib import Path


def selection_deadline(metadata):
    # Older persisted runs predate the override and always used 2400 ms.
    value = metadata.get('selectionTimeoutMs', 2400)
    if type(value) is not int or not 1 <= value <= 5000:
        raise ValueError('Invalid selection deadline in evidence')
    return value


def summary(path):
    verdicts = [json.loads(p.read_text()) for p in sorted(path.glob('attempt-*.verdict.json'))]
    attempts = len(list(path.glob('attempt-*.expected.json')))
    usable = [v for v in verdicts if not v['infrastructureErrors']]
    positives = [v for v in usable if v['requiredGroups']]
    def rate(values, key):
        return sum(v[key] for v in values) / len(values) if values else None
    return {'attemptsStarted': attempts, 'graded': len(verdicts), 'usable': len(usable),
            'unavailableOrUngraded': attempts - len(usable),
            'outcomeRate': rate(usable, 'outcomePass'), 'applicationRatePositive': rate(positives, 'applicationPass'),
            'selectionRate': rate(usable, 'selectionPass'),
            'requiredGroupRecall': sum(v['groupsFound'] for v in positives) / sum(v['requiredGroups'] for v in positives) if positives else None,
            'unnecessarySkillReads': sum(len(v['unnecessaryReads']) for v in usable),
            'mainTokensAllGraded': sum(v['mainTokens'] for v in verdicts),
            'classifierTokensAllGraded': sum(v['classifierTokens'] for v in verdicts),
            'secondsAllGraded': sum(v['durationSeconds'] for v in verdicts),
            'classifierElapsedMs': sum(v['classifierElapsedMs'] for v in verdicts),
            'automaticCalls': sum(v['automaticCalls'] for v in verdicts),
            'automaticValidCalls': sum(v['automaticValidCalls'] for v in verdicts),
            'caseCounts': dict(Counter(v['case'] for v in usable)),
            'cases': {case: {'usable': len(rows), 'outcomeRate': rate(rows, 'outcomePass'),
                            'selectionRate': rate(rows, 'selectionPass'), 'applicationRate': rate(rows, 'applicationPass')}
                      for case in sorted({v['case'] for v in usable})
                      for rows in [[v for v in usable if v['case'] == case]]}}


def aggregate(paths, destination):
    if not paths:
        raise ValueError('At least one evidence directory is required')
    records = [json.loads((p / 'metadata.json').read_text()) for p in paths]
    first = records[0]
    for record in records[1:]:
        for key in ('arm', 'model', 'thinking', 'sha256', 'warm', 'cold', 'classifierProviders', 'threshold', 'scope'):
            if record[key] != first[key]:
                raise ValueError(f'Confounded aggregation: {key} differs')
        if selection_deadline(record) != selection_deadline(first):
            raise ValueError('Confounded aggregation: selectionTimeoutMs differs')
    files = [f for p in paths for f in p.glob('attempt-*') if f.is_file()]
    if len({f.name for f in files}) != len(files):
        raise ValueError('Duplicate attempt artifact in aggregation')
    destination.mkdir(parents=True, exist_ok=False)
    for source in files:
        shutil.copy2(source, destination / source.name)
    (destination / 'metadata.json').write_text(json.dumps({**first, 'evidence': str(destination),
        'sourceRuns': [str(p) for p in paths]}, indent=2))


def compare(baseline, treatment):
    a, b = [json.loads((p / 'metadata.json').read_text()) for p in (baseline, treatment)]
    if a['arm'] not in ('baseline', 'input-only') or b['arm'] != 'treatment':
        raise ValueError('Pass baseline or input-only evidence then treatment evidence')
    for key in ('model', 'thinking', 'sha256', 'warm', 'cold', 'classifierProviders', 'threshold'):
        if a[key] != b[key]:
            raise ValueError(f'Confounded comparison: {key} differs')
    if selection_deadline(a) != selection_deadline(b):
        raise ValueError('Confounded comparison: selectionTimeoutMs differs')
    left, right = summary(baseline), summary(treatment)
    report = {'scope': a['scope'], 'model': a['model'], 'thinking': a['thinking'],
              'controlArm': a['arm'], 'treatmentArm': b['arm'],
              'selectionTimeoutMs': selection_deadline(a),
              'baselineEvidence': str(baseline), 'treatmentEvidence': str(treatment), 'baseline': left, 'treatment': right,
              'balancedUsableCases': left['caseCounts'] == right['caseCounts'],
              'deltaTreatmentMinusBaseline': {key: right[key] - left[key] if left[key] is not None and right[key] is not None else None
                  for key in ('outcomeRate', 'applicationRatePositive', 'selectionRate', 'requiredGroupRecall', 'unnecessarySkillReads')}}
    return report


if __name__ == '__main__':
    if sys.argv[1] == '--aggregate':
        aggregate([Path(p) for p in sys.argv[3:]], Path(sys.argv[2]))
    else:
        print(json.dumps(compare(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
