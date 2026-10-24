"""Deterministic outcome, selection, and workflow-application grading."""
import json
import os
import re
from pathlib import Path


def evaluate(events, expected):
    finals = [e for e in events if e['kind'] == 'assistant' and not e['hasToolCalls'] and e['stopReason'] == 'stop']
    final = finals[-1].get('text', '') if finals else ''
    reads = [e for e in events if e['kind'] == 'read']
    skills = sorted({e['skill'] for e in reads if e['scope'] == 'skill'})
    paths = [e['path'] for e in reads if e['scope'] == 'workspace']
    groups = expected['required_groups']
    hits = sum(bool(set(group) & set(skills)) for group in groups)
    unnecessary = sorted(set(skills) - set(expected['accepted']))
    matched_outcome = all(re.search(p, final) for p in expected['outcome_patterns'])
    matched_application = all(re.search(p, final) for p in expected['application_patterns'])
    order = expected['read_order']
    order_ok = all(p in paths for p in order) and [paths.index(p) for p in order if p in paths] == sorted(paths.index(p) for p in order if p in paths)
    progress_ok = True
    if 'midtask' in expected['case']:
        status_index = next((i for i, e in enumerate(events) if e['kind'] == 'read' and e.get('path') == 'status.md'), -1)
        progress_index = next((i for i, e in enumerate(events) if e['kind'] == 'progress' and i > status_index), -1)
        linked_index = next((i for i, e in enumerate(events) if e['kind'] == 'read' and e.get('path') in order), -1)
        progress_ok = 0 <= status_index < progress_index < linked_index
    violations = [e['kind'] for e in events if e['kind'] in {'denied-read', 'denied-tool', 'budget-exceeded', 'search-budget-exceeded'}]
    executions = [e for e in events if e['kind'] == 'execution']
    contexts = [e for e in events if e['kind'] == 'context']
    errors = []
    if not executions or any(e['model'] != expected['model'] or e['thinking'] != expected['thinking'] for e in executions):
        errors.append('model/thinking mismatch or execution missing')
    if not contexts:
        errors.append('no model context observed')
    else:
        visibility = contexts[0]['catalogVisibility']
        if any(not visibility.get(s) for s in expected['warm']) or any(visibility.get(s) for s in expected['cold']):
            errors.append('warm/cold catalog mismatch')
    automatic = [e for e in events if e['kind'] == 'classifier' and e['phase'] != 'skill_search']
    if expected['arm'] == 'baseline':
        if automatic or any(e.get('advisoryPresent') for e in contexts):
            errors.append('baseline received automatic advice')
    elif not any(e['phase'] == 'input' and e.get('validResponse') for e in automatic):
        errors.append('treatment input classifier unavailable')
    main_tokens = sum(e.get('usage', {}).get('totalTokens', 0) for e in events if e['kind'] == 'assistant')
    classifiers = [e for e in events if e['kind'] == 'classifier']
    classifier_tokens = sum(e.get('usage', {}).get('totalTokens', 0) for e in classifiers)
    return {'case': expected['case'], 'arm': expected['arm'], 'infrastructureErrors': errors,
            'outcomePass': bool(finals and matched_outcome and progress_ok and not violations),
            'applicationPass': bool(finals and matched_application and order_ok and progress_ok and not violations),
            'selectionPass': hits == len(groups) and not unnecessary, 'skillsRead': skills,
            'requiredGroups': len(groups), 'groupsFound': hits, 'unnecessaryReads': unnecessary,
            'recommendations': sorted({s for e in contexts for s in e.get('allRecommendations', [])}),
            'mainTokens': main_tokens, 'classifierTokens': classifier_tokens,
            'classifierCalls': len(classifiers), 'automaticCalls': len(automatic),
            'classifierElapsedMs': sum(e.get('elapsedMs', 0) for e in classifiers),
            'automaticValidCalls': sum(bool(e.get('validResponse')) for e in automatic),
            'searchCalls': sum(e['kind'] == 'skill-search' for e in events)}


def check():
    run = Path(os.environ['SKILL_SUGGESTIONS_EVAL_RUN'])
    latest = json.loads((run / 'latest.json').read_text())
    trace = Path(latest['trace'])
    expected = json.loads(trace.with_suffix('.expected.json').read_text())
    events = [json.loads(line) for line in trace.read_text().splitlines()]
    verdict = evaluate(events, expected)
    verdict['durationSeconds'] = latest['durationSeconds']
    if latest['exit_code'] != 0:
        verdict['infrastructureErrors'].append('Pi exited unsuccessfully')
    verdict['artifactsUnchanged'] = all((Path(expected['work']) / p).read_text() == value for p, value in expected['files'].items())
    verdict['outcomePass'] = verdict['outcomePass'] and verdict['artifactsUnchanged']
    trace.with_suffix('.verdict.json').write_text(json.dumps(verdict, indent=2))
    assert not verdict['infrastructureErrors'], '; '.join(verdict['infrastructureErrors'])
    assert verdict['outcomePass'], 'Task outcome failed; selection/application reported separately in verdict'
