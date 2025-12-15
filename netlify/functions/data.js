const { getStore } = require("@netlify/blobs");

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event, context) => {
  try {
    // --- Auth ---
    const user = context?.clientContext?.user;
    if (!user) return json(401, { error: "Unauthorized" });

    // --- Blobs config ---
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_AUTH_TOKEN;

    if (!siteID || !token) {
      return json(500, {
        error: "Missing Blobs configuration",
        hint: "Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN"
      });
    }

    const store = getStore({
      name: "lab-budget",
      siteID,
      token
    });

    const key = "data.json";

    // --- GET ---
    if (event.httpMethod === "GET") {
      const raw = await store.get(key, { type: "json" });
      return json(200, raw || {
        budgets: { Fonctionnement: 0, Investissement: 0 },
        expenses: []
      });
    }

    // --- PUT ---
    if (event.httpMethod === "PUT") {
      let body;

      // ✅ CORRECTION ICI
      if (typeof event.body === "string") {
        body = JSON.parse(event.body);
      } else {
        body = event.body;
      }

      if (!body || !Array.isArray(body.expenses)) {
        return json(400, {
          error: "Bad payload",
          receivedType: typeof body
        });
      }

      await store.set(key, body);
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });

  } catch (e) {
    return json(500, {
      error: String(e),
      stack: e?.stack
    });
  }
};
