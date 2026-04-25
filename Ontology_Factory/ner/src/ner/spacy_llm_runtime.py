from __future__ import annotations

from typing import Any

from spacy_llm.tasks.ner import make_ner_task_v3

from ner.mentions import RawEntityMention
from ner.spacy_llm_support import SpacyLLMModelConfig
from ner.spacy_llm_support import build_label_definitions, ensure_locked_spacy_llm_version
from ner.spacy_llm_support import label_names, load_label_config, make_blank_nlp
from ner.spacy_llm_support import make_examples_reader, make_llm_wrapper, read_template
from ner.spacy_llm_support import strict_label_normalizer, task_metadata


class SpacyLLMNerRuntime:
    def __init__(self, config: SpacyLLMModelConfig) -> None:
        self.config = config
        self.spacy_llm_version = ensure_locked_spacy_llm_version()
        self.label_config = load_label_config(config.task.labels_path)
        self.nlp = make_blank_nlp(config.lang)
        self.task = make_ner_task_v3(
            labels=label_names(self.label_config),
            template=read_template(config.task.template_path),
            label_definitions=build_label_definitions(self.label_config),
            examples=make_examples_reader(config.task.examples_path),
            normalizer=strict_label_normalizer(),
            description=(
                f"Label configuration version: {self.label_config.version}. "
                "Only the exact label names listed above are valid outputs. "
                "Any aliases mentioned in label definitions are for explanation only and remain invalid output labels."
            ),
        )
        self.wrapper = make_llm_wrapper(nlp=self.nlp, task=self.task, model_config=config)
        self.metadata = task_metadata(
            spacy_llm_version=self.spacy_llm_version,
            label_config=self.label_config,
            task_name="spacy.NER.v3",
            template_path=config.task.template_path,
        )

    def extract_mentions(self, text: str) -> tuple[list[RawEntityMention], dict[str, Any]]:
        doc = self.wrapper(self.nlp.make_doc(text))
        mentions = [
            RawEntityMention(
                text=ent.text,
                label=ent.label_,
                start=ent.start_char,
                end=ent.end_char,
                confidence=1.0,
            )
            for ent in doc.ents
        ]
        return mentions, dict(self.metadata)


def build_default_ner_runtime(payload: dict[str, Any] | None = None) -> SpacyLLMNerRuntime:
    return SpacyLLMNerRuntime(
        SpacyLLMModelConfig.from_mapping(
            payload,
            task_name="ner",
            default_template_filename="ner_template.jinja",
            default_labels_filename="ner_labels.yml",
            default_examples_filename="ner_examples.yml",
        )
    )
