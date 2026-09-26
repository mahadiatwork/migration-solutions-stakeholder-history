import { moveStakeholderHistoryToApplication } from "./stakeholderHistoryMove";

const source = {
  id: "history-1",
  Name: "Stakeholder discussion",
  History_Details_Plain: "Case update",
  History_Result: "Completed",
  History_Type: "Meeting",
  Regarding: "Next steps",
  Duration: "30",
  Date: "2026-09-27T09:00:00+08:00",
  Billing_Type: "Non-Billable",
  Stakeholder: { id: "stakeholder-1" },
  Owner: { id: "owner-1" },
};

function success(id) {
  return { data: [{ code: "SUCCESS", details: { id } }] };
}

function makeApi({
  contacts = ["contact-1", "contact-2"],
  attachments = ["meeting.pdf", "notes.txt"],
  fail = null,
  attachmentListingLag = 0,
  contactListingLag = 0,
  sourceBillingType = "Non-Billable",
} = {}) {
  const state = { fail };
  let remainingAttachmentLag = attachmentListingLag;
  let remainingContactLag = contactListingLag;
  const records = {
    "history-1": { ...source, Billing_Type: sourceBillingType },
    "matter-1": {
      id: "matter-1",
      Name: "MAT-1",
      Current_Stage: "Open",
      Matter_Progress: "Collecting",
    },
  };
  const sourceLinks = contacts.map((id, index) => ({
    id: `source-link-${index}`,
    Contact_Details: { id },
    Stakeholder: { id: "stakeholder-1" },
  }));
  const targetLinks = [];
  const files = {
    "History1:history-1": attachments.map((name, index) => ({ id: `source-file-${index}`, File_Name: name })),
    "Applications_History:target-1": [],
  };
  const api = {
    getRecord: jest.fn(async ({ Entity, RecordID }) => {
      const record = records[RecordID];
      return record ? { data: [{ ...record }] } : { data: [] };
    }),
    getRelatedRecords: jest.fn(async ({ Entity, RelatedList }) => {
      if (Entity === "History1" && RelatedList === "Contacts3") {
        return { data: [...sourceLinks] };
      }
      if (Entity === "Applications_History" && RelatedList === "Contacts4") {
        if (targetLinks.length && remainingContactLag > 0) {
          remainingContactLag -= 1;
          return { data: [] };
        }
        return { data: state.fail === "missingTargetContact" ? [] : [...targetLinks] };
      }
      throw new Error(`Unexpected related list ${Entity}/${RelatedList}`);
    }),
    insertRecord: jest.fn(async ({ Entity, APIData }) => {
      if (Entity === "Applications_History") {
        records["target-1"] = {
          id: "target-1",
          ...APIData,
          Owner: { id: "default-owner" },
          ...(state.fail === "matterSnapshot" ? { Matter_No: "Wrong Matter" } : {}),
        };
        return success("target-1");
      }
      if (Entity === "Application_Hstory") {
        if (["targetJunction", "targetJunctionAndRollback"].includes(state.fail)) {
          return { data: [{ code: "INVALID_DATA", message: "invalid Contact" }] };
        }
        targetLinks.push({ id: `target-link-${targetLinks.length}`, Contact: APIData.Contact });
        return success(targetLinks[targetLinks.length - 1].id);
      }
      if (Entity === "History_X_Contacts") {
        sourceLinks.push({
          id: `restored-link-${sourceLinks.length}`,
          Contact_Details: APIData.Contact_Details,
          Stakeholder: APIData.Stakeholder,
        });
        return success(sourceLinks[sourceLinks.length - 1].id);
      }
      throw new Error(`Unexpected insert ${Entity}`);
    }),
    deleteRecord: jest.fn(async ({ Entity, RecordID }) => {
      if (Entity === "History_X_Contacts") {
        if (state.fail === "sourceJunction" ||
            (state.fail === "sourceJunctionSecond" && RecordID === "source-link-1")) {
          return { data: [{ code: "ERROR", message: "junction delete failed" }] };
        }
        const index = sourceLinks.findIndex((row) => row.id === RecordID);
        if (index >= 0) sourceLinks.splice(index, 1);
        return success(RecordID);
      }
      if (Entity === "History1") {
        if (state.fail === "sourceDelete") return { data: [{ code: "ERROR", message: "history delete failed" }] };
        delete records[RecordID];
        return success(RecordID);
      }
      if (Entity === "Application_Hstory") {
        const index = targetLinks.findIndex((row) => row.id === RecordID);
        if (index >= 0) targetLinks.splice(index, 1);
        return success(RecordID);
      }
      if (Entity === "Applications_History") {
        if (state.fail === "targetJunctionAndRollback") {
          return { data: [{ code: "ERROR", message: "target cleanup failed" }] };
        }
        delete records[RecordID];
        targetLinks.splice(0, targetLinks.length);
        return success(RecordID);
      }
      throw new Error(`Unexpected delete ${Entity}`);
    }),
  };
  const zoho = {
    CRM: {
      API: api,
      META: {
        getFields: jest.fn(async () => ({
          fields: [{ api_name: "Matter_Progress", data_type: "multiselectpicklist" }],
        })),
      },
      FUNCTIONS: {
        execute: jest.fn(async (_name, request) => {
          if (state.fail === "attachmentFunction") return { code: "error", message: "copy failed" };
          const args = JSON.parse(request.arguments);
          files[`${args.toModule}:${args.ToID}`] = files[`${args.fromModule}:${args.fromID}`].map((file) => ({ ...file }));
          return { code: "success", details: { output: "" } };
        }),
      },
    },
  };
  const fileApi = {
    getAttachments: jest.fn(async ({ module, recordId }) => {
      const data = files[`${module}:${recordId}`] || [];
      if (module === "Applications_History" && data.length && remainingAttachmentLag > 0) {
        remainingAttachmentLag -= 1;
        return { data: [], error: null };
      }
      return { data, error: null };
    }),
  };
  const changeOwner = jest.fn(async (_module, id, ownerId) => {
    records[id].Owner = { id: ownerId };
    return { data: [{ code: "SUCCESS" }], error: null };
  });
  const move = (options = {}) => moveStakeholderHistoryToApplication({
    zoho,
    fileApi,
    changeOwner,
    sourceId: "history-1",
    applicationId: "matter-1",
    stakeholderId: "stakeholder-1",
    delay: jest.fn(async () => {}),
    ...options,
  });
  return {
    move, api, zoho, fileApi, changeOwner, records, sourceLinks, targetLinks, files,
    setFailure: (nextFailure) => { state.fail = nextFailure; },
  };
}

test("moves a Stakeholder history with its live fields, owner, Contacts, and attachments", async () => {
  const fixture = makeApi();
  await expect(fixture.move()).resolves.toEqual({ sourceId: "history-1", targetId: "target-1" });
  expect(fixture.records["history-1"]).toBeUndefined();
  expect(fixture.records["target-1"]).toMatchObject({
    History_Details: "Case update",
    Application: { id: "matter-1" },
    Stakeholder: { id: "stakeholder-1" },
    Owner: { id: "owner-1" },
    Billing_Type: "Non-Billable",
    Matter_No: "MAT-1",
    Current_Stage: "Open",
    Matter_Progress: ["Collecting"],
  });
  expect(fixture.targetLinks.map((link) => link.Contact.id)).toEqual(["contact-1", "contact-2"]);
  expect(fixture.files["Applications_History:target-1"].map((file) => file.File_Name)).toEqual(["meeting.pdf", "notes.txt"]);
  expect(fixture.changeOwner).toHaveBeenCalledWith("Applications_History", "target-1", "owner-1");
  expect(fixture.zoho.CRM.FUNCTIONS.execute).toHaveBeenCalledTimes(1);
  expect(fixture.zoho.CRM.META.getFields).toHaveBeenCalledWith({ Entity: "Applications_History" });
});

test("uses Billable for a legacy source without Billing Type", async () => {
  const fixture = makeApi({ sourceBillingType: null, contacts: [], attachments: [] });
  await expect(fixture.move()).resolves.toHaveProperty("targetId", "target-1");
  expect(fixture.records["target-1"].Billing_Type).toBe("Billable");
});

test("waits for delayed attachment listing before deleting the source", async () => {
  const fixture = makeApi({ attachmentListingLag: 2 });
  await expect(fixture.move()).resolves.toHaveProperty("targetId", "target-1");
  expect(fixture.fileApi.getAttachments.mock.calls.filter(([request]) =>
    request.module === "Applications_History"
  ).length).toBeGreaterThanOrEqual(4);
  expect(fixture.records["history-1"]).toBeUndefined();
});

test("waits for delayed Contact related-list visibility before deleting the source", async () => {
  const fixture = makeApi({ contactListingLag: 2 });
  await expect(fixture.move()).resolves.toHaveProperty("targetId", "target-1");
  expect(fixture.api.getRelatedRecords.mock.calls.filter(([request]) =>
    request.Entity === "Applications_History" && request.RelatedList === "Contacts4"
  ).length).toBeGreaterThanOrEqual(4);
  expect(fixture.records["history-1"]).toBeUndefined();
});

test("rolls back when the destination Matter snapshot does not read back", async () => {
  const fixture = makeApi({ fail: "matterSnapshot" });
  await expect(fixture.move()).rejects.toThrow("Matter_No");
  expect(fixture.records["history-1"]).toBeDefined();
  expect(fixture.records["target-1"]).toBeUndefined();
});

test("moves a Stakeholder history with no Contacts or attachments", async () => {
  const fixture = makeApi({ contacts: [], attachments: [] });
  await expect(fixture.move()).resolves.toHaveProperty("targetId", "target-1");
  expect(fixture.zoho.CRM.FUNCTIONS.execute).not.toHaveBeenCalled();
  expect(fixture.api.insertRecord.mock.calls.filter(([request]) => request.Entity === "Application_Hstory")).toHaveLength(0);
});

test("does not create a target if source attachments cannot be read", async () => {
  const fixture = makeApi();
  fixture.fileApi.getAttachments.mockResolvedValueOnce({ data: null, error: "permission denied" });
  await expect(fixture.move()).rejects.toThrow("permission denied");
  expect(fixture.api.insertRecord).not.toHaveBeenCalled();
  expect(fixture.records["history-1"]).toBeDefined();
});

test("rolls back a new target when a Contact junction cannot be created", async () => {
  const fixture = makeApi({ fail: "targetJunction" });
  await expect(fixture.move()).rejects.toMatchObject({ targetId: null });
  expect(fixture.records["history-1"]).toBeDefined();
  expect(fixture.records["target-1"]).toBeUndefined();
  expect(fixture.api.deleteRecord).not.toHaveBeenCalledWith(expect.objectContaining({ Entity: "History1" }));
});

test("reuses a partial target on retry when rollback itself fails", async () => {
  const fixture = makeApi({ fail: "targetJunctionAndRollback" });
  await expect(fixture.move()).rejects.toMatchObject({ targetId: "target-1" });
  expect(fixture.records["history-1"]).toBeDefined();
  // A retry must use the saved target ID; this test checks the absence of another target insert.
  const targetCreatesBefore = fixture.api.insertRecord.mock.calls.filter(([request]) => request.Entity === "Applications_History").length;
  fixture.setFailure(null);
  await expect(fixture.move({ resumeTargetId: "target-1" })).resolves.toHaveProperty("targetId", "target-1");
  expect(fixture.api.insertRecord.mock.calls.filter(([request]) => request.Entity === "Applications_History")).toHaveLength(targetCreatesBefore);
});

test("retains the source when the attachment function reports failure", async () => {
  const fixture = makeApi({ fail: "attachmentFunction" });
  await expect(fixture.move()).rejects.toMatchObject({ targetId: null });
  expect(fixture.records["target-1"]).toBeUndefined();
  expect(fixture.api.deleteRecord).not.toHaveBeenCalledWith(expect.objectContaining({ Entity: "History1" }));
  expect(fixture.records["history-1"]).toBeDefined();
});

test("retains the source when target Contacts cannot be verified", async () => {
  const fixture = makeApi({ fail: "missingTargetContact" });
  await expect(fixture.move()).rejects.toThrow("same Contact links");
  expect(fixture.api.deleteRecord).not.toHaveBeenCalledWith(expect.objectContaining({ Entity: "History1" }));
});

test("restores source Contact links when source deletion fails", async () => {
  const fixture = makeApi({ fail: "sourceDelete" });
  await expect(fixture.move()).rejects.toMatchObject({ targetId: "target-1" });
  expect(fixture.records["history-1"]).toBeDefined();
  expect(fixture.sourceLinks.map((link) => link.Contact_Details.id).sort()).toEqual(["contact-1", "contact-2"]);
  fixture.setFailure(null);
  await expect(fixture.move({ resumeTargetId: "target-1" })).resolves.toHaveProperty("targetId", "target-1");
  expect(fixture.zoho.CRM.FUNCTIONS.execute).toHaveBeenCalledTimes(1);
});

test("restores an earlier source Contact link when a later junction delete fails", async () => {
  const fixture = makeApi({ fail: "sourceJunctionSecond" });
  await expect(fixture.move()).rejects.toMatchObject({ targetId: "target-1" });
  expect(fixture.records["history-1"]).toBeDefined();
  expect(fixture.sourceLinks.map((link) => link.Contact_Details.id).sort()).toEqual(["contact-1", "contact-2"]);
  expect(fixture.api.deleteRecord).not.toHaveBeenCalledWith(expect.objectContaining({ Entity: "History1" }));
});
