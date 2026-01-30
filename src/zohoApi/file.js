import axios from "axios";
import {
  conn_name,
  dataCenterMap,
  access_token_api_url,
  access_token_url,
} from "../config/config";

const ZOHO = window.ZOHO;

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

async function getAttachments({ module, recordId }) {
  try {
    const url = `${dataCenterMap.AU}/crm/v6/${module}/${recordId}/Attachments?fields=id,File_Name,$file_id`;

    var req_data = {
      url,
      param_type: 1,
      headers: {},
      method: "GET",
    };

    const getAttachmentsResp = await ZOHO.CRM.CONNECTION.invoke(
      conn_name,
      req_data
    );

    const sm = getAttachmentsResp?.details?.statusMessage;
    const details = getAttachmentsResp?.details;

    let list = [];
    if (sm !== "" && sm !== null && sm !== undefined) {
      const parsed = typeof sm === "string"
        ? (() => { try { return JSON.parse(sm); } catch { return {}; } })()
        : sm;
      list = Array.isArray(parsed?.data) ? parsed.data : (Array.isArray(parsed) ? parsed : []);
    }
    if (list.length === 0 && details && typeof details === "object" && Array.isArray(details?.data)) {
      list = details.data;
    }

    return { data: list, error: null };
  } catch (getAttachmentsError) {
    console.log({ getAttachmentsError });
    return {
      data: null,
      error: "Something went wrong",
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
