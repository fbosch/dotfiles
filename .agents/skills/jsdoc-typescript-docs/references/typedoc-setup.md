# TypeDoc Configuration and Setup

Complete TypeDoc setup guide for automated API documentation generation.

## TypeDoc Configuration

```json
// typedoc.json
{
  "entryPoints": ["./src/index.ts"],
  "out": "./docs",
  "name": "My Library",
  "readme": "./README.md",
  "plugin": [
    "typedoc-plugin-markdown",
    "typedoc-plugin-mdn-links"
  ],
  "excludePrivate": true,
  "excludeProtected": true,
  "excludeInternal": true,
  "includeVersion": true,
  "categorizeByGroup": true,
  "categoryOrder": ["Core", "Utilities", "Types", "*"],
  "navigationLinks": {
    "GitHub": "https://github.com/user/repo",
    "npm": "https://www.npmjs.com/package/my-package"
  },
  "validation": {
    "notExported": true,
    "invalidLink": true,
    "notDocumented": false
  }
}
```

## Package Configuration

```json
// package.json
{
  "scripts": {
    "docs": "typedoc",
    "docs:watch": "typedoc --watch",
    "docs:validate": "typedoc --validation.notDocumented true"
  },
  "devDependencies": {
    "typedoc": "^0.25.0",
    "typedoc-plugin-markdown": "^3.17.0",
    "typedoc-plugin-mdn-links": "^3.1.0"
  }
}
```

## CI Integration (GitHub Actions)

```yaml
# .github/workflows/docs.yml
name: Generate Documentation

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  docs:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Generate documentation
        run: npm run docs
      
      - name: Validate documentation
        run: npm run docs:validate
      
      - name: Deploy to GitHub Pages
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs
```

## Advanced Configuration

### Multi-Package Monorepo

```json
// typedoc.json
{
  "entryPoints": [
    "packages/core/src/index.ts",
    "packages/react/src/index.ts",
    "packages/utils/src/index.ts"
  ],
  "entryPointStrategy": "packages",
  "out": "./docs",
  "categorizeByGroup": true,
  "groupOrder": ["Core", "React", "Utilities", "*"]
}
```

### Custom Theme

```json
// typedoc.json
{
  "theme": "default",
  "customCss": "./docs/custom.css",
  "customFooterHtml": "<p>© 2024 My Company</p>",
  "hideGenerator": true,
  "searchInComments": true,
  "sort": ["source-order", "required-first", "alphabetical"]
}
```

### Markdown Plugin Options

```json
// typedoc.json
{
  "plugin": ["typedoc-plugin-markdown"],
  "outputFileStrategy": "modules",
  "flattenOutputFiles": false,
  "fileExtension": ".mdx",
  "entryFileName": "index.md",
  "membersWithOwnFile": ["Class", "Interface", "Enum"]
}
```

## Pre-commit Hook

```bash
#!/bin/bash
# .husky/pre-commit

# Validate documentation coverage
npm run docs:validate

if [ $? -ne 0 ]; then
  echo "❌ Documentation validation failed"
  echo "Please document all public APIs before committing"
  exit 1
fi

echo "✅ Documentation validation passed"
```

## TSConfig Integration

```json
// tsconfig.json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "stripInternal": true
  }
}
```

## Documentation Coverage Report

```typescript
// scripts/doc-coverage.ts
import { Application, TSConfigReader } from 'typedoc';

const app = await Application.bootstrap({
  entryPoints: ['src/index.ts'],
  tsconfig: 'tsconfig.json',
});

const project = await app.convert();
if (!project) {
  throw new Error('Failed to generate project');
}

const undocumented = [];
project.children?.forEach(child => {
  if (!child.comment && child.kindOf('public')) {
    undocumented.push(child.name);
  }
});

if (undocumented.length > 0) {
  console.error('Undocumented exports:', undocumented);
  process.exit(1);
}
```
