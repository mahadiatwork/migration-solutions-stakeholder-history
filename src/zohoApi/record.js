import { dataCenterMap, conn_name } from "../config/config";

const ZOHO = window.ZOHO;

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
  // Helper to normalize COQL responses that may return data either
  // in response.data or in details.statusMessage (as JSON string/object).
  const parseCoqlResponse = (response) => {
    if (!response) return [];
    if (Array.isArray(response.data)) return response.data;
    if (response?.details?.statusMessage) {
      const sm = response.details.statusMessage;
      const parsed =
        typeof sm === "string"
          ? (() => {
              try {
                return JSON.parse(sm || "{}");
              } catch {
                return {};
              }
            })()
          : sm;
      if (Array.isArray(parsed?.data)) return parsed.data;
      if (Array.isArray(parsed)) return parsed;
    }
    if (Array.isArray(response?.details?.data)) return response.details.data;
    return [];
  };

  const baseUrl = `${dataCenterMap.AU}/crm/v8/coql`;

  // Contact context: History_X_Contacts via Contact_Details
  if (module === "Contacts") {
    const whereClause = `Contact_Details = '${recordId}'`;
    const fromModule = "History_X_Contacts";
    const selectQuery = `SELECT Name, id, Contact_History_Info.id, Contact_History_Info.Name, Owner.first_name, Owner.last_name, Contact_Details.id, Contact_Details.Full_Name, Contact_History_Info.History_Type, Contact_History_Info.History_Result, Contact_History_Info.Duration, Contact_History_Info.Regarding, Contact_History_Info.History_Details_Plain, Contact_History_Info.Date FROM ${fromModule} WHERE ${whereClause} LIMIT ${offset}, ${limit}`;

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
    const selectJunction = `SELECT Name, id, Contact_History_Info.id, Contact_History_Info.Name, Owner.first_name, Owner.last_name, Contact_Details.id, Contact_Details.Full_Name, Contact_History_Info.History_Type, Contact_History_Info.History_Result, Contact_History_Info.Duration, Contact_History_Info.Regarding, Contact_History_Info.History_Details_Plain, Contact_History_Info.Date FROM ${fromJunction} WHERE ${whereStakeholder} LIMIT ${offset}, ${limit}`;

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
    const selectHistory = `SELECT id, Name, Date, History_Type, History_Result, Duration, Regarding, History_Details_Plain, Owner, Stakeholder FROM ${fromHistory} WHERE ${whereStakeholder} LIMIT ${offset}, ${limit}`;

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
  const selectQuery = `SELECT Name, id, Contact_History_Info.id, Contact_History_Info.Name, Owner.first_name, Owner.last_name, Contact_Details.id, Contact_Details.Full_Name, Contact_History_Info.History_Type, Contact_History_Info.History_Result, Contact_History_Info.Duration, Contact_History_Info.Regarding, Contact_History_Info.History_Details_Plain, Contact_History_Info.Date FROM ${fromModule} WHERE ${whereClause} LIMIT ${offset}, ${limit}`;

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
}) {
  try {
    const relatedListResp = await ZOHO.CRM.API.getRelatedRecords({
      Entity: module,
      RecordID: recordId,
      RelatedList: RelatedListAPI,
    });

    if (relatedListResp.statusText === "nocontent") {
      return { data: [], error: null };
    }

    if (!(relatedListResp.statusText === "nocontent")) {
      return { data: relatedListResp?.data, erroe: null };
    }
  } catch (getRecordsFromRelatedListError) {
    console.log({ getRecordsFromRelatedListError });
    return { data: null, error: "Something went wrong" };
  }
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
  changeOwner,
};
