import { describe, it, expect } from "vitest";
import { parseResult } from "../lib/request.js";

const good = { reference: "John 3:16", verse: "For God so loved the world", explanation: "Love." };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("parseResult", () => {
  it("returns the result for a 2xx response with all fields", async () => {
    expect(await parseResult(jsonResponse({ raw: good }))).toEqual({ ok: true, result: good });
  });

  it("keeps only reference, verse and explanation", async () => {
    const out = await parseResult(jsonResponse({ raw: { ...good, extra: "x" }, other: 1 }));
    expect(out).toEqual({ ok: true, result: good });
  });

  it("rejects a non-2xx status even with a valid body", async () => {
    const out = await parseResult(jsonResponse({ raw: good }, 500));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/500/);
  });

  it("rejects a 2xx body that is not JSON", async () => {
    const out = await parseResult(new Response("<html>oops</html>", { status: 200 }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unreadable/i);
  });

  it("rejects a 2xx JSON body with an error field and includes its text", async () => {
    const out = await parseResult(jsonResponse({ error: "model overloaded" }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/model overloaded/);
  });

  it("rejects an error field even when raw is also present", async () => {
    const out = await parseResult(jsonResponse({ error: "partial", raw: good }));
    expect(out.ok).toBe(false);
  });

  it("rejects a body without raw", async () => {
    const out = await parseResult(jsonResponse({}));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/incomplete/i);
  });

  it("rejects a JSON null body", async () => {
    const out = await parseResult(jsonResponse(null));
    expect(out.ok).toBe(false);
  });

  for (const field of ["reference", "verse", "explanation"]) {
    it(`rejects a missing ${field}`, async () => {
      const raw = { ...good };
      delete raw[field];
      const out = await parseResult(jsonResponse({ raw }));
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/incomplete/i);
    });

    it(`rejects an empty ${field}`, async () => {
      const out = await parseResult(jsonResponse({ raw: { ...good, [field]: "  " } }));
      expect(out.ok).toBe(false);
    });

    it(`rejects a non-string ${field}`, async () => {
      const out = await parseResult(jsonResponse({ raw: { ...good, [field]: 42 } }));
      expect(out.ok).toBe(false);
    });
  }
});
