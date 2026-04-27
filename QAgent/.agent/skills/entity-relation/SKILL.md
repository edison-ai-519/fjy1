---
name: entity-relation
description: Extract entity relations from NER output or local text files with the relation CLI for ontology workflows.
---

# Entity Relation Skill

Use this skill when you need to derive relations between entities from a local text file or from an existing NER document.

## What This Skill Is For

- Convert text into relation candidates using the relation CLI.
- Reuse NER output as the document basis for relation extraction.
- Export `RelationDocument` JSON for ontology indexing and knowledge graph workflows.

## Important Paths

- Ontology Factory repo: `/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory`
- Relation package: `/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation`
- CLI entry: `/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src/entity_relation/cli.py`

## Recommended Commands

Run from the Ontology Factory root so Python module imports resolve cleanly:

```bash
cd /Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory
PYTHONPATH=/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src:/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src python -m entity_relation.cli extract --input /path/to/text.txt --stdout
PYTHONPATH=/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src:/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src python -m entity_relation.cli extract --input /path/to/text.txt --query 光照 --max-sentences 6 --stdout
PYTHONPATH=/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src:/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src python -m entity_relation.cli extract --input /path/to/text.txt --output /path/to/output.json
```

## Output

- `RelationDocument` JSON
- `relations[]` with `source_entity_id`, `target_entity_id`, `relation_type`, `confidence`, and `evidence_sentence`

## When To Use

- You already have relevant text and want lightweight ontology relation candidates.
- You want a deterministic relation layer after NER.
- You want to inspect or export relation hints for wiki or graph workflows.

## Notes

- The relation extractor currently uses NER internally and applies sentence-level heuristics.
- It is intentionally conservative and works best on focused snippets rather than large blobs of unrelated text.
- Prefer this skill after `ner` when you want both entities and relations in the same workflow.
