const loadRecordApi = ({ getRelatedRecords, searchRecord, invoke } = {}) => {
  jest.resetModules();
  window.ZOHO = {
    CRM: {
      API: {
        getRelatedRecords: getRelatedRecords || jest.fn(),
        searchRecord: searchRecord || jest.fn(),
      },
      CONNECTION: {
        invoke: invoke || jest.fn(),
      },
    },
  };
  return require("./record");
};

afterEach(() => {
  jest.restoreAllMocks();
  delete window.ZOHO;
});

test("loads every Stakeholder History related-list page from the active CRM", async () => {
  const getRelatedRecords = jest
    .fn()
    .mockResolvedValueOnce({
      data: [{ id: "history-1" }, { id: "history-2" }],
      info: { more_records: true },
    })
    .mockResolvedValueOnce({
      data: [{ id: "history-3" }],
      info: { more_records: false },
    });
  const { getRecordsFromRelatedList } = loadRecordApi({ getRelatedRecords });

  await expect(
    getRecordsFromRelatedList({
      module: "Accounts",
      recordId: "stakeholder-1",
      RelatedListAPI: "Stakeholder_History",
      perPage: 2,
      maxRecords: 10,
    })
  ).resolves.toEqual({
    data: [
      { id: "history-1" },
      { id: "history-2" },
      { id: "history-3" },
    ],
    error: null,
  });
  expect(getRelatedRecords).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ page: 1, per_page: 2 })
  );
  expect(getRelatedRecords).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ page: 2, per_page: 2 })
  );
});

test("continues pagination when Zoho marks a short page as having more records", async () => {
  const getRelatedRecords = jest
    .fn()
    .mockResolvedValueOnce({
      data: [{ id: "history-1" }],
      info: { more_records: true },
    })
    .mockResolvedValueOnce({
      data: [{ id: "history-2" }],
      info: { more_records: false },
    });
  const { getRecordsFromRelatedList } = loadRecordApi({ getRelatedRecords });

  await expect(
    getRecordsFromRelatedList({
      module: "Accounts",
      recordId: "stakeholder-1",
      RelatedListAPI: "Stakeholder_History",
      perPage: 2,
      maxRecords: 10,
    })
  ).resolves.toEqual({
    data: [{ id: "history-1" }, { id: "history-2" }],
    error: null,
  });
  expect(getRelatedRecords).toHaveBeenCalledTimes(2);
});

test("loads direct sandbox History even when it has no Contact junction", async () => {
  const getRelatedRecords = jest.fn().mockResolvedValue({
    data: [],
    info: { more_records: false },
  });
  const searchRecord = jest.fn(({ Entity }) => Promise.resolve({
    data: Entity === "History1" ? [{ id: "sandbox-history" }] : [],
    info: { more_records: false },
  }));
  const invoke = jest.fn().mockResolvedValue({ data: [] });
  const { fetchStakeholderHistory } = loadRecordApi({
    getRelatedRecords,
    searchRecord,
    invoke,
  });

  await expect(
    fetchStakeholderHistory("Accounts", "sandbox-stakeholder")
  ).resolves.toEqual([{ id: "sandbox-history" }]);
  expect(getRelatedRecords).toHaveBeenCalledWith(
    expect.objectContaining({
      Entity: "Accounts",
      RecordID: "sandbox-stakeholder",
      RelatedList: "Stakeholder_History",
    })
  );
  expect(searchRecord).toHaveBeenCalledWith(
    expect.objectContaining({
      Entity: "History1",
      Query: "(Stakeholder:equals:sandbox-stakeholder)",
      delay: false,
    })
  );
  expect(invoke).not.toHaveBeenCalled();
});

test("returns complete direct History before its participant junction rows", async () => {
  const getRelatedRecords = jest.fn().mockResolvedValue({
    data: [],
    info: { more_records: false },
  });
  const direct = { id: "history-1", History_Details_Plain: "Full details" };
  const junction = {
    id: "junction-1",
    Contact_History_Info: { id: "history-1", name: "History 1" },
    Contact_Details: { id: "contact-1", name: "Jane Contact" },
  };
  const searchRecord = jest.fn(({ Entity }) => Promise.resolve({
    data: Entity === "History1" ? [direct] : [junction],
    info: { more_records: false },
  }));
  const { fetchStakeholderHistory } = loadRecordApi({
    getRelatedRecords,
    searchRecord,
  });

  await expect(
    fetchStakeholderHistory("Accounts", "stakeholder-1")
  ).resolves.toEqual([direct, junction]);
});

test("keeps using the active CRM when its related list is unavailable", async () => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  const getRelatedRecords = jest
    .fn()
    .mockRejectedValue(new Error("related list unavailable"));
  const searchRecord = jest.fn(({ Entity }) => Promise.resolve({
    data: Entity === "History1" ? [{ id: "active-history" }] : [],
    info: { more_records: false },
  }));
  const invoke = jest.fn().mockResolvedValue({ data: [{ id: "other-org-history" }] });
  const { fetchStakeholderHistory } = loadRecordApi({
    getRelatedRecords,
    searchRecord,
    invoke,
  });

  await expect(
    fetchStakeholderHistory("Accounts", "stakeholder-1")
  ).resolves.toEqual([{ id: "active-history" }]);
  expect(invoke).not.toHaveBeenCalled();
});

test("fails closed when direct active Stakeholder History cannot be read", async () => {
  const getRelatedRecords = jest.fn().mockResolvedValue({
    data: [],
    info: { more_records: false },
  });
  const searchRecord = jest.fn(({ Entity }) =>
    Entity === "History1"
      ? Promise.reject(new Error("active search denied"))
      : Promise.resolve({ data: [], info: { more_records: false } })
  );
  const invoke = jest.fn().mockResolvedValue({ data: [{ id: "other-org-history" }] });
  const { fetchStakeholderHistory } = loadRecordApi({
    getRelatedRecords,
    searchRecord,
    invoke,
  });

  await expect(
    fetchStakeholderHistory("Accounts", "stakeholder-1")
  ).rejects.toThrow("active search denied");
  expect(invoke).not.toHaveBeenCalled();
});

test("fails when both active participant sources are unavailable", async () => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  const getRelatedRecords = jest
    .fn()
    .mockRejectedValue(new Error("related list denied"));
  const searchRecord = jest.fn(({ Entity }) =>
    Entity === "History1"
      ? Promise.resolve({ data: [{ id: "history-1" }], info: { more_records: false } })
      : Promise.reject(new Error("junction search denied"))
  );
  const { fetchStakeholderHistory } = loadRecordApi({
    getRelatedRecords,
    searchRecord,
  });

  await expect(
    fetchStakeholderHistory("Accounts", "stakeholder-1")
  ).rejects.toThrow("Could not load Stakeholder History participants");
});

test("does not treat a COQL error payload as an empty history list", async () => {
  const invoke = jest.fn().mockResolvedValue({
    details: {
      statusMessage: JSON.stringify({
        status: "error",
        code: "INVALID_QUERY",
        message: "invalid field",
      }),
    },
  });
  const { fetchStakeholderHistoryViaCoqlV8 } = loadRecordApi({ invoke });

  await expect(
    fetchStakeholderHistoryViaCoqlV8("Accounts", "stakeholder-1")
  ).rejects.toThrow("INVALID_QUERY: invalid field");
});
