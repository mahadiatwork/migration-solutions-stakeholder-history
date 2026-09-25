import {
  PICKLIST_CONFIG_MODULE,
  PICKLIST_CONFIG_FIELDS,
  dataCenterMap,
  conn_name,
} from "../config/config";
import {
  mandatoryActivityTypes,
  typeOptions as defaultTypeOptions,
  resultMapping as defaultResultMapping,
  durationOptions as defaultDurationOptions,
} from "../components/organisms/dialogConstants";

const ZOHO = window.ZOHO;
const MODULE_API_NAMES = [PICKLIST_CONFIG_MODULE, "CustomModule15"];

let cachedConfig = null;
let fetchPromise = null;

const buildFallbackConfig = () => ({
  types: defaultTypeOptions,
  results: null,
  resultMapping: defaultResultMapping,
  regarding: null,
  durations: defaultDurationOptions,
  _source: "fallback",
});

export const fetchPicklistConfig = async () => {
  if (cachedConfig?._source === "custom_module") return cachedConfig;
  if (fetchPromise) return fetchPromise;

  fetchPromise = loadPicklistConfig();
  try {
    const config = await fetchPromise;
    if (config?._source === "custom_module") cachedConfig = config;
    return config;
  } finally {
    fetchPromise = null;
  }
};

export const clearPicklistConfigCache = () => {
  cachedConfig = null;
  fetchPromise = null;
};

const loadPicklistConfig = async () => {
  try {
    if (!ZOHO?.CRM) return buildFallbackConfig();

    let readResult = await fetchViaSdk();
    if (!readResult.reached) readResult = await fetchViaCoql();

    if (!readResult.reached) {
      console.warn("Widget_Picklist_Config is unavailable; using defaults.");
    }
    return buildConfigFromReadResult(readResult);
  } catch (error) {
    console.warn(
      "Widget_Picklist_Config could not be loaded; using defaults.",
      error
    );
    return buildFallbackConfig();
  }
};

const fieldValue = (value) => {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object") {
    return (
      value.display_value ||
      value.actual_value ||
      value.name ||
      value.Name ||
      ""
    );
  }
  return String(value);
};

const isActive = (record) => {
  const value = record?.[PICKLIST_CONFIG_FIELDS.active];
  return (
    value === true ||
    value === "true" ||
    value === 1 ||
    value === "1" ||
    value === "Yes"
  );
};

export const buildConfigFromReadResult = ({ reached, records = [] }) =>
  reached
    ? groupRecords(records.filter(isActive))
    : buildFallbackConfig();

const extractRecords = (response) => {
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.data)) return response.data.data;
  if (Array.isArray(response)) return response;
  return [];
};

const responseEntries = (response) => [
  response,
  response?.data,
  ...(Array.isArray(response?.data) ? response.data : []),
  ...(Array.isArray(response?.data?.data) ? response.data.data : []),
].filter((entry) => entry && typeof entry === "object");

const isUnavailableResponse = (response) =>
  responseEntries(response).some(
    (entry) =>
      entry?.code === "INVALID_MODULE" ||
      entry?.code === "INVALID_MODULE_API_NAME"
  );

const isErrorResponse = (response) =>
  responseEntries(response).some((entry) => {
    const code = typeof entry?.code === "string" ? entry.code : "";
    return (
      entry?.status === "error" ||
      entry?.status === "failure" ||
      Number(entry?.statusCode) >= 400 ||
      (code !== "" &&
        code !== "SUCCESS" &&
        code !== "NO_DATA" &&
        code !== "NO_CONTENT" &&
        code !== "200")
    );
  });

const isSuccessfulEmptyResponse = (response) =>
  responseEntries(response).some(
    (entry) => entry?.code === "NO_DATA" || entry?.code === "NO_CONTENT"
  );

const hasRecordPayload = (response) =>
  Array.isArray(response?.data) ||
  Array.isArray(response?.data?.data) ||
  Array.isArray(response);

const hasMoreRecords = (response) => {
  const value = response?.info?.more_records ?? response?.data?.info?.more_records;
  return value === true || value === "true";
};

const fetchViaSdk = async () => {
  for (const entity of MODULE_API_NAMES) {
    const result = await paginateSdk(entity);
    if (result.reached) return result;
  }
  return { reached: false, records: [] };
};

const paginateSdk = async (entity) => {
  const records = [];
  const perPage = 200;
  const seenPages = new Set();
  let page = 1;

  while (true) {
    let response;
    try {
      if (typeof ZOHO.CRM.API.getAllRecords === "function") {
        response = await ZOHO.CRM.API.getAllRecords({
          Entity: entity,
          sort_order: "asc",
          per_page: perPage,
          page,
        });
      } else if (typeof ZOHO.CRM.API.getRecords === "function") {
        response = await ZOHO.CRM.API.getRecords({
          Entity: entity,
          sort_order: "asc",
          per_page: perPage,
          page,
        });
      } else {
        return { reached: false, records: [] };
      }
    } catch (error) {
      console.warn(`Pick-list SDK read failed for ${entity}:`, error);
      return { reached: false, records: [] };
    }

    if (isUnavailableResponse(response)) {
      return { reached: false, records: [] };
    }

    if (isSuccessfulEmptyResponse(response)) {
      return { reached: true, records };
    }

    if (isErrorResponse(response)) {
      return { reached: false, records: [] };
    }

    if (!hasRecordPayload(response)) {
      return { reached: false, records: [] };
    }

    const chunk = extractRecords(response);
    const hasMore = hasMoreRecords(response);
    const signature = JSON.stringify(chunk);
    if (hasMore && seenPages.has(signature)) {
      return { reached: false, records: [] };
    }
    seenPages.add(signature);
    records.push(...chunk);
    if (!hasMore) break;
    if (chunk.length === 0) return { reached: false, records: [] };
    page += 1;
  }

  return { reached: true, records };
};

const parseCoqlResponse = (response) => {
  const rawStatusMessage = response?.details?.statusMessage;
  let statusMessage = rawStatusMessage;

  if (typeof rawStatusMessage === "string" && rawStatusMessage.trim()) {
    try {
      statusMessage = JSON.parse(rawStatusMessage);
    } catch {
      statusMessage = null;
    }
  }

  const candidates = [statusMessage, response?.details, response].filter(
    (candidate) => candidate && typeof candidate === "object"
  );
  let records = null;
  let hasMoreMetadata = false;
  let moreRecords = false;
  for (const candidate of candidates) {
    if (Array.isArray(candidate.data)) {
      records = candidate.data;
    }
    if (candidate?.info?.more_records != null) {
      hasMoreMetadata = true;
      moreRecords =
        candidate.info.more_records === true ||
        candidate.info.more_records === "true";
    }
  }
  return { records, hasMoreMetadata, moreRecords };
};

const coqlResponseEntries = (response) => {
  const rawStatusMessage = response?.details?.statusMessage;
  let parsedStatusMessage = rawStatusMessage;
  if (typeof rawStatusMessage === "string" && rawStatusMessage.trim()) {
    try {
      parsedStatusMessage = JSON.parse(rawStatusMessage);
    } catch {
      parsedStatusMessage = null;
    }
  }

  return [
    response,
    ...(response?.data &&
    typeof response.data === "object" &&
    !Array.isArray(response.data)
      ? [response.data]
      : []),
    response?.details,
    parsedStatusMessage,
    ...(Array.isArray(response?.data) ? response.data : []),
    ...(Array.isArray(parsedStatusMessage?.data)
      ? parsedStatusMessage.data
      : []),
  ].filter((entry) => entry && typeof entry === "object");
};

const isInvalidOrFailedCoqlResponse = (response) =>
  coqlResponseEntries(response).some((entry) => {
    const code = typeof entry?.code === "string" ? entry.code : "";
    return (
      entry?.status === "error" ||
      entry?.status === "failure" ||
      Number(entry?.statusCode) >= 400 ||
      (code !== "" &&
        code !== "SUCCESS" &&
        code !== "NO_DATA" &&
        code !== "NO_CONTENT" &&
        code !== "200")
    );
  });

const isSuccessfulEmptyCoqlResponse = (response) =>
  coqlResponseEntries(response).some(
    (entry) => entry?.code === "NO_DATA" || entry?.code === "NO_CONTENT"
  );

const fetchViaCoql = async () => {
  if (!ZOHO?.CRM?.CONNECTION?.invoke) {
    return { reached: false, records: [] };
  }

  const { name, category, parentType, sortOrder, active } =
    PICKLIST_CONFIG_FIELDS;
  const pageSize = 2000;

  for (const moduleApiName of MODULE_API_NAMES) {
    const records = [];
    const seenPages = new Set();
    let offset = 0;

    while (true) {
      const selectQuery = `select ${name}, ${category}, ${parentType}, ${sortOrder}, ${active} from ${moduleApiName} where ${active} = true order by ${sortOrder} asc LIMIT ${offset}, ${pageSize}`;
      try {
        const response = await ZOHO.CRM.CONNECTION.invoke(conn_name, {
          url: `${dataCenterMap.AU}/crm/v8/coql`,
          method: "POST",
          param_type: 2,
          parameters: { select_query: selectQuery },
        });
        if (isSuccessfulEmptyCoqlResponse(response)) {
          return { reached: true, records };
        }
        if (isInvalidOrFailedCoqlResponse(response)) break;

        const parsed = parseCoqlResponse(response);
        if (parsed.records === null) break;

        const signature = JSON.stringify(parsed.records);
        const shouldContinue = parsed.hasMoreMetadata
          ? parsed.moreRecords
          : parsed.records.length === pageSize;
        if (shouldContinue && seenPages.has(signature)) break;
        seenPages.add(signature);
        records.push(...parsed.records);

        if (!shouldContinue) return { reached: true, records };
        if (parsed.records.length === 0) break;
        offset += pageSize;
      } catch (error) {
        console.warn(`Pick-list COQL read failed for ${moduleApiName}:`, error);
        break;
      }
    }
  }

  return { reached: false, records: [] };
};

const pushUnique = (list, value) => {
  if (value && !list.includes(value)) list.push(value);
};

const sortRank = (value) => {
  const rank = Number(value);
  return Number.isFinite(rank) ? rank : 9999;
};

const normalizedCategory = (value) => {
  const category = fieldValue(value).trim().toLowerCase();
  if (category === "type" || category === "history type") return "type";
  if (category === "result" || category === "history result") return "result";
  if (category === "regarding") return "regarding";
  if (category === "duration") return "duration";
  return "";
};

export const groupRecords = (records) => {
  const { name, category, parentType, sortOrder } = PICKLIST_CONFIG_FIELDS;
  const types = [];
  const results = {};
  const regarding = {};
  const durations = [];

  const sortedRecords = [...records].sort(
    (left, right) =>
      sortRank(left?.[sortOrder]) - sortRank(right?.[sortOrder])
  );

  for (const record of sortedRecords) {
    const value = fieldValue(record?.[name]);
    const recordCategory = normalizedCategory(record?.[category]);
    const parent = fieldValue(record?.[parentType]) || "_default";
    if (!value) continue;

    if (recordCategory === "type") pushUnique(types, value);
    if (recordCategory === "result") {
      if (!results[parent]) results[parent] = [];
      pushUnique(results[parent], value);
    }
    if (recordCategory === "regarding") {
      if (!regarding[parent]) regarding[parent] = [];
      pushUnique(regarding[parent], value);
    }
    if (recordCategory === "duration") {
      const duration = Number.parseInt(value, 10);
      if (Number.isFinite(duration)) pushUnique(durations, duration);
    }
  }

  const resultMapping = {};
  for (const [parent, options] of Object.entries(results)) {
    if (parent !== "_default" && options.length) {
      resultMapping[parent] = options[0];
    }
  }

  return {
    types,
    results,
    resultMapping,
    regarding,
    durations,
    _source: "custom_module",
  };
};

export const getTypeOptionsFromConfig = (config) => {
  if (config?._source === "custom_module") return config.types || [];
  return config?.types?.length ? config.types : defaultTypeOptions;
};

export const getDurationOptionsFromConfig = (config) => {
  const configuredDurations = (config?.durations || [])
    .map((value) => Number(value))
    .filter(Number.isFinite);
  if (config?._source === "custom_module") return configuredDurations;
  return configuredDurations.length
    ? configuredDurations
    : defaultDurationOptions;
};

const mandatoryResultMapping = Object.fromEntries(
  Object.entries(mandatoryActivityTypes).map(([category, values]) => [
    category,
    values[0],
  ])
);

export const getResultMappingFromConfig = (config) => {
  if (config?._source === "custom_module") {
    return config.resultMapping || {};
  }
  return {
    ...defaultResultMapping,
    ...(config?.resultMapping && Object.keys(config.resultMapping).length
      ? config.resultMapping
      : {}),
    ...mandatoryResultMapping,
  };
};
