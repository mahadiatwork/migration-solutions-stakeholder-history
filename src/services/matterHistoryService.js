import { conn_name, dataCenterMap } from "../config/config";

const ZOHO = window.ZOHO;

export const MATTER_MODULE = "Applications";
export const STAKEHOLDER_MODULE = "Accounts";
export const STAKEHOLDER_MATTERS_RELATED_LIST = "Applications";

export const MATTER_SOURCE_FIELDS = {
  id: "id",
  matterNo: "Name",
  currentStage: "Current_Stage",
  matterProgress: "Matter_Progress",
  modifiedTime: "Modified_Time",
  createdTime: "Created_Time",
};

export const HISTORY_MATTER_FIELDS = {
  matter: "Matter",
  matterNo: "Matter_No",
  currentStage: "Current_Stage",
  matterProgress: "Matter_Progress",
  billingType: "Billing_Type",
};

export const BILLING_TYPE_OPTIONS = [
  "Billable",
  "Non-Billable",
  "Write-Off",
];

const asArray = (value) => (Array.isArray(value) ? value : []);

const picklistValue = (value) => {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object") {
    return String(
      value.actual_value ?? value.display_value ?? value.name ?? value.value ?? ""
    );
  }
  return "";
};

const firstPicklistValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(picklistValue).find(Boolean) || "";
  }
  return picklistValue(value);
};

export const normalizeMatterPicklistValue = firstPicklistValue;

const isAvailablePicklistValue = (value) => {
  if (!value || typeof value !== "object") return true;
  const type = String(value.type ?? "").toLowerCase();
  return (
    value.active !== false &&
    value.used !== false &&
    !Object.prototype.hasOwnProperty.call(value, "_delete") &&
    type !== "unused" &&
    type !== "inactive"
  );
};

const uniqueValues = (values) => [
  ...new Set(
    values
      .filter(isAvailablePicklistValue)
      .map(picklistValue)
      .filter(Boolean)
  ),
];

export const selectMostRecentlyModifiedMatter = (matters = []) => {
  if (!Array.isArray(matters) || matters.length === 0) return null;

  const { modifiedTime, createdTime } = MATTER_SOURCE_FIELDS;
  return [...matters].sort((left, right) => {
    const leftTime = new Date(
      left?.[modifiedTime] || left?.[createdTime] || 0
    ).getTime();
    const rightTime = new Date(
      right?.[modifiedTime] || right?.[createdTime] || 0
    ).getTime();
    return rightTime - leftTime;
  })[0];
};

export const getMatterLayoutId = (matter) =>
  matter?.Layout?.id ??
  matter?.layout?.id ??
  matter?.$layout_id?.id ??
  matter?.$layout_id ??
  null;

export const buildMatterFormSnapshot = (matter) => {
  if (!matter?.id) {
    return {
      matter: null,
      matterNo: "",
      currentStage: "",
      matterProgress: "",
      billingType: BILLING_TYPE_OPTIONS[0],
    };
  }

  return {
    matter: {
      id: matter.id,
      name: picklistValue(matter[MATTER_SOURCE_FIELDS.matterNo]),
      layoutId: getMatterLayoutId(matter),
    },
    matterNo: picklistValue(matter[MATTER_SOURCE_FIELDS.matterNo]),
    currentStage: firstPicklistValue(
      matter[MATTER_SOURCE_FIELDS.currentStage]
    ),
    matterProgress: firstPicklistValue(
      matter[MATTER_SOURCE_FIELDS.matterProgress]
    ),
    billingType: BILLING_TYPE_OPTIONS[0],
  };
};

export const fetchLatestMatterForStakeholder = async (
  stakeholderId,
  api = ZOHO?.CRM?.API
) => {
  if (!stakeholderId) return null;

  const fields = [
    MATTER_SOURCE_FIELDS.id,
    MATTER_SOURCE_FIELDS.matterNo,
    MATTER_SOURCE_FIELDS.currentStage,
    MATTER_SOURCE_FIELDS.matterProgress,
    MATTER_SOURCE_FIELDS.modifiedTime,
    MATTER_SOURCE_FIELDS.createdTime,
  ].join(",");

  const response = await api.getRelatedRecords({
    Entity: STAKEHOLDER_MODULE,
    RecordID: stakeholderId,
    RelatedList: STAKEHOLDER_MATTERS_RELATED_LIST,
    page: 1,
    per_page: 200,
    fields,
  });

  const relatedMatter = selectMostRecentlyModifiedMatter(response?.data || []);
  return hydrateMatterRecord(relatedMatter, api);
};

export const hydrateMatterRecord = async (
  matter,
  api = ZOHO?.CRM?.API
) => {
  if (!matter?.id || !api?.getRecord) return matter;

  try {
    const response = await api.getRecord({
      Entity: MATTER_MODULE,
      RecordID: matter.id,
      approved: "both",
    });
    const hydratedMatter = response?.data?.[0];
    return hydratedMatter ? { ...matter, ...hydratedMatter } : matter;
  } catch (error) {
    console.warn("Could not hydrate stakeholder matter record:", error);
    return matter;
  }
};

const parseStatusMessage = (response) => {
  const raw = response?.details?.statusMessage;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
};

const responsePayloads = (response) =>
  [parseStatusMessage(response), response?.details, response].filter(
    (value) => value && typeof value === "object"
  );

const extractLayouts = (response) => {
  for (const payload of responsePayloads(response)) {
    if (Array.isArray(payload.layouts)) return payload.layouts;
    if (Array.isArray(payload.data)) return payload.data;
  }
  return [];
};

const extractMapDependencies = (response) => {
  for (const payload of responsePayloads(response)) {
    if (Array.isArray(payload.map_dependency)) return payload.map_dependency;
  }
  return [];
};

const flattenLayoutFields = (layout) =>
  asArray(layout?.sections).flatMap((section) => asArray(section?.fields));

const dependencyMapFromValues = (values) => {
  const mapping = {};
  for (const parentValue of asArray(values)) {
    if (!isAvailablePicklistValue(parentValue)) continue;
    const parent = picklistValue(parentValue);
    if (!parent || !Array.isArray(parentValue?.maps)) continue;
    mapping[parent] = uniqueValues(parentValue.maps);
  }
  return mapping;
};

const isMatterProgressDependency = (dependency) =>
  dependency?.parent?.api_name === MATTER_SOURCE_FIELDS.currentStage &&
  dependency?.child?.api_name === MATTER_SOURCE_FIELDS.matterProgress &&
  isAvailablePicklistValue(dependency);

export const extractMatterMetadataFromLayout = (layout) => {
  const fields = flattenLayoutFields(layout);
  const stageField = fields.find(
    (field) => field?.api_name === MATTER_SOURCE_FIELDS.currentStage
  );
  const progressField = fields.find(
    (field) => field?.api_name === MATTER_SOURCE_FIELDS.matterProgress
  );
  const stageValues = asArray(stageField?.pick_list_values);
  const embeddedDependencies = dependencyMapFromValues(stageValues);

  const layoutDependencies = asArray(
    layout?.map_dependency ?? layout?.map_dependencies
  ).find(isMatterProgressDependency);

  return {
    layoutId: layout?.id || null,
    stageOptions: uniqueValues(stageValues),
    progressOptions: uniqueValues(progressField?.pick_list_values || []),
    progressByStage: {
      ...embeddedDependencies,
      ...dependencyMapFromValues(layoutDependencies?.pick_list_values),
    },
  };
};

export const extractMatterDependencyMap = (dependencies) => {
  const matching = asArray(dependencies).find(isMatterProgressDependency);
  return dependencyMapFromValues(matching?.pick_list_values);
};

export const getAllowedMatterProgressOptions = (
  metadata,
  stage,
  currentProgress = ""
) => {
  const progressByStage = metadata?.progressByStage || {};
  if (Object.prototype.hasOwnProperty.call(progressByStage, stage)) {
    const mappedOptions = progressByStage[stage] || [];
    return currentProgress && !mappedOptions.includes(currentProgress)
      ? [...mappedOptions, currentProgress]
      : mappedOptions;
  }

  // Without an authoritative dependency map, preserve only the stored value.
  // Exposing every progress value would bypass Current Stage dependencies.
  return currentProgress ? [currentProgress] : [];
};

export const resolveMatterProgressForStage = (
  metadata,
  stage,
  currentProgress
) => {
  const progressByStage = metadata?.progressByStage || {};
  const hasDependency = Object.prototype.hasOwnProperty.call(
    progressByStage,
    stage
  );
  if (!hasDependency) return "";

  const options = getAllowedMatterProgressOptions(metadata, stage);
  if (options.includes(currentProgress)) return currentProgress;
  return "";
};

const fetchLayouts = async () => {
  if (ZOHO?.CRM?.META?.getLayouts) {
    try {
      const response = await ZOHO.CRM.META.getLayouts({ Entity: MATTER_MODULE });
      const layouts = extractLayouts(response);
      if (layouts.length) return layouts;
    } catch (error) {
      console.warn("Applications layout metadata SDK read failed:", error);
    }
  }

  if (!ZOHO?.CRM?.CONNECTION?.invoke) return [];
  const response = await ZOHO.CRM.CONNECTION.invoke(conn_name, {
    url: `${dataCenterMap.AU}/crm/v8/settings/layouts?module=${MATTER_MODULE}`,
    method: "GET",
    param_type: 1,
  });
  return extractLayouts(response);
};

const fetchMappedDependency = async (layoutId) => {
  if (!layoutId || !ZOHO?.CRM?.CONNECTION?.invoke) return {};

  try {
    const baseUrl = `${dataCenterMap.AU}/crm/v8/settings/layouts/${layoutId}/map_dependency`;
    const summaryResponse = await ZOHO.CRM.CONNECTION.invoke(conn_name, {
      url: `${baseUrl}?module=${MATTER_MODULE}`,
      method: "GET",
      param_type: 1,
    });
    const summaries = extractMapDependencies(summaryResponse);
    const summary = summaries.find(isMatterProgressDependency);

    const inlineMap = extractMatterDependencyMap(summaries);
    const hasInlineValues = Object.values(inlineMap).some(
      (values) => Array.isArray(values) && values.length > 0
    );
    if (hasInlineValues) return inlineMap;
    if (!summary?.id) return {};

    const detailResponse = await ZOHO.CRM.CONNECTION.invoke(conn_name, {
      url: `${baseUrl}/${summary.id}?module=${MATTER_MODULE}`,
      method: "GET",
      param_type: 1,
    });
    return extractMatterDependencyMap(extractMapDependencies(detailResponse));
  } catch (error) {
    console.warn("Applications map dependency read failed:", error);
    return {};
  }
};

export const fetchMatterPicklistMetadata = async (layoutId = null) => {
  try {
    const layouts = await fetchLayouts();
    const layout =
      layouts.find((candidate) => String(candidate?.id) === String(layoutId)) ||
      layouts[0];
    if (!layout) {
      return {
        layoutId: layoutId || null,
        stageOptions: [],
        progressOptions: [],
        progressByStage: {},
      };
    }

    const metadata = extractMatterMetadataFromLayout(layout);
    const hasEmbeddedDependencyValues = Object.values(
      metadata.progressByStage
    ).some((values) => Array.isArray(values) && values.length > 0);
    if (!hasEmbeddedDependencyValues) {
      metadata.progressByStage = await fetchMappedDependency(metadata.layoutId);
    }
    return metadata;
  } catch (error) {
    console.warn("Applications picklist metadata could not be loaded:", error);
    return {
      layoutId: layoutId || null,
      stageOptions: [],
      progressOptions: [],
      progressByStage: {},
    };
  }
};

export const loadMatterContextForStakeholder = async (stakeholderId) => {
  let matter = null;
  try {
    matter = await fetchLatestMatterForStakeholder(stakeholderId);
  } catch (error) {
    console.warn("Stakeholder matters could not be loaded:", error);
  }
  const snapshot = buildMatterFormSnapshot(matter);
  const metadata = await fetchMatterPicklistMetadata(snapshot.matter?.layoutId);
  return { matter, snapshot, metadata };
};
