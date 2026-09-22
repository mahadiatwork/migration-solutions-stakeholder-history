export const dataCenterMap = {
  US: "https://www.zohoapis.com",
  EU: "https://www.zohoapis.eu",
  AU: "https://www.zohoapis.com.au",
  IN: "https://www.zohoapis.in",
  China: "https://www.zohoapis.com.cn",
  JP: "https://www.zohoapis.jp",
};

export const conn_name = "zoho_crm_conn";

// Zoho CRM custom module used to manage widget pick-list labels and order.
// The hard-coded values in dialogConstants.js/helperFunc.js remain the
// compatibility fallback when the module is unavailable or empty.
export const PICKLIST_CONFIG_MODULE = "Widget_Picklist_Config";

export const PICKLIST_CONFIG_FIELDS = {
  name: "Name",
  category: "Category",
  parentType: "Parent_Type",
  sortOrder: "Sort_Order",
  active: "Active",
};

export const PICKLIST_CATEGORIES = {
  TYPE: "Type",
  RESULT: "Result",
  REGARDING: "Regarding",
  DURATION: "Duration",
};

export const access_token_api_url =
  "https://api.easy-pluginz.com.au/admin/v2/data/zoho/crm/downloadattachment";

export const access_token_url =
  "https://www.zohoapis.com.au/crm/v2/functions/getaccesstoken/actions/execute?auth_type=apikey&zapikey=1003.36fcc30cd4dabc6754397103d572d959.45911087afc5315f107424ed9617687b";
