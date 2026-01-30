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
  const whereClause =
    module === "Contacts"
      ? `Contact_Details = '${recordId}'`
      : module === "Accounts"
        ? `Stakeholder = '${recordId}'`
        : `Contact_Details = '${recordId}'`;

  const fromModule = "History_X_Contacts";

  // Use expanded field paths matching working Deluge query (Owner.first_name, Contact_History_Info.X, Contact_Details.X, etc.)
  const selectQuery = `SELECT Name, id, Contact_History_Info.id, Contact_History_Info.Name, Owner.first_name, Owner.last_name, Contact_Details.id, Contact_Details.Full_Name, Contact_History_Info.History_Type, Contact_History_Info.History_Result, Contact_History_Info.Duration, Contact_History_Info.Regarding, Contact_History_Info.History_Details_Plain, Contact_History_Info.Date FROM ${fromModule} WHERE ${whereClause} LIMIT ${offset}, ${limit}`;

  const req_data = {
    url: `${dataCenterMap.AU}/crm/v8/coql`,
    method: "POST",
    param_type: 2,
    parameters: { select_query: selectQuery },
  };

  const response = await ZOHO.CRM.CONNECTION.invoke(conn_name, req_data);

  let data = [];
  if (response?.data) {
    data = Array.isArray(response.data) ? response.data : [];
  } else if (response?.details?.statusMessage) {
    const sm = response.details.statusMessage;
    const parsed =
      typeof sm === "string" ? JSON.parse(sm || "{}") : sm;
    data = Array.isArray(parsed?.data) ? parsed.data : [];
  }

  return data;
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

export const record = {
  getRecordsFromRelatedList,
  fetchStakeholderHistoryViaCoqlV8,
};
