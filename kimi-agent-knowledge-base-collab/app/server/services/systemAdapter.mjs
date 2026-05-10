const PROBABILITY_DECISION_RESPONSE_SCHEMA = {
  name: "probability_decision",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      probability: { type: "string" },
      reason: { type: "string" },
    },
    required: ["probability", "reason"],
  },
};

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function attachStageDebug(error, debug = {}) {
  const baseError = error instanceof Error ? error : new Error(String(error));
  const stageOutput = {};
  if (debug.llm_raw !== undefined) {
    stageOutput.llm_raw = debug.llm_raw;
  }
  if (typeof debug.llm_raw_text === "string" && debug.llm_raw_text.trim()) {
    stageOutput.llm_raw_text = debug.llm_raw_text;
  }
  if (debug.llm_response !== undefined) {
    stageOutput.llm_response = debug.llm_response;
  }
  if (typeof debug.debug_error === "string" && debug.debug_error.trim()) {
    stageOutput.debug_error = debug.debug_error;
  }
  if (Object.keys(stageOutput).length > 0) {
    baseError.stageOutput = {
      ...(baseError.stageOutput && typeof baseError.stageOutput === "object" ? baseError.stageOutput : {}),
      ...stageOutput,
    };
  }
  return baseError;
}

function extractAblationCandidates(llmResult) {
  if (Array.isArray(llmResult)) {
    return llmResult;
  }
  if (Array.isArray(llmResult?.ablation_candidates)) {
    return llmResult.ablation_candidates;
  }
  if (Array.isArray(llmResult?.candidates)) {
    return llmResult.candidates;
  }
  if (Array.isArray(llmResult?.ablation)) {
    return llmResult.ablation;
  }
  return [];
}

function resolveAblationEntity(item, entityById, entityByName) {
  const entityId = asText(item.entity_id);
  const entityName = asText(item.entity_name);
  return entityById.get(entityId) || entityByName.get(entityName) || null;
}

function normalizeAblationCandidate(raw, entityById, entityByName = new Map()) {
  const item = asRecord(raw);
  const entity = resolveAblationEntity(item, entityById, entityByName);
  if (!entity) {
    return null;
  }

  const fallbackEvidence = Array.isArray(entity.citations) && entity.citations.length > 0
    ? asText(entity.citations[0])
    : asText(entity.summary);

  return {
    entity_id: entity.id,
    entity_name: entity.name,
    remove_target: asText(item.remove_target) || entity.name,
    retain_target: asText(item.retain_target) || entity.name,
    keep_role: asText(item.keep_role) || asText(entity.summary) || `${entity.name} 负责关键能力承接`,
    remove_impact: asText(item.remove_impact) || `${entity.name} 被去除后会影响关键能力稳定性`,
    observation: asText(item.observation),
    evidence: asText(item.evidence) || fallbackEvidence,
  };
}

function parseProbabilityValue(value) {
  const text = asText(value);
  const matched = text.match(/-?\d+(?:\.\d+)?/);
  if (!matched) {
    return null;
  }
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProbabilityDecision(raw, entity, label) {
  const item = asRecord(raw);
  const probability = asText(item.probability);
  const probabilityValue = parseProbabilityValue(probability);
  if (probabilityValue === null) {
    throw new Error(`${label} 未返回可解析的 probability`);
  }

  return {
    entity_id: entity.id,
    entity_name: entity.name,
    probability,
    reason: asText(item.reason),
    probability_value: probabilityValue,
  };
}

export class SystemAdapter {
  constructor(options = {}) {
    this.llmJsonInvoker = typeof options.llmJsonInvoker === "function" ? options.llmJsonInvoker : null;
  }

  async generateAblationCandidates(input = {}) {
    if (!this.llmJsonInvoker) {
      throw new Error("system adapter is not configured");
    }

    const entities = Array.isArray(input.entities) ? input.entities : [];
    const relations = Array.isArray(input.relations) ? input.relations : [];
    const normalizedEntities = entities.map((entity) => ({
      id: asText(entity.id),
      name: asText(entity.name),
      summary: asText(entity.summary),
      citations: Array.isArray(entity.citations) ? entity.citations.map((citation) => asText(citation)).filter(Boolean) : [],
    })).filter((entity) => entity.id && entity.name);

    try {
      const llmResult = await this.llmJsonInvoker({
        stage: "节点3-消融候选",
        instruction: [
          "你现在只负责生成消融候选 ablation_candidates，不负责计算保留概率、去除概率和概率差。",
          "ablation_candidates 的每项必须包含：entity_id、entity_name、remove_target、retain_target、keep_role、remove_impact、observation、evidence。",
          "依据与结论都要简短，以控制响应时间。",
        ].join("\n"),
        payload: {
          entities: normalizedEntities,
          relations: relations.map((relation) => ({
            source_name: asText(relation.source_name),
            target_name: asText(relation.target_name),
            relation_type: asText(relation.relation_type),
            evidence: asText(relation.evidence),
          })),
        },
      });

      const llmPayload = llmResult?.data ?? llmResult;
      const entityById = new Map(normalizedEntities.map((entity) => [entity.id, entity]));
      const entityByName = new Map(normalizedEntities.map((entity) => [entity.name, entity]));
      const candidates = extractAblationCandidates(llmPayload)
        .map((item) => normalizeAblationCandidate(item, entityById, entityByName))
        .filter(Boolean);

      return {
        candidate_count: candidates.length,
        candidates,
        llm_raw: llmResult?.llm_raw ?? llmPayload,
        llm_raw_text: asText(llmResult?.llm_raw_text),
        llm_response: llmResult?.llm_response,
      };
    } catch (error) {
      throw attachStageDebug(error, {
        llm_raw_text: asText(error?.stageOutput?.llm_raw_text),
        llm_raw: error?.stageOutput?.llm_raw,
        llm_response: error?.stageOutput?.llm_response,
        debug_error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async judgeAblationCandidate(input = {}) {
    if (!this.llmJsonInvoker) {
      throw new Error("system adapter is not configured");
    }

    const entity = asRecord(input.entity);
    const candidate = asRecord(input.candidate);
    const entities = Array.isArray(input.entities) ? input.entities : [];
    const relations = Array.isArray(input.relations) ? input.relations : [];

    if (!asText(entity.id) || !asText(entity.name)) {
      throw new Error("system adapter requires a valid entity context");
    }

    const focusEntity = {
      entity_id: asText(entity.id),
      entity_name: asText(entity.name),
      summary: asText(entity.summary),
      abilities: Array.isArray(entity.abilities) ? entity.abilities.map((item) => asText(item)).filter(Boolean) : [],
      citations: Array.isArray(entity.citations) ? entity.citations.map((item) => asText(item)).filter(Boolean).slice(0, 2) : [],
      keep_role: asText(candidate.keep_role),
      remove_impact: asText(candidate.remove_impact),
      observation: asText(candidate.observation),
      evidence: asText(candidate.evidence),
    };

    const relatedRelations = relations
      .filter((relation) => asText(relation.source_entity_id) === focusEntity.entity_id || asText(relation.target_entity_id) === focusEntity.entity_id)
      .map((relation) => ({
        source_name: asText(relation.source_name),
        target_name: asText(relation.target_name),
        relation_type: asText(relation.relation_type),
        evidence: asText(relation.evidence),
      }));

    const remainingEntities = entities
      .filter((item) => asText(item.id) && asText(item.id) !== focusEntity.entity_id)
      .map((item) => ({
        id: asText(item.id),
        name: asText(item.name),
        summary: asText(item.summary),
        citations: Array.isArray(item.citations) ? item.citations.map((citation) => asText(citation)).filter(Boolean).slice(0, 2) : [],
      }));

    const remainingRelations = relations
      .filter((relation) => asText(relation.source_entity_id) !== focusEntity.entity_id && asText(relation.target_entity_id) !== focusEntity.entity_id)
      .map((relation) => ({
        source_name: asText(relation.source_name),
        target_name: asText(relation.target_name),
        relation_type: asText(relation.relation_type),
        evidence: asText(relation.evidence),
      }));

    let keepResult = null;
    let removeResult = null;

    try {
      keepResult = await this.llmJsonInvoker({
        stage: "小故-保留概率",
        instruction: [
          "你是一个专业、准确的本体概率判断专家。",
          "你现在只判断：在保留当前实体的情况下，该对象作为真实本体的概率。",
          "你必须根据输入中的 focus_entity、entities 和 related_relations 综合判断后，返回最终百分比。",
          "你必须严格遵守以下规则：",
          "1. 必须返回符合 schema 的 JSON 对象，禁止输出 Markdown、代码块、额外说明或任何非 JSON 内容。",
          '2. 输出结构必须严格为 {"probability":"97%","reason":"中文原因"}，且只能包含这两个字段。',
          "3. probability 必须是百分比字符串，例如 97%、2%、100%，不得使用小数。",
          "4. reason 必须使用简短中文说明保留该实体时的判断依据。",
          "5. 即使输入信息不足、含糊、异常，也必须严格按上述 JSON 结构输出。",
        ].join("\n"),
        payload: {
          focus_entity: focusEntity,
          entities: entities.map((item) => ({
            id: asText(item.id),
            name: asText(item.name),
            summary: asText(item.summary),
            citations: Array.isArray(item.citations) ? item.citations.map((citation) => asText(citation)).filter(Boolean).slice(0, 2) : [],
          })),
          relations: relations.map((relation) => ({
            source_name: asText(relation.source_name),
            target_name: asText(relation.target_name),
            relation_type: asText(relation.relation_type),
            evidence: asText(relation.evidence),
          })),
          related_relations: relatedRelations,
        },
        responseSchema: PROBABILITY_DECISION_RESPONSE_SCHEMA,
      });

      removeResult = await this.llmJsonInvoker({
        stage: "小故-去除概率",
        instruction: [
          "你是一个专业、准确的本体概率判断专家。",
          "你现在只判断：在去除当前实体后，该对象作为真实本体的概率。",
          "你必须根据输入中的 focus_entity、remaining_entities 和 remaining_relations 综合判断后，返回最终百分比。",
          "你必须严格遵守以下规则：",
          "1. 必须返回符合 schema 的 JSON 对象，禁止输出 Markdown、代码块、额外说明或任何非 JSON 内容。",
          '2. 输出结构必须严格为 {"probability":"97%","reason":"中文原因"}，且只能包含这两个字段。',
          "3. probability 必须是百分比字符串，例如 97%、2%、100%，不得使用小数。",
          "4. reason 必须使用简短中文说明去除该实体后的影响。",
          "5. 即使输入信息不足、含糊、异常，也必须严格按上述 JSON 结构输出。",
        ].join("\n"),
        payload: {
          focus_entity: focusEntity,
          removed_entity: {
            entity_id: focusEntity.entity_id,
            entity_name: focusEntity.entity_name,
          },
          remaining_entities: remainingEntities,
          remaining_relations: remainingRelations,
          related_relations: relatedRelations,
        },
        responseSchema: PROBABILITY_DECISION_RESPONSE_SCHEMA,
      });
    } catch (error) {
      throw attachStageDebug(error, {
        llm_raw: {
          candidate,
          keep_result: keepResult?.llm_raw ?? keepResult?.data ?? keepResult,
          remove_result: removeResult?.llm_raw ?? removeResult?.data ?? removeResult,
        },
        llm_raw_text: `${asText(keepResult?.llm_raw_text)}\n${asText(removeResult?.llm_raw_text)}`.trim(),
        llm_response: {
          keep_result: keepResult?.llm_response,
          remove_result: removeResult?.llm_response,
        },
        debug_error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const keepDecision = normalizeProbabilityDecision(
        keepResult?.data ?? keepResult,
        entity,
        `${focusEntity.entity_name} 保留概率判断`,
      );
      const removeDecision = normalizeProbabilityDecision(
        removeResult?.data ?? removeResult,
        entity,
        `${focusEntity.entity_name} 去除概率判断`,
      );

      return {
        keepDecision,
        removeDecision,
        focusEntity,
        relatedRelations,
        remainingEntities,
        remainingRelations,
        llm_raw: {
          keep_result: keepResult?.llm_raw ?? keepResult?.data ?? keepResult,
          remove_result: removeResult?.llm_raw ?? removeResult?.data ?? removeResult,
        },
        llm_raw_text: `${asText(keepResult?.llm_raw_text)}\n${asText(removeResult?.llm_raw_text)}`.trim(),
        llm_response: {
          keep_result: keepResult?.llm_response,
          remove_result: removeResult?.llm_response,
        },
      };
    } catch (error) {
      throw attachStageDebug(error, {
        llm_raw: {
          candidate,
          keep_result: keepResult?.llm_raw ?? keepResult?.data ?? keepResult,
          remove_result: removeResult?.llm_raw ?? removeResult?.data ?? removeResult,
        },
        llm_raw_text: `${asText(keepResult?.llm_raw_text)}\n${asText(removeResult?.llm_raw_text)}`.trim(),
        llm_response: {
          keep_result: keepResult?.llm_response,
          remove_result: removeResult?.llm_response,
        },
        debug_error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
