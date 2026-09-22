import {
  PICKLIST_CONFIG_MODULE,
  PICKLIST_CONFIG_FIELDS,
  PICKLIST_CATEGORIES,
  dataCenterMap,
  conn_name,
} from "../config/config";
import {
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

    let records = await fetchViaSdk();
    if (!records.length) records = await fetchViaCoql();

    const activeRecords = records.filter(isActive);
    if (!activeRecords.length) {
      console.warn(
        "Widget_Picklist_Config returned no active records; using defaults."
      );
      return buildFallbackConfig();
    }

    return groupRecords(activeRecords);
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

const extractRecords = (response) => {
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response)) return response;
  return [];
};

const fetchViaSdk = async () => {
  for (const entity of MODULE_API_NAMES) {
    const records = await paginateSdk(entity);
    if (records.length) return records;
  }
  return [];
};

const paginateSdk = async (entity) => {
  const records = [];
  const perPage = 200;

  for (let page = 1; page <= 10; page += 1) {
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
        return [];
      }
    } catch (error) {
      console.warn(`Pick-list SDK read failed for ${entity}:`, error);
      return [];
    }

    if (response?.status === "error" || response?.code === "INVALID_MODULE") {
      return [];
    }

    const chunk = extractRecords(response);
    records.push(...chunk);
    const hasMore =
      response?.info?.more_records === true ||
      response?.info?.more_records === "true";
    if (chunk.length < perPage || !hasMore) break;
  }

  return records;
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
  for (const candidate of candidates) {
    if (Array.isArray(candidate.data) && candidate.data.length) {
      return candidate.data;
    }
  }
  return [];
};

const fetchViaCoql = async () => {
  if (!ZOHO?.CRM?.CONNECTION?.invoke) return [];

  const { name, category, parentType, sortOrder, active } =
    PICKLIST_CONFIG_FIELDS;

  for (const moduleApiName of MODULE_API_NAMES) {
    const selectQuery = `select ${name}, ${category}, ${parentType}, ${sortOrder}, ${active} from ${moduleApiName} where ${active} = true order by ${sortOrder} asc LIMIT 0, 2000`;
    try {
      const response = await ZOHO.CRM.CONNECTION.invoke(conn_name, {
        url: `${dataCenterMap.AU}/crm/v8/coql`,
        method: "POST",
        param_type: 2,
        parameters: { select_query: selectQuery },
      });
      const records = parseCoqlResponse(response);
      if (records.length) return records;
    } catch (error) {
      console.warn(`Pick-list COQL read failed for ${moduleApiName}:`, error);
    }
  }

  return [];
};

const pushUnique = (list, value) => {
  if (value && !list.includes(value)) list.push(value);
};

const groupRecords = (records) => {
  const { name, category, parentType, sortOrder } = PICKLIST_CONFIG_FIELDS;
  const { TYPE, RESULT, REGARDING, DURATION } = PICKLIST_CATEGORIES;
  const types = [];
  const results = {};
  const regarding = {};
  const durations = [];

  const sortedRecords = [...records].sort(
    (left, right) =>
      (Number(left?.[sortOrder]) || 9999) -
      (Number(right?.[sortOrder]) || 9999)
  );

  for (const record of sortedRecords) {
    const value = fieldValue(record?.[name]);
    const recordCategory = fieldValue(record?.[category]);
    const parent = fieldValue(record?.[parentType]) || "_default";
    if (!value) continue;

    if (recordCategory === TYPE) pushUnique(types, value);
    if (recordCategory === RESULT) {
      if (!results[parent]) results[parent] = [];
      pushUnique(results[parent], value);
    }
    if (recordCategory === REGARDING) {
      if (!regarding[parent]) regarding[parent] = [];
      pushUnique(regarding[parent], value);
    }
    if (recordCategory === DURATION) {
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
    types: types.length ? types : defaultTypeOptions,
    results: Object.keys(results).length ? results : null,
    resultMapping: Object.keys(resultMapping).length
      ? resultMapping
      : defaultResultMapping,
    regarding: Object.keys(regarding).length ? regarding : null,
    durations: durations.length ? durations : defaultDurationOptions,
    _source: "custom_module",
  };
};

export const getTypeOptionsFromConfig = (config) =>
  config?.types?.length ? config.types : defaultTypeOptions;

export const getDurationOptionsFromConfig = (config) =>
  config?.durations?.length ? config.durations : defaultDurationOptions;

export const getResultMappingFromConfig = (config) =>
  config?.resultMapping && Object.keys(config.resultMapping).length
    ? config.resultMapping
    : defaultResultMapping;
