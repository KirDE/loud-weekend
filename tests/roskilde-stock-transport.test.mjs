import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectRoskildeStock } from "../lib/ingestion/adapters/roskilde-stock-transport.ts";
import { ROSKILDE_PRODUCTS_URL as products } from "../lib/ingestion/adapters/roskilde-stock.ts";
const root = products.replace("/products", ""),
  select = root + "/selectproductgroup";
const html = readFileSync(
  new URL("./fixtures/roskilde/tickster-products.html", import.meta.url),
  "utf8",
);
const init =
  "<title>Roskilde Festival - Tickster</title><h3>Partout</h3><p>Alle otte dage på Roskilde Festival 2027.</p>";
function response(body, url, status = 200, headers = {}) {
  const h = new Headers({ "content-type": "text/html; charset=utf-8" });
  for (const [k, v] of Object.entries(headers)) {
    h.delete(k);
    for (const x of Array.isArray(v) ? v : [v]) h.append(k, x);
  }
  const r = new Response(body, { status, headers: h });
  Object.defineProperty(r, "url", { value: url });
  return r;
}
function mock(change = () => {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const n = calls.length;
    const v = {
      body: n === 1 ? "" : n === 2 ? init : html,
      url,
      status: n === 1 ? 302 : 200,
      headers:
        n === 1
          ? {
              location: "/da/vgkw6td2h3rrfkv/selectproductgroup",
              "set-cookie": "session=synthetic; Path=/; Secure; HttpOnly",
            }
          : {},
    };
    change(v, n, options);
    return response(v.body, v.url, v.status, v.headers);
  };
  return { calls, fetch };
}
test("bounded fixed GET chain forwards scoped ephemeral cookie and projects only proof", async () => {
  const m = mock(),
    c = await collectRoskildeStock({ fetch: m.fetch });
  assert.deepEqual(
    m.calls.map((c) => c.url),
    [root, select, products],
  );
  assert.equal(c.ticketStatus, "available");
  for (const { options: o } of m.calls) {
    assert.equal(o.method, "GET");
    assert.equal(o.redirect, "manual");
    assert.equal(o.credentials, "omit");
    assert.equal(o.body, undefined);
  }
  assert.equal(m.calls[0].options.headers.Cookie, undefined);
  assert.equal(m.calls[2].options.headers.Cookie, "session=synthetic");
  assert.doesNotMatch(JSON.stringify(c), /synthetic|cookie|session|2650|quantity\d/);
  const m2 = mock();
  await collectRoskildeStock({ fetch: m2.fetch });
  assert.equal(m2.calls[0].options.headers.Cookie, undefined);
});
test("direct root200 initialization supported", async () => {
  const calls = [];
  await collectRoskildeStock({
    fetch: async (u) => {
      calls.push(u);
      return response(u === root ? init : html, u);
    },
  });
  assert.deepEqual(calls, [root, products]);
});
for (const status of [201, 204, 206, 403, 429, 500])
  test(`status ${status} never healthy`, async () => {
    const m = mock((v, n) => {
      if (n === 3) {
        v.status = status;
        if (status === 204) v.body = null;
      }
    });
    await assert.rejects(collectRoskildeStock({ fetch: m.fetch }), /not verified/);
  });
for (const [label, change] of [
  [
    "external redirect",
    (v, n) => {
      if (n === 1) v.headers.location = "https://example.org/cart";
    },
  ],
  [
    "cart redirect",
    (v, n) => {
      if (n === 1) v.headers.location = root + "/cart";
    },
  ],
  [
    "query session redirect",
    (v, n) => {
      if (n === 1) v.headers.location = select + "?session=synthetic";
    },
  ],
  [
    "redirect loop",
    (v, n) => {
      if (n === 2) {
        v.status = 302;
        v.headers.location = select;
      }
    },
  ],
  [
    "product redirect",
    (v, n) => {
      if (n === 3) {
        v.status = 302;
        v.headers.location = select;
      }
    },
  ],
  [
    "wrong response URL",
    (v, n) => {
      if (n === 3) v.url = select;
    },
  ],
  [
    "wrong mime",
    (v, n) => {
      if (n === 3) v.headers["content-type"] = "application/json";
    },
  ],
  [
    "wrong encoding",
    (v, n) => {
      if (n === 3) v.headers["content-type"] = "text/html; charset=iso-8859-1";
    },
  ],
  [
    "oversize declared",
    (v, n) => {
      if (n === 3) v.headers["content-length"] = "2000001";
    },
  ],
  [
    "oversize actual",
    (v, n) => {
      if (n === 3) v.body = "x".repeat(2000001);
    },
  ],
  [
    "invalid UTF8",
    (v, n) => {
      if (n === 3) v.body = new Uint8Array([0xc3, 0x28]);
    },
  ],
  [
    "expired session",
    (v, n) => {
      if (n === 3) v.body = init;
    },
  ],
  [
    "wrong initialization",
    (v, n) => {
      if (n === 2) v.body = "<title>Login</title>";
    },
  ],
  [
    "old initialization",
    (v, n) => {
      if (n === 2) v.body = init.replace("2027", "2026");
    },
  ],
  [
    "hidden initialization",
    (v, n) => {
      if (n === 2)
        v.body =
          "<title>Roskilde Festival - Tickster</title>" +
          "<div hidden>Partout Alle otte dage på Roskilde Festival 2027.</div>";
    },
  ],
  [
    "stock absent",
    (v, n) => {
      if (n === 3) v.body = html.replaceAll("Standard", "Other");
    },
  ],
  [
    "cookie flood",
    (v, n) => {
      if (n === 1) v.headers["set-cookie"] = "session=" + "x".repeat(4097);
    },
  ],
  [
    "foreign cookie",
    (v, n) => {
      if (n === 1) v.headers["set-cookie"] = "session=synthetic; Domain=example.org";
    },
  ],
])
  test(label + " fails closed with no fallback", async () => {
    const m = mock(change);
    await assert.rejects(
      collectRoskildeStock({ fetch: m.fetch }),
      /^Error: Roskilde public stock transport not verified$/,
    );
    assert.ok(m.calls.length <= 3);
  });
test("private network errors sanitized", async () => {
  await assert.rejects(
    collectRoskildeStock({
      fetch: async () => {
        throw Error("session=secret");
      },
    }),
    /^Error: Roskilde public stock transport not verified$/,
  );
});
test("single deadline bounds fetch even if injected transport ignores abort", async () => {
  let signal;
  await assert.rejects(
    collectRoskildeStock({
      timeoutMs: 20,
      fetch: async (u, o) => {
        signal = o.signal;
        return new Promise(() => {});
      },
    }),
    /not verified/,
  );
  assert.equal(signal.aborted, true);
});
test("single deadline covers a stalled response body", async () => {
  let cancelled = false;
  await assert.rejects(
    collectRoskildeStock({
      timeoutMs: 20,
      fetch: async (u) =>
        response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          u,
        ),
    }),
    /not verified/,
  );
  assert.equal(cancelled, true);
});
test("late transport cannot continue after deadline", async () => {
  let calls = 0;
  await assert.rejects(
    collectRoskildeStock({
      timeoutMs: 10,
      fetch: async (u) => {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
        return response(init, u);
      },
    }),
  );
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 1);
});
test("invalid deadlines rejected before network", async () => {
  for (const t of [0, -1, NaN, Infinity, 20001])
    await assert.rejects(collectRoskildeStock({ timeoutMs: t, fetch: async () => assert.fail() }));
});
test("cookie jar respects paths and rotates the same scoped anonymous cookie", async () => {
  const m = mock((v, n, o) => {
    if (n === 1) v.headers["set-cookie"] = "restricted=synthetic; Path=/cart; Secure";
    if (n === 2) {
      assert.equal(o.headers.Cookie, undefined);
      v.headers["set-cookie"] = "session=rotated; Path=/; Secure; HttpOnly";
    }
    if (n === 3) assert.equal(o.headers.Cookie, "session=rotated");
  });
  await collectRoskildeStock({ fetch: m.fetch });
});
test("failed run never lends its cookie to a later run", async () => {
  const bad = mock((v, n) => {
    if (n === 3) v.status = 403;
  });
  await assert.rejects(collectRoskildeStock({ fetch: bad.fetch }));
  const good = mock();
  await collectRoskildeStock({ fetch: good.fetch });
  assert.equal(good.calls[0].options.headers.Cookie, undefined);
});
test("one shared deadline is not reset at each GET", async () => {
  const m = mock();
  let calls = 0;
  await assert.rejects(
    collectRoskildeStock({
      timeoutMs: 45,
      fetch: async (u, o) => {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
        return m.fetch(u, o);
      },
    }),
    /not verified/,
  );
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(calls, 2);
});
test("duplicate initialization title rejected before products", async () => {
  const m = mock((v, n) => {
    if (n === 2) v.body = init + "<title>Other</title>";
  });
  await assert.rejects(collectRoskildeStock({ fetch: m.fetch }));
  assert.equal(m.calls.length, 2);
});
test("inline-hidden initialization rejected before products", async () => {
  const m = mock((v, n) => {
    if (n === 2)
      v.body =
        "<title>Roskilde Festival - Tickster</title>" +
        '<div style="display:none">Partout Alle otte dage på Roskilde Festival 2027.</div>';
  });
  await assert.rejects(collectRoskildeStock({ fetch: m.fetch }));
  assert.equal(m.calls.length, 2);
});
test("cookie response flood rejected before any followup", async () => {
  const m = mock((v, n) => {
    if (n === 1)
      v.headers["set-cookie"] = Array.from({ length: 33 }, (_, i) => `synthetic${i}=value; Path=/`);
  });
  await assert.rejects(collectRoskildeStock({ fetch: m.fetch }));
  assert.equal(m.calls.length, 1);
});
