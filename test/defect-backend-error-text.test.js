import { describe, it, expect, vi } from "vitest";
import { createChromeMock } from "./chrome-mock.js";
import { runCommentRequest, STORAGE_KEY } from "../lib/request.js";

// Defect R6: backend {"error": ...} text went verbatim and uncapped into the
// OS notification, and non-string values rendered as "[object Object]".

const FIXED = "The service reported an error. Click the icon for details.";

function run(body) {
  const chrome = createChromeMock();
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  let n = 0;
  return runCommentRequest("post", { chrome, fetch, newId: () => `id-${++n}`, now: () => 1 })
    .then(() => ({
      record: chrome.storage.local.data[STORAGE_KEY],
      messages: chrome.notifications.create.mock.calls.map(([o]) => o.message)
    }));
}

describe("backend-reported error text", () => {
  it("notifies with a fixed message, not the backend text", async () => {
    const { record, messages } = await run({ error: "model overloaded" });
    expect(messages).toEqual([FIXED]);
    expect(record.status).toBe("error");
    expect(record.error).toContain("model overloaded");
  });

  it("uses a generic popup message for a non-string error value", async () => {
    const { record, messages } = await run({ error: { code: 7, detail: "x" } });
    expect(messages).toEqual([FIXED]);
    expect(record.error).not.toContain("[object Object]");
    expect(record.error).toBe("The service reported an error. Please try again.");
  });

  it("trims a string error and caps the backend text at 200 characters", async () => {
    const long = "y".repeat(500);
    const { record, messages } = await run({ error: `   ${long}   ` });
    expect(messages).toEqual([FIXED]);
    expect(record.error).toContain("y".repeat(200));
    expect(record.error).not.toContain("y".repeat(201));
    expect(record.error.length).toBeLessThan(300);
  });

  it("uses the generic popup message for a blank string error", async () => {
    const { record } = await run({ error: "   " });
    expect(record.error).toBe("The service reported an error. Please try again.");
  });
});
