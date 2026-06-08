/* =============================================================================
 * data-adapter.js - backend integration point
 * -----------------------------------------------------------------------------
 * Mock data has been removed. Edit API_ENDPOINTS / API_HEADERS below to match
 * your real backend.
 *
 * UI(app.js) uses only:
 *   1) RagEval.CONFIG
 *   2) RagEval.loadRegistry()    -> Promise<Row[]>
 *   3) RagEval.searchPgVector(q) -> Promise<{ result: SearchResult[] }>
 * ========================================================================== */
(function () {
  'use strict';

  const CONFIG = {
    passTopK: 3,
    questionCount: 5,
    resultSize: 5,
  };

  const API_ENDPOINTS = {
    // TODO: change to your api_registry endpoint.
    // Expected response: Row[] or { rows: Row[] } or { data: Row[] }.
    registry: '/api/api-registry',

    // TODO: change to your search_pg_vector endpoint.
    // Called with POST body: { userquery: string, limit: CONFIG.resultSize }.
    // Expected response: { result: SearchResult[] } or SearchResult[].
    search: '/api/search-pg-vector',
  };

  const API_HEADERS = {
    'Content-Type': 'application/json',
    // TODO: add auth if needed.
    // Authorization: 'Bearer ...',
  };

  const FIELD_MAP = {
    registry: {
      query_id: ['query_id', 'api_id', 'id'],
      app: ['app', 'service', 'domain'],
      author: ['author', 'owner', 'created_by'],
      tables: ['tables', 'table_names', 'table_name'],
      description: ['description', 'desc'],
      summary: ['summary'],
      questions: ['questions', 'eval_questions', 'test_questions'],
      content: ['content', 'document', 'text'],
    },
    search: {
      api_id: ['api_id', 'query_id', 'id'],
      similarity: ['similarity', 'score', 'distance'],
      content: ['content', 'document', 'text'],
      tables: ['tables', 'table_names', 'table_name'],
      author: ['author', 'owner', 'created_by'],
    },
  };

  function pick(obj, keys, fallback = '') {
    for (const key of keys) {
      if (obj && obj[key] != null) return obj[key];
    }
    return fallback;
  }

  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      return value
        .split(/\r?\n|[|;]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  function toText(value) {
    if (Array.isArray(value)) return value.join(',');
    if (value == null) return '';
    return String(value);
  }

  function parseContent(content) {
    const lines = toText(content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return {
      description: lines[0] || '',
      summary: lines[1] || '',
      questions: lines.slice(2, 2 + CONFIG.questionCount),
    };
  }

  async function requestJson(url, options) {
    const res = await fetch(url, options);
    const bodyText = await res.text();
    let body = null;

    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch (err) {
        throw new Error(`${url} returned non-JSON response`);
      }
    }

    if (!res.ok) {
      const message = body && (body.message || body.error || body.detail);
      throw new Error(message || `${url} failed with HTTP ${res.status}`);
    }

    return body;
  }

  function unwrapRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload && payload.rows)) return payload.rows;
    if (Array.isArray(payload && payload.data)) return payload.data;
    if (Array.isArray(payload && payload.result)) return payload.result;
    return [];
  }

  function normalizeRegistryRow(raw) {
    const map = FIELD_MAP.registry;
    const queryId = toText(pick(raw, map.query_id)).trim();
    const content = toText(pick(raw, map.content)).trim();
    const parsed = parseContent(content);
    const description = toText(pick(raw, map.description, parsed.description)).trim();
    const summary = toText(pick(raw, map.summary, parsed.summary)).trim();
    const explicitQuestions = toArray(pick(raw, map.questions));
    const questions = (explicitQuestions.length ? explicitQuestions : parsed.questions)
      .slice(0, CONFIG.questionCount);

    return {
      query_id: queryId,
      app: toText(pick(raw, map.app, '-')),
      author: toText(pick(raw, map.author, '-')),
      tables: toText(pick(raw, map.tables, '-')),
      description: description || content.split('\n')[0] || queryId,
      summary,
      questions: questions.length ? questions : [description || content || queryId],
      content,
    };
  }

  function normalizeSearchResult(raw) {
    const map = FIELD_MAP.search;
    const similarity = Number(pick(raw, map.similarity, 0));

    return {
      api_id: toText(pick(raw, map.api_id)).trim(),
      similarity: Number.isFinite(similarity) ? similarity : 0,
      content: toText(pick(raw, map.content)),
      tables: toText(pick(raw, map.tables, '-')),
      author: toText(pick(raw, map.author, '-')),
    };
  }

  async function loadRegistry() {
    const payload = await requestJson(API_ENDPOINTS.registry, {
      method: 'GET',
      headers: API_HEADERS,
    });

    return unwrapRows(payload)
      .map(normalizeRegistryRow)
      .filter((row) => row.query_id);
  }

  async function searchPgVector(userquery) {
    const payload = await requestJson(API_ENDPOINTS.search, {
      method: 'POST',
      headers: API_HEADERS,
      body: JSON.stringify({
        userquery,
        limit: CONFIG.resultSize,
      }),
    });

    const result = unwrapRows(payload)
      .map(normalizeSearchResult)
      .filter((row) => row.api_id);

    return { result };
  }

  window.RagEval = { CONFIG, API_ENDPOINTS, API_HEADERS, FIELD_MAP, loadRegistry, searchPgVector };
})();
