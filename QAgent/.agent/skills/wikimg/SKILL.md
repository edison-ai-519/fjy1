---
name: wikimg
description: Sync and manage the local WikiMG wiki directory and OntoGit-backed exports.
---

# WikiMG Skill

Use this skill when you need to inspect, update, validate, export, or sync the `Ontology_Factory/WIKI_MG` workspace.

## What This Skill Is For

- Initialize or inspect a WikiMG workspace.
- Edit local wiki documents under `wiki/common`, `wiki/domain`, or `wiki/private`.
- Sync the local `wiki/` directory into OntoGit as file-level versioned content.
- Export the structured `kimi` profile snapshot when you need the aggregated knowledge graph view.
- Validate the profile documents before syncing.

## Important Paths

- WikiMG repo: `/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/WIKI_MG`
- Local wiki directory: `/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/WIKI_MG/wiki`
- OntoGit target is configured by environment variables.

## Environment Variables

Set these before running `wikimg sync` or `wikimg export`:

- `WIKIMG_ONTOGIT_GATEWAY_URL`
- `WIKIMG_ONTOGIT_API_KEY`
- `WIKIMG_ONTOGIT_PROJECT_ID`
- `WIKIMG_ONTOGIT_FILENAME`
- `WIKIMG_ONTOGIT_TIMEOUT_SECONDS`

Typical defaults:

```bash
WIKIMG_ONTOGIT_GATEWAY_URL=http://127.0.0.1:8080
WIKIMG_ONTOGIT_API_KEY=change-me
WIKIMG_ONTOGIT_PROJECT_ID=demo
WIKIMG_ONTOGIT_FILENAME=wikimg_export.json
WIKIMG_ONTOGIT_TIMEOUT_SECONDS=15
```

## Recommended Workflow

1. Modify local wiki markdown or JSON files in `wiki/`.
2. Validate the profile if the change affects structured content.
3. Sync the directory to OntoGit.
4. Use export only when you need the aggregated knowledge graph payload.

## Common Commands

```bash
cd /Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/WIKI_MG

python -m wikimg init
python -m wikimg list
python -m wikimg show domain:getting-started
python -m wikimg validate --profile kimi --json
python -m wikimg export --profile kimi --json
python -m wikimg sync --project-id demo
python -m wikimg sync --project-id demo --wiki-dir /path/to/wiki
```

## When To Use `sync`

Use `sync` when the intent is to mirror the local `wiki/` tree into OntoGit.

- It walks every file under `wiki/`
- It writes each file by relative path into OntoGit
- It relies on OntoGit to create version history
- It also removes remote `wiki/` files that were deleted locally

## When To Use `export`

Use `export` only when you need the structured `kimi` snapshot:

- `documents`
- `knowledgeGraph.entity_index`
- `knowledgeGraph.cross_references`
- summary statistics

Do not use `export` as the primary sync path unless the task specifically requires the aggregated payload.

## Editing Guidance

- Prefer Markdown documents for content pages.
- Keep one document focused on one concept or node.
- Use explicit frontmatter for structured profile documents.
- Avoid large monolithic JSON exports when the same information can live in separate wiki pages.

## QAgent Execution Pattern

When a task mentions WikiMG, inspect the workspace with shell first, then run the smallest command needed:

```bash
cd /Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/WIKI_MG
python -m wikimg sync --project-id demo
```

If the OntoGit host or port changes, update `WIKIMG_ONTOGIT_GATEWAY_URL` instead of editing code.

