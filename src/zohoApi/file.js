import axios from "axios";
import {
  conn_name,
  dataCenterMap,
  access_token_api_url,
  access_token_url,
} from "../config/config";

const ZOHO = window.ZOHO;
const ATTACHMENT_PAGE_SIZE = 200;
const MAX_ATTACHMENT_PAGES = 50;

const normalizedStatusText = (value) =>
  String(value || "").replace(/[\s_-]/g, "").toLowerCase();

export const parseAttachmentPageResponse = (response, perPage = ATTACHMENT_PAGE_SIZE) => {
  const raw = response?.details?.statusMessage;
  const explicitNoContent =
    Number(response?.statusCode) === 204 ||
    Number(response?.details?.statusCode) === 204 ||
    normalizedStatusText(response?.statusText) === "nocontent" ||
    normalizedStatusText(response?.details?.statusText) === "nocontent";
  let payload = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      if (explicitNoContent && /^no\s+content$/i.test(raw.trim())) {
        payload = { code: "NO_CONTENT" };
      } else {
        throw new Error("Could not parse the attachment response.");
      }
    }
  }

  const containers = [payload, response?.details, response].filter(
    (item) => item && typeof item === "object"
  );
  const candidates = [
    ...containers,
    ...containers.flatMap((item) => Array.isArray(item?.data) ? item.data : []),
  ];
  const error = candidates.find((item) =>
    item && typeof item === "object" &&
    (String(item.status || "").toLowerCase() === "error" ||
      (item.code != null &&
        !["SUCCESS", "200", "204", "NO_CONTENT"].includes(String(item.code).toUpperCase())))
  );
  if (error) throw new Error(error.message || "Attachment request failed.");

  const httpFailure = candidates.find((item) =>
    item && typeof item === "object" && Number(item.statusCode) >= 400
  );
  if (httpFailure) {
    throw new Error(httpFailure.message || `Attachment request failed with HTTP ${httpFailure.statusCode}.`);
  }

  const flags = [];
  for (const item of [payload, response?.details, response]) {
    const info = item?.info;
    if (info == null) continue;
    if (typeof info !== "object" || Array.isArray(info)) {
      throw new Error("Attachment response has invalid pagination info.");
    }
    if (Object.prototype.hasOwnProperty.call(info, "more_records")) {
      let moreRecords = info.more_records;
      if (typeof moreRecords === "string") {
        const normalized = moreRecords.trim().toLowerCase();
        if (normalized === "true" || normalized === "false") {
          moreRecords = normalized === "true";
        }
      }
      if (typeof moreRecords !== "boolean") {
        throw new Error("Attachment response has invalid pagination info.");
      }
      flags.push(moreRecords);
    }
  }
  if (flags.some((flag) => flag !== flags[0])) {
    throw new Error("Attachment response has conflicting pagination info.");
  }

  let list;
  for (const candidate of [payload, response?.details, response]) {
    if (Array.isArray(candidate)) {
      list = candidate;
      break;
    }
    if (Array.isArray(candidate?.data)) {
      list = candidate.data;
      break;
    }
  }

  const noContent =
    explicitNoContent ||
    candidates.some((item) =>
      String(item?.code || "").toUpperCase() === "NO_CONTENT" ||
      normalizedStatusText(item?.statusText) === "nocontent"
    );
  if (!list && noContent) list = [];
  if (!list) throw new Error("Attachment response did not contain a verified list.");
  if (list.length > perPage) throw new Error("Attachment page exceeded the requested size.");
  const moreRecords = flags[0];
  if (moreRecords === true && list.length === 0) {
    throw new Error("Attachment response requested another page without records.");
  }
  if (list.length === perPage && moreRecords === undefined) {
    throw new Error("A full attachment page did not include pagination info.");
  }
  return { data: list, moreRecords: moreRecords === true };
};

export const parseAttachmentListResponse = (response) => {
  const page = parseAttachmentPageResponse(response);
  if (page.moreRecords) {
    throw new Error("Attachment response contains more records than a single page.");
  }
  return page.data;
};

async function uploadAttachment({ module, recordId, data }) {
  try {
    const uploadAttachmentResp = await ZOHO.CRM.API.attachFile({
      Entity: module,
      RecordID: recordId,
      File: { Name: data?.name, Content: data },
    });
    return {
      data: uploadAttachmentResp?.data,
      error: null,
    };
  } catch (uploadFileError) {
    return {
      data: null,
      error: "Something went wrong",
    };
  }
}

async function getAttachments({ module, recordId, strict = false }) {
  try {
    const crm = (window.ZOHO || ZOHO)?.CRM;
    if (strict && typeof crm?.API?.getRelatedRecords !== "function") {
      return {
        data: null,
        error: "The active CRM attachment API is unavailable.",
      };
    }

    const attachments = [];
    const seenIds = new Set();
    for (let page = 1; page <= MAX_ATTACHMENT_PAGES; page += 1) {
      const response = strict
        ? await crm.API.getRelatedRecords({
          Entity: module,
          RecordID: recordId,
          RelatedList: "Attachments",
          page,
          per_page: ATTACHMENT_PAGE_SIZE,
        })
        : await crm.CONNECTION.invoke(conn_name, {
          url: `${dataCenterMap.AU}/crm/v6/${module}/${recordId}/Attachments?fields=id,File_Name,$file_id&page=${page}&per_page=${ATTACHMENT_PAGE_SIZE}`,
          param_type: 1,
          headers: {},
          method: "GET",
        });
      const result = parseAttachmentPageResponse(response);
      for (const attachment of result.data) {
        if (attachment?.id && seenIds.has(String(attachment.id))) {
          throw new Error(`Attachment ${attachment.id} appeared on more than one page.`);
        }
        if (attachment?.id) seenIds.add(String(attachment.id));
        attachments.push(attachment);
      }
      if (!result.moreRecords) return { data: attachments, error: null };
    }
    throw new Error(`Attachment list exceeded ${MAX_ATTACHMENT_PAGES} pages.`);
  } catch (getAttachmentsError) {
    return {
      data: null,
      error: getAttachmentsError?.message || "Something went wrong",
    };
  }
}


async function downloadAttachmentById({
  module,
  recordId,
  attachmentId,
  fileName,
}) {
  const safeFileName = fileName || "attachment";

  function downloadFile(data, filename, mime) {
    if (!data) return;
    const blob = new Blob([data], { type: mime || "application/octet-stream" });
    if (typeof window.navigator.msSaveBlob !== "undefined") {
      window.navigator.msSaveBlob(blob, filename);
      return;
    }
    const blobURL = window.URL.createObjectURL(blob);
    const tempLink = document.createElement("a");
    tempLink.style.display = "none";
    tempLink.href = blobURL;
    tempLink.setAttribute("download", filename);
    if (typeof tempLink.download === "undefined") {
      tempLink.setAttribute("target", "_blank");
    }
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
    setTimeout(() => {
      window.URL.revokeObjectURL(blobURL);
    }, 100);
  }

  try {
    const config = {
      url: access_token_api_url,
      method: "POST",
      data: {
        recordId,
        moduleName: module,
        attachment_id: attachmentId,
        access_token_url,
        dataCenterUrl: dataCenterMap.AU,
      },
      responseType: "blob",
    };
    const resp = await axios.request(config);
    if (resp?.data) {
      downloadFile(resp.data, safeFileName);
      return { data: true, error: null };
    }
    return { data: null, error: "Empty response" };
  } catch (downloadAttachmentByIdError) {
    console.error({ downloadAttachmentByIdError });
    return {
      data: null,
      error: "Something went wrong",
    };
  }
}

async function deleteAttachment({ module, recordId, attachment_id }) {
  try {
    const url = `${dataCenterMap.AU}/crm/v6/${module}/${recordId}/Attachments/${attachment_id}`;

    var req_data = {
      url,
      param_type: 1,
      headers: {},
      method: "DELETE",
    };

    const deleteAttachmentResp = await ZOHO.CRM.CONNECTION.invoke(
      conn_name,
      req_data
    );
    const respId = await deleteAttachmentResp?.details?.statusMessage?.data?.[0]
      ?.details?.id;

    return {
      data: respId,
      error: null,
    };
  } catch (deleteFileError) {
    return {
      data: null,
      error: "Something went wrong",
    };
  }
}

export const file = {
  uploadAttachment,
  getAttachments,
  downloadAttachmentById,
  deleteAttachment,
};
