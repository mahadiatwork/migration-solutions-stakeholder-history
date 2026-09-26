const SOURCE_MODULE = "History1";
const TARGET_MODULE = "Applications_History";
const SOURCE_CONTACTS = "Contacts3";
const TARGET_CONTACTS = "Contacts4";
const COPY_ATTACHMENTS = "copy_attachment_form_contact_history_to_applicatio";

const normalizeProgress = (value) => {
  const first = Array.isArray(value) ? value[0] : value;
  if (first == null) return "";
  if (typeof first === "object") {
    return String(first.actual_value ?? first.display_value ?? first.value ?? first.name ?? "").trim();
  }
  return String(first).trim();
};

async function progressFieldType(zoho, matter) {
  const fallback = Array.isArray(matter.Matter_Progress) ? "multiselectpicklist" : "picklist";
  if (typeof zoho.CRM.META?.getFields !== "function") return fallback;
  try {
    const response = await zoho.CRM.META.getFields({ Entity: TARGET_MODULE });
    const fields = response?.fields || response?.data?.fields || response?.data;
    const field = Array.isArray(fields)
      ? fields.find((item) => item.api_name === "Matter_Progress")
      : null;
    return field?.data_type || fallback;
  } catch {
    return fallback;
  }
}

async function matterSnapshot(zoho, matter) {
  const progress = normalizeProgress(matter.Matter_Progress);
  const fieldType = await progressFieldType(zoho, matter);
  return {
    Matter_No: matter.Name ?? null,
    Current_Stage: normalizeProgress(matter.Current_Stage) || null,
    Matter_Progress: progress
      ? fieldType === "multiselectpicklist" ? [progress] : progress
      : null,
  };
}

export class HistoryMoveError extends Error {
  constructor(message, sourceId, targetId, cause) {
    super(message);
    this.name = "HistoryMoveError";
    this.sourceId = sourceId;
    this.targetId = targetId;
    this.cause = cause;
  }
}

const idOf = (value) => value?.id ?? (typeof value === "string" ? value : null);

function actionId(response, operation) {
  const action = response?.data?.[0];
  if (String(action?.code).toUpperCase() !== "SUCCESS" || !action?.details?.id) {
    throw new Error(`${operation}: ${action?.message || "Zoho did not confirm success"}`);
  }
  return String(action.details.id);
}

function assertDeleted(response, operation) {
  const action = response?.data?.[0];
  if (String(action?.code).toUpperCase() !== "SUCCESS") {
    throw new Error(`${operation}: ${action?.message || "Zoho did not confirm deletion"}`);
  }
}

async function getRecord(zoho, module, recordId) {
  const response = await zoho.CRM.API.getRecord({
    Entity: module,
    RecordID: recordId,
    approved: "both",
  });
  const record = response?.data?.[0];
  if (!record || String(record.id) !== String(recordId)) {
    throw new Error(`Could not verify ${module} record ${recordId}`);
  }
  return record;
}

async function getRelated(zoho, module, recordId, relatedList) {
  const records = [];
  for (let page = 1; page <= 50; page += 1) {
    const response = await zoho.CRM.API.getRelatedRecords({
      Entity: module,
      RecordID: recordId,
      RelatedList: relatedList,
      page,
      per_page: 200,
    });
    if (response?.statusText === "nocontent") return records;
    if (!Array.isArray(response?.data)) {
      throw new Error(`Could not read ${relatedList} for ${module} ${recordId}`);
    }
    records.push(...response.data);
    if (response.data.length < 200 || response?.info?.more_records === false) return records;
  }
  throw new Error(`Too many ${relatedList} records to verify for ${module} ${recordId}`);
}

async function getAttachments(fileApi, module, recordId) {
  const response = await fileApi.getAttachments({ module, recordId });
  if (response?.error || !Array.isArray(response?.data)) {
    throw new Error(`Could not read attachments for ${module} ${recordId}: ${response?.error || "invalid response"}`);
  }
  return response.data;
}

function normalizedNames(attachments) {
  return attachments.map((attachment) => String(attachment?.File_Name || "")).sort();
}

function attachmentsMatch(source, target) {
  const sourceNames = normalizedNames(source);
  const targetNames = normalizedNames(target);
  return sourceNames.length === targetNames.length &&
    sourceNames.every((name, index) => name && name === targetNames[index]);
}

function assertCopied(response) {
  if (String(response?.code).toLowerCase() !== "success") {
    throw new Error(`Attachment copy failed: ${response?.message || "Zoho did not confirm the function"}`);
  }
  const rawOutput = response?.details?.output;
  if (!rawOutput) return;
  let output = rawOutput;
  if (typeof rawOutput === "string") {
    try { output = JSON.parse(rawOutput); } catch { /* A plain text result is valid. */ }
  }
  if (typeof output === "object" && output !== null) {
    const result = String(output.code ?? output.status ?? output.result ?? "").toLowerCase();
    if (["error", "failure", "failed"].includes(result) || output.error) {
      throw new Error(`Attachment copy failed: ${output.message || output.error || result}`);
    }
  } else if (/^\s*(error|failed|failure)\b/i.test(String(output))) {
    throw new Error(`Attachment copy failed: ${output}`);
  }
}

function sameValue(source, target, field) {
  if (source == null || source === "") return target == null || target === "";
  if (field === "Matter_Progress" || field === "Current_Stage") {
    return normalizeProgress(source) === normalizeProgress(target);
  }
  if (field === "Date") {
    const sourceTime = Date.parse(source);
    const targetTime = Date.parse(target);
    if (!Number.isNaN(sourceTime) && !Number.isNaN(targetTime)) return sourceTime === targetTime;
  }
  if (Array.isArray(source) || Array.isArray(target)) {
    const list = (value) => (Array.isArray(value) ? value : [value]).map(String).sort().join("|");
    return list(source) === list(target);
  }
  return String(source) === String(target);
}

function verifyTarget(source, target, applicationId, stakeholderId, snapshot) {
  if (String(idOf(target.Application)) !== String(applicationId)) {
    throw new Error("The new history is not linked to the selected Matter");
  }
  if (stakeholderId && String(idOf(target.Stakeholder)) !== String(stakeholderId)) {
    throw new Error("The new history lost its Stakeholder link");
  }
  const fields = [
    ["Name", "Name"],
    ["History_Details_Plain", "History_Details"],
    ["History_Result", "History_Result"],
    ["History_Type", "History_Type"],
    ["Regarding", "Regarding"],
    ["Duration", "Duration_Min"],
    ["Date", "Date"],
    ["Billing_Type", "Billing_Type"],
  ];
  for (const [sourceField, targetField] of fields) {
    const expected = sourceField === "Billing_Type"
      ? source.Billing_Type ?? "Billable"
      : source[sourceField];
    if (!sameValue(expected, target[targetField], sourceField)) {
      throw new Error(`The new history did not retain ${sourceField}`);
    }
  }
  for (const field of ["Matter_No", "Current_Stage", "Matter_Progress"]) {
    if (!sameValue(snapshot[field], target[field], field)) {
      throw new Error(`The new history did not retain destination ${field}`);
    }
  }
  if (idOf(source.Owner) && String(idOf(target.Owner)) !== String(idOf(source.Owner))) {
    throw new Error("The new history did not retain its owner");
  }
}

function contactId(row, side) {
  return idOf(side === "source" ? row.Contact_Details : row.Contact);
}

function assertContactSet(sourceRows, targetRows) {
  const sourceIds = [...new Set(sourceRows.map((row) => String(contactId(row, "source"))))].sort();
  const targetIds = [...new Set(targetRows.map((row) => String(contactId(row, "target"))))].sort();
  if (sourceIds.length !== targetIds.length || sourceIds.some((id, index) => id !== targetIds[index])) {
    throw new Error("The new history does not have the same Contact links");
  }
}

async function verifyContactSetWithRetry(zoho, sourceRows, targetId, delay) {
  let lastError;
  for (const waitMs of [0, 250, 750, 1500]) {
    if (waitMs) await delay(waitMs);
    try {
      const targetRows = await getRelated(zoho, TARGET_MODULE, targetId, TARGET_CONTACTS);
      assertContactSet(sourceRows, targetRows);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Move one Stakeholder History record. A resumeTargetId reuses a partial target on retry. */
export async function moveStakeholderHistoryToApplication({
  zoho,
  fileApi,
  changeOwner,
  sourceId,
  applicationId,
  stakeholderId,
  resumeTargetId = null,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (!sourceId || !applicationId) throw new Error("A History record and Matter are required");
  let targetId = resumeTargetId;
  let createdThisCall = false;
  let sourceDeletionStarted = false;
  try {
    const source = await getRecord(zoho, SOURCE_MODULE, sourceId);
    const matter = await getRecord(zoho, "Applications", applicationId);
    const snapshot = await matterSnapshot(zoho, matter);
    const sourceContacts = await getRelated(zoho, SOURCE_MODULE, sourceId, SOURCE_CONTACTS);
    if (sourceContacts.some((row) => !row.id || !contactId(row, "source"))) {
      throw new Error("Some source Contact links could not be read");
    }
    const sourceAttachments = await getAttachments(fileApi, SOURCE_MODULE, sourceId);
    const preservedStakeholderId = idOf(source.Stakeholder) || stakeholderId;
    const payload = {
      Name: source.Name,
      Application: { id: applicationId },
      History_Details: source.History_Details_Plain,
      History_Result: source.History_Result,
      History_Type: source.History_Type,
      Regarding: source.Regarding,
      Duration_Min: source.Duration,
      Date: source.Date,
      Billing_Type: source.Billing_Type ?? "Billable",
      ...snapshot,
      ...(preservedStakeholderId ? { Stakeholder: { id: preservedStakeholderId } } : {}),
    };

    if (!targetId) {
      const created = await zoho.CRM.API.insertRecord({
        Entity: TARGET_MODULE,
        APIData: payload,
        Trigger: ["workflow"],
      });
      targetId = actionId(created, "Create Application History");
      createdThisCall = true;
    } else {
      // Reusing a partial target must never silently redirect it to another Matter.
      const existing = await getRecord(zoho, TARGET_MODULE, targetId);
      if (String(idOf(existing.Application)) !== String(applicationId)) {
        throw new Error("The partial target belongs to a different Matter");
      }
    }

    let target = await getRecord(zoho, TARGET_MODULE, targetId);
    if (idOf(source.Owner) && String(idOf(target.Owner)) !== String(idOf(source.Owner))) {
      const changed = await changeOwner(TARGET_MODULE, targetId, idOf(source.Owner));
      if (changed?.error || !changed?.data) {
        throw new Error(`Could not preserve the owner: ${changed?.error || "Zoho did not confirm the change"}`);
      }
      target = await getRecord(zoho, TARGET_MODULE, targetId);
    }
    verifyTarget(source, target, applicationId, preservedStakeholderId, snapshot);

    let targetContacts = await getRelated(zoho, TARGET_MODULE, targetId, TARGET_CONTACTS);
    if (resumeTargetId && sourceContacts.length && !targetContacts.length) {
      for (const waitMs of [250, 750, 1500]) {
        await delay(waitMs);
        targetContacts = await getRelated(zoho, TARGET_MODULE, targetId, TARGET_CONTACTS);
        if (targetContacts.length) break;
      }
    }
    const sourceIds = new Set(sourceContacts.map((row) => String(contactId(row, "source"))));
    if (targetContacts.some((row) => !contactId(row, "target") || !sourceIds.has(String(contactId(row, "target"))))) {
      throw new Error("The partial target contains an unexpected Contact link");
    }
    const existingIds = new Set(targetContacts.map((row) => String(contactId(row, "target"))));
    for (const contact of sourceContacts) {
      const id = String(contactId(contact, "source"));
      if (existingIds.has(id)) continue;
      const response = await zoho.CRM.API.insertRecord({
        Entity: "Application_Hstory",
        APIData: {
          Application_Hstory: { id: targetId },
          Contact: { id },
        },
        Trigger: ["workflow"],
      });
      actionId(response, `Link Contact ${id}`);
      existingIds.add(id);
    }
    await verifyContactSetWithRetry(zoho, sourceContacts, targetId, delay);

    let targetAttachments = await getAttachments(fileApi, TARGET_MODULE, targetId);
    if (resumeTargetId && sourceAttachments.length && !targetAttachments.length) {
      // A previous copy can be visible after the function response. Recheck
      // before calling it again so a retry does not duplicate attachments.
      for (const waitMs of [250, 750, 1500]) {
        await delay(waitMs);
        targetAttachments = await getAttachments(fileApi, TARGET_MODULE, targetId);
        if (targetAttachments.length) break;
      }
    }
    if (sourceAttachments.length && !attachmentsMatch(sourceAttachments, targetAttachments)) {
      if (targetAttachments.length) {
        throw new Error("The partial target has an incomplete attachment copy; review it in Zoho");
      }
      const response = await zoho.CRM.FUNCTIONS.execute(COPY_ATTACHMENTS, {
        arguments: JSON.stringify({
          fromModule: SOURCE_MODULE,
          toModule: TARGET_MODULE,
          fromID: sourceId,
          ToID: targetId,
        }),
      });
      assertCopied(response);
      for (const waitMs of [0, 250, 750, 1500]) {
        if (waitMs) await delay(waitMs);
        targetAttachments = await getAttachments(fileApi, TARGET_MODULE, targetId);
        if (attachmentsMatch(sourceAttachments, targetAttachments)) break;
      }
    }
    if (!attachmentsMatch(sourceAttachments, targetAttachments)) {
      throw new Error("The new history does not have the same attachments");
    }

    // Verify once more immediately before any destructive operation.
    verifyTarget(source, await getRecord(zoho, TARGET_MODULE, targetId), applicationId, preservedStakeholderId, snapshot);
    await verifyContactSetWithRetry(zoho, sourceContacts, targetId, delay);

    const deletedContacts = [];
    sourceDeletionStarted = true;
    try {
      for (const contact of sourceContacts) {
        const response = await zoho.CRM.API.deleteRecord({
          Entity: "History_X_Contacts",
          RecordID: contact.id,
        });
        assertDeleted(response, `Delete source Contact link ${contact.id}`);
        deletedContacts.push(contact);
      }
      const response = await zoho.CRM.API.deleteRecord({
        Entity: SOURCE_MODULE,
        RecordID: sourceId,
      });
      assertDeleted(response, `Delete source History ${sourceId}`);
    } catch (deleteError) {
      // If the History record survives, put back any links removed before deletion failed.
      if (deletedContacts.length) {
        try {
          await getRecord(zoho, SOURCE_MODULE, sourceId);
          for (const contact of deletedContacts) {
            const response = await zoho.CRM.API.insertRecord({
              Entity: "History_X_Contacts",
              APIData: {
                Contact_History_Info: { id: sourceId },
                Contact_Details: { id: contactId(contact, "source") },
                ...(idOf(contact.Stakeholder) || preservedStakeholderId
                  ? { Stakeholder: { id: idOf(contact.Stakeholder) || preservedStakeholderId } }
                  : {}),
              },
              Trigger: ["workflow"],
            });
            actionId(response, `Restore source Contact link ${contact.id}`);
          }
        } catch (restoreError) {
          throw new Error(`${deleteError.message}; source links also need repair: ${restoreError.message}`);
        }
      }
      throw deleteError;
    }
    return { sourceId, targetId };
  } catch (error) {
    let failure = error;
    if (targetId && createdThisCall && !sourceDeletionStarted) {
      try {
        const targetContacts = await getRelated(zoho, TARGET_MODULE, targetId, TARGET_CONTACTS);
        for (const contact of targetContacts) {
          const response = await zoho.CRM.API.deleteRecord({
            Entity: "Application_Hstory",
            RecordID: contact.id,
          });
          assertDeleted(response, `Remove partial target Contact link ${contact.id}`);
        }
        const response = await zoho.CRM.API.deleteRecord({
          Entity: TARGET_MODULE,
          RecordID: targetId,
        });
        assertDeleted(response, `Remove partial target History ${targetId}`);
        targetId = null;
      } catch (rollbackError) {
        failure = new Error(`${error.message}; partial target cleanup also failed: ${rollbackError.message}`);
      }
    }
    throw new HistoryMoveError(
      failure.message || "History move failed",
      sourceId,
      targetId,
      failure
    );
  }
}
