#!/usr/bin/env python3
"""Isolated Caliper launcher: only automatic recommendation enablement differs."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

from scenarios import CASES, WARM, COLD, scenario


def prepare(repo, run_root, evidence, baseline, model, thinking, input_only=False, selection_timeout_ms=2400):
    if type(selection_timeout_ms) is not int or not 1 <= selection_timeout_ms <= 5000:
        raise ValueError('Selection deadline must be an integer from 1 to 5000 ms')
    if baseline and input_only:
        raise ValueError('Baseline and input-only arms are mutually exclusive')
    source = repo / '.pi/agent/evals/skill-suggestions'
    agent = repo / '.pi/agent'
    evidence.mkdir(parents=True, exist_ok=True)
    module_spec = importlib.util.spec_from_file_location('eval_model_config', repo / '.pi/agent/evals/orchestration/model_config.py')
    if module_spec is None or module_spec.loader is None:
        raise RuntimeError('Cannot load existing model configuration helper')
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    models = json.loads((agent / 'models.json').read_text())
    if any(set(provider) != {'models'} for provider in models.get('providers', {}).values()):
        raise ValueError('Review custom provider configuration before copying')
    (evidence / 'models.json').write_text(json.dumps(models))
    # Include the installed classifier catalog as well as the configured agent model.
    store = module.snapshot_store(repo, {'parent': {'model': model}, 'agents': {}})
    original_store = json.loads((agent / 'models-store.json').read_text())
    for provider in ('openrouter', 'vercel-ai-gateway'):
        entries = original_store.get(provider, {})
        selected = [m for m in entries.get('models', []) if 'jev' in m.get('id', '')]
        if selected:
            store[provider] = {'models': selected}
    (evidence / 'models-store.json').write_text(json.dumps(store))
    settings = json.loads((agent / 'settings.json').read_text())
    classifier = settings.get('classifier', {})
    routing = classifier.get('providers')
    config = {'arm': 'baseline' if baseline else 'input-only' if input_only else 'treatment', 'model': model, 'thinking': thinking,
              'evidence': str(evidence), 'repo': str(repo), 'classifierProviders': routing,
              'selectionTimeoutMs': selection_timeout_ms,
              'extensions': [str(source / 'fixture.ts'), str(agent / 'extensions/skill-discovery/index.ts'), str(agent / 'extensions/openai-capabilities.ts')]}
    for name in ('launch.py', 'scenarios.py', 'check.py', 'compare.py'):
        shutil.copy2(source / name, evidence / name)
    shutil.copytree(source / 'skills', evidence / 'skills')
    inputs = [source / 'fixture.ts', source / 'skill-suggestions.eval.yaml', *sorted((source / 'skills').glob('*/SKILL.md')),
              *sorted((agent / 'extensions/skill-discovery').glob('*.ts')), agent / 'lib/classifier.ts']
    inputs.extend(source / name for name in ('launch.py', 'scenarios.py', 'check.py', 'compare.py', 'pilot.eval.yaml'))
    hashes = {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
    metadata = {**config, 'sha256': hashes, 'warm': WARM, 'cold': COLD,
                'scope': 'synthetic skill workflows; not the personal skill corpus', 'threshold': 0.72}
    (evidence / 'metadata.json').write_text(json.dumps(metadata, indent=2))
    (run_root / 'skill-suggestions.json').write_text(json.dumps(config))
    shutil.copy2(__file__, run_root / 'skill-suggestions-launch.py')
    shutil.copy2(source / 'scenarios.py', run_root / 'scenarios.py')
    (run_root / 'home/.pi/agent/settings.json').write_text('{}\n')


def configure_attempt(home, agent, config, trace, case):
    if config.get('arm') not in ('baseline', 'input-only', 'treatment'):
        raise ValueError('Unsupported skill suggestion arm')
    if agent.resolve() != (home / '.pi/agent').resolve():
        raise ValueError('Unexpected Caliper agent directory')
    work = home / 'fixture'
    work.mkdir(parents=True, exist_ok=False)
    spec = scenario(case)
    for name, content in spec['files'].items():
        (work / name).write_text(content)
    evidence = Path(config['evidence'])
    agent.mkdir(parents=True, exist_ok=True)
    skill_root = agent / 'skills'
    shutil.copytree(evidence / 'skills', skill_root, dirs_exist_ok=True)
    classifier = {'enabled': True, 'skillSelection': {'enabled': config['arm'] != 'baseline', 'midTaskEnabled': config['arm'] != 'input-only', 'threshold': 0.72,
                  'timeoutMs': config['selectionTimeoutMs'], 'maxRecommendations': 3}, 'toolDiscovery': {'enabled': True, 'timeoutMs': 2400}}
    if config['classifierProviders'] is not None:
        classifier['providers'] = config['classifierProviders']
    settings = {'packages': [], 'extensions': ['-builtin:mcp', '-builtin:tool-search', '-builtin:codemode', *config['extensions']],
                'skills': [], 'prompts': [], 'defaultProjectTrust': 'never', 'defaultTools': ['read', 'skill_search', 'progress'],
                'skillTweaks': {'warmSkills': WARM}, 'classifier': classifier}
    (agent / 'settings.json').write_text(json.dumps(settings))
    for name in ('models.json', 'models-store.json'):
        shutil.copy2(evidence / name, agent / name)
    (agent / 'SYSTEM.md').write_text(
        'You are an assistant completing a read-only task in an isolated workspace. Use evidence from task files; do not invent facts. '
        'Skills provide specialized workflows. Read an applicable SKILL.md before following it. '
        'Use skill_search to discover relevant workflows not listed in the catalog. Do not load skills for unrelated work. '
        'The available workspace files are: ' + ', '.join(sorted(spec['files'])) + '.\n')
    trace.with_suffix('.expected.json').write_text(json.dumps({**spec, 'case': case, 'arm': config['arm'],
        'work': str(work), 'model': config['model'], 'thinking': config['thinking'], 'warm': WARM, 'cold': COLD}))
    return work, skill_root


def launch(pi, args):
    config = json.loads(Path(__file__).with_name('skill-suggestions.json').read_text())
    if not os.environ.get('PI_CODING_AGENT_DIR') or '--version' in args or '-v' in args:
        return subprocess.call([pi, '--no-extensions', *args], env={**os.environ, 'PI_OFFLINE': '1'})
    marker = re.match(r'\[\[skill-suggestions-case:([a-z-]+)\]\]\s*', args[-1])
    if not marker or marker[1] not in CASES:
        raise ValueError('Unsupported skill-suggestions case marker')
    case = marker[1]
    args = [*args[:-1], args[-1][marker.end():]]
    evidence = Path(config['evidence'])
    latest = evidence / 'latest.json'
    latest.unlink(missing_ok=True)
    trace = evidence / f'attempt-{uuid.uuid4().hex}.jsonl'
    work, skill_root = configure_attempt(Path(os.environ['HOME']), Path(os.environ['PI_CODING_AGENT_DIR']), config, trace, case)
    env = {**os.environ, 'PI_OFFLINE': '1', 'SKILL_SUGGESTIONS_TRACE': str(trace), 'SKILL_SUGGESTIONS_WORK': str(work),
           'SKILL_SUGGESTIONS_SKILL_ROOT': str(skill_root), 'SKILL_SUGGESTIONS_TASK': case,
           'SKILL_SUGGESTIONS_ARM': config['arm'], 'SKILL_SUGGESTIONS_MODEL': config['model'],
           'SKILL_SUGGESTIONS_THINKING': config['thinking'], 'SKILL_SUGGESTIONS_WARM_SKILLS': ','.join(WARM),
           'SKILL_SUGGESTIONS_COLD_SKILLS': ','.join(COLD)}
    started = time.monotonic()
    result = subprocess.call([pi, '--no-builtin-tools', '--no-prompt-templates', *args], cwd=work, env=env)
    latest.write_text(json.dumps({'trace': str(trace), 'exit_code': result, 'durationSeconds': time.monotonic() - started}))
    return result


if __name__ == '__main__':
    if sys.argv[1] == 'prepare':
        prepare(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), sys.argv[5] == 'true', *sys.argv[6:8], input_only=sys.argv[8] == 'true', selection_timeout_ms=int(sys.argv[9]))
    else:
        raise SystemExit(launch(sys.argv[1], sys.argv[2:]))
