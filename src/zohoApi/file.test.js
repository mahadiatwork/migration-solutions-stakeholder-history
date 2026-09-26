jest.mock("axios", () => ({ request: jest.fn() }));

import { parseAttachmentListResponse, parseAttachmentPageResponse } from "./file";

const pageResponse = (data, moreRecords) => ({
  code: "SUCCESS",
  details: {
    statusMessage: JSON.stringify({ data, info: { more_records: moreRecords } }),
  },
});

const loadFileApi = (invoke) => {
  jest.resetModules();
  window.ZOHO = { CRM: { CONNECTION: { invoke } } };
  return require("./file").file;
};

afterEach(() => {
  delete window.ZOHO;
});

test("reads attachment rows from Zoho's JSON statusMessage", () => {
  expect(parseAttachmentListResponse({
    code: "SUCCESS",
    details: { statusMessage: JSON.stringify({ data: [{ id: "file-1", File_Name: "note.pdf" }] }) },
  })).toEqual([{ id: "file-1", File_Name: "note.pdf" }]);
});

test("accepts an explicit empty attachment list or no-content status", () => {
  expect(parseAttachmentListResponse({ details: { statusMessage: { data: [] } } })).toEqual([]);
  expect(parseAttachmentListResponse({ code: "SUCCESS", statusCode: 204 })).toEqual([]);
  expect(parseAttachmentListResponse({
    details: { statusCode: "204", statusMessage: "No Content" },
  })).toEqual([]);
  expect(parseAttachmentListResponse({ details: { statusMessage: { code: "NO_CONTENT" } } })).toEqual([]);
});

test("rejects malformed and ambiguous attachment responses", () => {
  expect(() => parseAttachmentListResponse({ details: { statusMessage: "{broken" } }))
    .toThrow("Could not parse");
  expect(() => parseAttachmentListResponse({ code: "SUCCESS", details: { statusMessage: "" } }))
    .toThrow("verified list");
  expect(() => parseAttachmentListResponse({ code: "SUCCESS", details: {} }))
    .toThrow("verified list");
  expect(() => parseAttachmentListResponse({
    code: "SUCCESS",
    details: { statusMessage: { data: [], info: { more_records: true } } },
  })).toThrow("another page without records");
});

test("rejects errors inside a successful Connection.invoke envelope", () => {
  expect(() => parseAttachmentListResponse({
    code: "SUCCESS",
    details: { statusMessage: { code: "INVALID_DATA", status: "error", message: "No access" } },
  })).toThrow("No access");
  expect(() => parseAttachmentListResponse({ code: "NO_PERMISSION", message: "Denied" }))
    .toThrow("Denied");
  expect(() => parseAttachmentListResponse({
    code: "SUCCESS",
    details: { statusCode: 403, statusMessage: { data: [] } },
  })).toThrow("HTTP 403");
  expect(() => parseAttachmentListResponse({
    code: "SUCCESS",
    statusCode: 401,
    details: { statusMessage: { data: [] } },
  })).toThrow("HTTP 401");
});

test("reads every attachment page before returning a verified list", async () => {
  const firstPage = Array.from({ length: 200 }, (_, index) => ({
    id: `file-${index}`,
    File_Name: `note-${index}.pdf`,
  }));
  const secondPage = [{ id: "file-200", File_Name: "last.pdf" }];
  const invoke = jest.fn()
    .mockResolvedValueOnce(pageResponse(firstPage, true))
    .mockResolvedValueOnce(pageResponse(secondPage, false));
  const fileApi = loadFileApi(invoke);

  await expect(fileApi.getAttachments({ module: "History1", recordId: "history-1" }))
    .resolves.toEqual({ data: [...firstPage, ...secondPage], error: null });
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[0][1].url).toContain("page=1&per_page=200");
  expect(invoke.mock.calls[1][1].url).toContain("page=2&per_page=200");
  expect(parseAttachmentPageResponse(pageResponse(firstPage, true))).toMatchObject({ moreRecords: true });
});

test("rejects a full page without pagination info", async () => {
  const fullPage = Array.from({ length: 200 }, (_, index) => ({ id: `file-${index}` }));
  const invoke = jest.fn().mockResolvedValue({
    code: "SUCCESS",
    details: { statusMessage: JSON.stringify({ data: fullPage }) },
  });
  const fileApi = loadFileApi(invoke);
  await expect(fileApi.getAttachments({ module: "History1", recordId: "history-1" }))
    .resolves.toMatchObject({ data: null, error: expect.stringContaining("pagination info") });
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("rejects a malformed later page without returning partial attachments", async () => {
  const invoke = jest.fn()
    .mockResolvedValueOnce(pageResponse([{ id: "first" }], true))
    .mockResolvedValueOnce({ code: "SUCCESS", details: { statusMessage: "{broken" } });
  const fileApi = loadFileApi(invoke);
  await expect(fileApi.getAttachments({ module: "History1", recordId: "history-1" }))
    .resolves.toMatchObject({ data: null, error: expect.stringContaining("Could not parse") });
});

test("rejects an error on a later page without returning partial attachments", async () => {
  const invoke = jest.fn()
    .mockResolvedValueOnce(pageResponse([{ id: "first" }], true))
    .mockResolvedValueOnce({
      code: "SUCCESS",
      details: { statusCode: 403, statusMessage: { data: [] } },
    });
  const fileApi = loadFileApi(invoke);
  await expect(fileApi.getAttachments({ module: "History1", recordId: "history-1" }))
    .resolves.toMatchObject({ data: null, error: expect.stringContaining("HTTP 403") });
});

test("stops at the bounded page limit instead of returning a truncated list", async () => {
  const invoke = jest.fn(async () => pageResponse([{ id: `file-${invoke.mock.calls.length}` }], true));
  const fileApi = loadFileApi(invoke);
  await expect(fileApi.getAttachments({ module: "History1", recordId: "history-1" }))
    .resolves.toMatchObject({ data: null, error: expect.stringContaining("50 pages") });
  expect(invoke).toHaveBeenCalledTimes(50);
});
