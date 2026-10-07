#!/usr/bin/env python3
"""Compare frozen A/B evidence, retaining unavailable attempts separately."""
import json
import sys
from collections import Counter
from pathlib import Path


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


def compare(baseline, treatment):
    a, b = [json.loads((p / 'metadata.json').read_text()) for p in (baseline, treatment)]
    if a['arm'] != 'baseline' or b['arm'] != 'treatment':
        raise ValueError('Pass baseline evidence then treatment evidence')
    for key in ('model', 'thinking', 'sha256', 'warm', 'cold', 'classifierProviders', 'threshold'):
        if a[key] != b[key]:
            raise ValueError(f'Confounded comparison: {key} differs')
    left, right = summary(baseline), summary(treatment)
    report = {'scope': a['scope'], 'model': a['model'], 'thinking': a['thinking'],
              'baselineEvidence': str(baseline), 'treatmentEvidence': str(treatment), 'baseline': left, 'treatment': right,
              'balancedUsableCases': left['caseCounts'] == right['caseCounts'],
              'deltaTreatmentMinusBaseline': {key: right[key] - left[key] if left[key] is not None and right[key] is not None else None
                  for key in ('outcomeRate', 'applicationRatePositive', 'selectionRate', 'requiredGroupRecall', 'unnecessarySkillReads')}}
    return report


if __name__ == '__main__':
    print(json.dumps(compare(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
