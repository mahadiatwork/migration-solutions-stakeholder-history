import { dataCenterMap, conn_name } from "../config/config";

const ZOHO = window.ZOHO;
const RELATED_LIST_PAGE_SIZE = 200;
const MAX_RELATED_LIST_RECORDS = 2000;

const parseCoqlResponse = (response) => {
  const rawStatusMessage = response?.details?.statusMessage;
  let statusMessage = rawStatusMessage;

  if (typeof rawStatusMessage === "string" && rawStatusMessage.trim()) {
    try {
      statusMessage = JSON.parse(rawStatusMessage);
    } catch {
      throw new Error("COQL returned an unreadable response.");
    }
  }

  const candidates = [statusMessage, response?.details, response].filter(
    (candidate) => candidate && typeof candidate === "object"
  );

  const errorPayload = candidates.find((candidate) => {
    const code = String(candidate?.code || "").toUpperCase();
    return (
      String(candidate?.status || "").toLowerCase() === "error" ||
      (code && code !== "SUCCESS" && code !== "NO_CONTENT")
    );
  });

  if (errorPayload) {
    throw new Error(
      `${errorPayload.code || "COQL_ERROR"}: ${
        errorPayload.message || "Could not load Stakeholder History."
      }`
    );
  }

  for (const candidate of candidates) {
    if (Array.isArray(candidate.data)) return candidate.data;
  }

  const statusCode = Number(
    response?.details?.statusCode ?? response?.statusCode ?? response?.status
  );
  if (statusCode === 204 || response?.statusText === "nocontent") return [];

  throw new Error("COQL returned an unrecognized response.");
};

const JUNCTION_HISTORY_SELECT = [
  "Name",
  "id",
  "Contact_History_Info.id",
  "Contact_History_Info.Name",
  "Owner.first_name",
  "Owner.last_name",
  "Contact_Details.id",
  "Contact_Details.Full_Name",
  "Contact_History_Info.History_Type",
  "Contact_History_Info.History_Result",
  "Contact_History_Info.Duration",
  "Contact_History_Info.Regarding",
  "Contact_History_Info.History_Details_Plain",
  "Contact_History_Info.Date",
  "Contact_History_Info.Matter.id",
  "Contact_History_Info.Matter_No",
  "Contact_History_Info.Current_Stage",
  "Contact_History_Info.Matter_Progress",
  "Contact_History_Info.Billing_Type",
].join(", ");

const DIRECT_HISTORY_SELECT = [
  "id",
  "Name",
  "Date",
  "History_Type",
  "History_Result",
  "Duration",
  "Regarding",
  "History_Details_Plain",
  "Owner",
  "Stakeholder",
  "Matter",
  "Matter_No",
  "Current_Stage",
  "Matter_Progress",
  "Billing_Type",
].join(", ");

/**
 * Fetch Stakeholder History via COQL v8 API (up to 2000 records in one call)
 * Schema: History_X_Contacts for Contact parent; verify in Zoho if COQL fails
 * @param {string} module - Parent module (Contacts, Accounts, etc.)
 * @param {string} recordId - Parent record ID
 * @param {number} [limit=2000]
 * @param {number} [offset=0]
 * @returns {Promise<Array>}
 */
export async function fetchStakeholderHistoryViaCoqlV8(
  module,
  recordId,
  limit = 2000,
  offset = 0
) {
  const baseUrl = `${dataCenterMap.AU}/crm/v8/coql`;

  // Contact context: History_X_Contacts via Contact_Details
  if (module === "Contacts") {
    const whereClause = `Contact_Details = '${recordId}'`;
    const fromModule = "History_X_Contacts";
    const selectQuery = `SELECT ${JUNCTION_HISTORY_SELECT} FROM ${fromModule} WHERE ${whereClause} LIMIT ${offset}, ${limit}`;

    const req_data = {
      url: baseUrl,
      method: "POST",
      param_type: 2,
      parameters: { select_query: selectQuery },
    };

    const response = await ZOHO.CRM.CONNECTION.invoke(conn_name, req_data);
    return parseCoqlResponse(response);
  }

  // Stakeholder / Account context:
  // We want ALL history related to this stakeholder record.
  // That includes:
  // 1) Junction rows in History_X_Contacts (for participants)
  // 2) All History1 records whose Stakeholder lookup = recordId,
  //    including ones that have *no* junction rows.
  if (module === "Accounts" || module === "Stakeholders") {
    const whereStakeholder = `Stakeholder = '${recordId}'`;

    // 1) Junction: History_X_Contacts (needed for Participants)
    const fromJunction = "History_X_Contacts";
    const selectJunction = `SELECT ${JUNCTION_HISTORY_SELECT} FROM ${fromJunction} WHERE ${whereStakeholder} LIMIT ${offset}, ${limit}`;

    const junctionReq = {
      url: baseUrl,
      method: "POST",
      param_type: 2,
      parameters: { select_query: selectJunction },
    };

    const junctionResp = await ZOHO.CRM.CONNECTION.invoke(
      conn_name,
      junctionReq
    );
    const junctionData = parseCoqlResponse(junctionResp);

    // 2) Main History: History1 (CustomModule4) by Stakeholder
    //    This ensures we also fetch records that have no History_X_Contacts row.
    const fromHistory = "History1";
    const selectHistory = `SELECT ${DIRECT_HISTORY_SELECT} FROM ${fromHistory} WHERE ${whereStakeholder} LIMIT ${offset}, ${limit}`;

    const historyReq = {
      url: baseUrl,
      method: "POST",
      param_type: 2,
      parameters: { select_query: selectHistory },
    };

    const historyResp = await ZOHO.CRM.CONNECTION.invoke(
      conn_name,
      historyReq
    );
    const historyData = parseCoqlResponse(historyResp);

    // Return combined; App.js deduplicates by history_id and
    // merges participants from junction rows.
    return [...junctionData, ...historyData];
  }

  // Fallback: treat like Contact context
  const whereClause = `Contact_Details = '${recordId}'`;
  const fromModule = "History_X_Contacts";
  const selectQuery = `SELECT ${JUNCTION_HISTORY_SELECT} FROM ${fromModule} WHERE ${whereClause} LIMIT ${offset}, ${limit}`;

  const req_data = {
    url: baseUrl,
    method: "POST",
    param_type: 2,
    parameters: { select_query: selectQuery },
  };

  const fallbackResp = await ZOHO.CRM.CONNECTION.invoke(conn_name, req_data);
  return parseCoqlResponse(fallbackResp);
}

export async function getRecordsFromRelatedList({
  module,
  recordId,
  RelatedListAPI,
  perPage = RELATED_LIST_PAGE_SIZE,
  maxRecords = MAX_RELATED_LIST_RECORDS,
}) {
  try {
    const records = [];
    const pageSize = Math.min(Math.max(Number(perPage) || 1, 1), 200);
    const recordLimit = Math.max(Number(maxRecords) || pageSize, 1);
    let page = 1;

    while (records.length < recordLimit) {
      const relatedListResp = await ZOHO.CRM.API.getRelatedRecords({
        Entity: module,
        RecordID: recordId,
        RelatedList: RelatedListAPI,
        page,
        per_page: pageSize,
      });

      if (relatedListResp?.statusText === "nocontent") break;
      if (!Array.isArray(relatedListResp?.data)) {
        throw new Error(
          relatedListResp?.message ||
            "Zoho returned an invalid related-list response."
        );
      }

      const pageRecords = relatedListResp.data;
      records.push(...pageRecords.slice(0, recordLimit - records.length));

      const moreRecords = relatedListResp?.info?.more_records;
      if (
        moreRecords === false ||
        pageRecords.length === 0 ||
        (moreRecords !== true && pageRecords.length < pageSize)
      ) {
        break;
      }
      page += 1;
    }

    return { data: records, error: null };
  } catch (getRecordsFromRelatedListError) {
    console.log({ getRecordsFromRelatedListError });
    return {
      data: null,
      error:
        getRecordsFromRelatedListError?.message ||
        "Could not load records from the related list.",
    };
  }
}

const searchActiveRecords = async ({
  entity,
  criteria,
  maxRecords = MAX_RELATED_LIST_RECORDS,
}) => {
  try {
    if (typeof ZOHO.CRM.API.searchRecord !== "function") {
      throw new Error("The active CRM search API is unavailable.");
    }

    const records = [];
    const recordLimit = Math.max(Number(maxRecords) || 1, 1);
    let page = 1;

    while (records.length < recordLimit) {
      const response = await ZOHO.CRM.API.searchRecord({
        Entity: entity,
        Type: "criteria",
        Query: criteria,
        delay: false,
        page,
        per_page: RELATED_LIST_PAGE_SIZE,
      });

      if (String(response?.statusText || "").toLowerCase() === "nocontent") {
        break;
      }
      if (!Array.isArray(response?.data)) {
        throw new Error(
          response?.message || `Zoho returned an invalid ${entity} search response.`
        );
      }

      records.push(
        ...response.data.slice(0, recordLimit - records.length)
      );
      if (
        response?.info?.more_records === false ||
        response.data.length === 0 ||
        (response?.info?.more_records !== true &&
          response.data.length < RELATED_LIST_PAGE_SIZE)
      ) {
        break;
      }
      page += 1;
    }

    return { data: records, error: null };
  } catch (error) {
    return {
      data: null,
      error: error?.message || `Could not search ${entity}.`,
    };
  }
};

/**
 * Load Stakeholder History from the CRM environment containing the open record.
 * Named OAuth connections can point at production while this widget is open in
 * a sandbox, so every query here uses the active embedded CRM SDK session.
 */
export async function fetchStakeholderHistory(
  module,
  recordId,
  limit = MAX_RELATED_LIST_RECORDS
) {
  const relatedListResponse = await getRecordsFromRelatedList({
    module,
    recordId,
    RelatedListAPI: "Stakeholder_History",
    maxRecords: limit,
  });

  if (module === "Accounts" || module === "Stakeholders") {
    const criteria = `(Stakeholder:equals:${recordId})`;
    const [directHistory, junctionHistory] = await Promise.all([
      searchActiveRecords({ entity: "History1", criteria, maxRecords: limit }),
      searchActiveRecords({
        entity: "History_X_Contacts",
        criteria,
        maxRecords: limit,
      }),
    ]);

    // Direct History records come first so App.js keeps their complete field
    // values while merging participants from any following junction rows.
    if (directHistory.error) {
      throw new Error(
        `Could not load Stakeholder History from the active CRM: ${directHistory.error}`
      );
    }
    if (junctionHistory.error && relatedListResponse.error) {
      throw new Error(
        `Could not load Stakeholder History participants from the active CRM: ${junctionHistory.error}; ${relatedListResponse.error}`
      );
    }
    return [
      ...(directHistory.data || []),
      ...(junctionHistory.data || []),
      ...(relatedListResponse.data || []),
    ];
  }

  if (relatedListResponse.error) {
    throw new Error(relatedListResponse.error);
  }
  return relatedListResponse.data || [];
}

/**
 * Change record owner (e.g. after create when module does not accept Owner on insert).
 * POST /crm/v2/{module}/{recordId}/actions/change_owner
 * @param {string} module - e.g. "History1"
 * @param {string} recordId - record id
 * @param {string} ownerId - new owner user id
 * @returns {Promise<{ data?: object, error?: string }>}
 */
export async function changeOwner(module, recordId, ownerId) {
  if (!module || !recordId || !ownerId) {
    return { data: null, error: "Missing module, recordId, or ownerId" };
  }
  try {
    const url = `${dataCenterMap.AU}/crm/v2/${module}/${recordId}/actions/change_owner`;
    const req_data = {
      url,
      method: "POST",
      param_type: 2,
      parameters: { owner: { id: String(ownerId) } },
    };
    const resp = await ZOHO.CRM.CONNECTION.invoke(conn_name, req_data);
    const code = resp?.data?.[0]?.code ?? resp?.details?.[0]?.code;
    if (code === "SUCCESS") {
      return { data: resp?.data ?? resp?.details, error: null };
    }
    const msg = resp?.data?.[0]?.message ?? resp?.details?.[0]?.message ?? "Change owner failed";
    return { data: null, error: msg };
  } catch (err) {
    console.error("changeOwner error:", err);
    return { data: null, error: err?.message ?? "Something went wrong" };
  }
}

export const record = {
  getRecordsFromRelatedList,
  fetchStakeholderHistoryViaCoqlV8,
  fetchStakeholderHistory,
  changeOwner,
};
