# Model Selection Strategy

Guide for choosing appropriate models for different agent types and tasks in OpenCode.

## Quality-First Approach

**Default to capable models** for most agents. The cost savings from faster/cheaper models rarely outweigh quality loss for code generation and reasoning tasks.

| Model Tier | Best For | Speed | Cost | Quality |
|------------|----------|-------|------|---------|
| **Premium** (GPT-5, Claude Opus) | Creative work, complex reasoning, quality-critical | Slower | Highest | ✅ Highest |
| **Standard** (GPT-4, Claude Sonnet) | **Default for most agents** - content generation, reasoning, file creation | Balanced | Standard | ✅ High |
| **Fast** (GPT-4 Mini, Claude Haiku, Gemini Flash) | **Only for simple script execution** where quality doesn't matter | 2x faster | 3x cheaper | ⚠️ Variable |
| **inherit** | Match main conversation | Varies | Varies | Matches parent |

## Why Standard Tier Default?

Testing shows significant quality differences when using fast models for content generation:

**Fast models** (Haiku/Flash/Mini):
- Wrong stylesheet links
- Missing CSS
- Incorrect values
- Wrong patterns applied
- Inconsistent API usage

**Standard models** (Sonnet/GPT-4):
- Correct patterns consistently
- Proper validation
- Fewer errors requiring fixes
- Better judgment calls

## Model Selection by Task Type

| Task Type | Recommended Tier | Why |
|-----------|-----------------|-----|
| Content generation | Standard | Quality matters |
| File creation | Standard | Patterns must be correct |
| Code writing | Standard | Bugs are expensive |
| Audits/reviews | Standard | Judgment required |
| Complex reasoning | Premium | Maximum quality needed |
| Creative work | Premium | Maximum quality needed |
| Deploy scripts | Fast (OK) | Just running commands |
| Simple format checks | Fast (OK) | Pass/fail only |

## Configuration Examples

### Default Standard Model

```json
{
  "agent": {
    "site-builder": {
      "description": "Builds static sites from templates",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514"
    }
  }
}
```

Content quality matters - use standard tier, NOT fast tier.

### Premium for Creative Work

```markdown
---
description: Creates creative content and designs
mode: subagent
model: anthropic/claude-opus-4-20250514
---

You are a creative director.

Focus on innovative solutions, compelling copy, and elegant designs.
```

Creative work needs maximum quality - use premium tier.

### Fast for Simple Script Execution

```json
{
  "agent": {
    "deploy-runner": {
      "description": "Runs deployment scripts",
      "mode": "subagent",
      "model": "anthropic/claude-haiku-4-20250514",
      "tools": {
        "read": true,
        "bash": true
      }
    }
  }
}
```

Just running wrangler/npm commands - quality is irrelevant, fast model is fine.

### Inherit from Parent

```json
{
  "agent": {
    "helper": {
      "description": "General purpose helper",
      "mode": "subagent",
      "model": "inherit"
    }
  }
}
```

Use `"inherit"` to match the primary agent's model. Less predictable but flexible.

## Model-Specific Considerations

### Temperature Settings

Some agents benefit from adjusted temperature:

```json
{
  "agent": {
    "code-analyzer": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.1
    },
    "creative-writer": {
      "model": "anthropic/claude-opus-4-20250514",
      "temperature": 0.7
    }
  }
}
```

- **0.0-0.2**: Very focused, deterministic (analysis, planning)
- **0.3-0.5**: Balanced (general development)
- **0.6-1.0**: More creative (brainstorming, writing)

### Reasoning Models (OpenAI)

For OpenAI's reasoning models, you can control effort:

```json
{
  "agent": {
    "deep-thinker": {
      "description": "Uses high reasoning effort for complex problems",
      "model": "openai/gpt-5",
      "reasoningEffort": "high",
      "textVerbosity": "low"
    }
  }
}
```

### Context Window Considerations

Different models have different context windows:

| Model | Context Window | Best For |
|-------|----------------|----------|
| Claude Sonnet/Opus | 200k tokens | Large codebases, deep research |
| GPT-4 | 128k tokens | Most tasks |
| GPT-4 Mini | 128k tokens | Smaller tasks |
| Gemini Pro | 1M+ tokens | Massive context needs |

Choose models based on expected context requirements:

```json
{
  "agent": {
    "codebase-analyzer": {
      "description": "Analyzes entire codebase structure",
      "model": "google/gemini-2.0-flash-exp"
    }
  }
}
```

## Cost Optimization Strategies

### When Fast Models Are Acceptable

Use fast/cheap models ONLY when:

1. **Simple command execution** - Just running scripts, no decisions
2. **Binary validation** - Pass/fail checks with no interpretation
3. **Format conversion** - Mechanical transformations

**DO NOT use fast models for:**
- File content generation
- Code writing or modification
- Decision-making or judgment
- Complex pattern application

### Tiered Agent Strategy

Use different model tiers for different phases:

```json
{
  "agent": {
    "quick-scout": {
      "description": "Fast initial codebase exploration",
      "mode": "subagent",
      "model": "anthropic/claude-haiku-4-20250514",
      "tools": {
        "read": true,
        "grep": true,
        "glob": true
      }
    },
    "deep-refactor": {
      "description": "Comprehensive code refactoring",
      "mode": "subagent",
      "model": "anthropic/claude-opus-4-20250514"
    }
  }
}
```

Fast model for quick searches, premium for actual code changes.

### Monitor and Adjust

Track agent quality over time:

1. Start with standard tier models
2. Monitor failure rates and rework needs
3. Upgrade to premium if quality issues persist
4. Downgrade to fast tier only for proven simple tasks

The cost of fixing fast model mistakes usually exceeds the savings.

## Best Practices

1. **Default to standard tier** - Claude Sonnet, GPT-4, Gemini Pro for most agents
2. **Use premium for creative work** - When quality is paramount
3. **Use fast tier sparingly** - Only for simple script execution
4. **Don't use `inherit` unless necessary** - Explicit model selection is more predictable
5. **Test before deploying** - Verify agent produces expected quality
6. **Adjust temperature for task type** - Lower for analysis, higher for creativity
7. **Consider context windows** - Match model to expected context needs
8. **Optimize orchestrators differently** - Orchestrators can use fast models, specialists need quality

## Model Format Reference

OpenCode model IDs use the format `provider/model-id`:

| Provider | Example |
|----------|---------|
| Anthropic | `anthropic/claude-sonnet-4-20250514` |
| OpenAI | `openai/gpt-4` |
| Google | `google/gemini-2.0-flash-exp` |
| OpenCode Zen | `opencode/gpt-5.1-codex` |

Run `opencode models` to see all available models for your configured providers.
