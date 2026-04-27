---
name: ner
description: Extract Chinese entities from Ontology_Factory text files with the NER CLI and use the result as structured document input.
---

# NER Skill

Use this skill when you need to extract entities from Chinese source text, inspect entity mentions, or prepare structured entity data for downstream ontology work.

## What This Skill Is For

- Extract entities from a local text file.
- Narrow extraction to a query-specific snippet before running NER.
- Export `NerDocument` JSON for downstream document and relation processing.
- Use the CLI output as a read-only document input for later ontology steps.

## Important Paths

- Ontology Factory repo: `/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory`
- NER package: `/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner`
- CLI entry: `/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src/ner/cli.py`

## Recommended Commands

Run from the Ontology Factory root so Python module imports resolve cleanly:

```bash
cd /Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory
PYTHONPATH=/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src python -m ner.cli extract --input /path/to/text.txt --stdout
PYTHONPATH=/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src python -m ner.cli extract --input /path/to/text.txt --query 光照 --max-sentences 4 --stdout
PYTHONPATH=/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src python -m ner.cli extract --input /path/to/text.txt --output /path/to/output.json
```

## Output

- `NerDocument` JSON
- `entities[]` with `entity_id`, `text`, `normalized_text`, `label`, `source_sentence`, and `metadata`

## When To Use

- You need to identify key entities in a document before relation extraction.
- You want a structured, deterministic representation of mentions and normalized entities.
- You want to inspect NER output before feeding it into a later ontology workflow.

## Notes

- The extractor uses HanLP first and falls back to rule-based extraction.
- Optional OpenRouter enhancement is available when the relevant environment variables are configured.
- Keep the input file local and prefer read-only inspection commands when debugging the pipeline.
