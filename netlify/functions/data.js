const { getStore } = require("@netlify/blobs");

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj)
  };
}

function defaultData() {
  return { budgets: { Fonctionnement: 0, Investissement: 0 }, expenses: [] };
}

exports.handler = async (event, context) => {
  try {
    // ---- Auth (Netlify Identity)
    const user = context?.clientContext?.user;
    if (!user) return json(401, { error: "Unauthorized" });

    // ---- Blobs config (manuel)
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_AUTH_TOKEN;
    if (!siteID || !token) {
      return json(500, {
        error: "Missing Blobs configuration",
        hint: "Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in Netlify environment variables."
      });
    }

    const store = getStore({ name: "lab-budget", siteID, token });
    const key = "data.json";

    // ---- GET : on lit en TEXTE puis JSON.parse (plus robuste)
    if (event.httpMethod === "GET") {
      let text = await store.get(key, { type: "text" }); // null si absent
      if (!text) return json(200, defaultData());

      // Auto-réparation si jamais on a stocké "[object Object]" ou autre contenu non-JSON
      try {
        const parsed = JSON.parse(text);
        // validation minimale
        if (!parsed || !Array.isArray(parsed.expenses)) return json(200, defaultData());
        return json(200, parsed);
      } catch (e) {
        // la donnée est corrompue : on réinitialise proprement
        const fresh = defaultData();
        await store.set(key, JSON.stringify(fresh));
        return json(200, fresh);
      }
    }

    // ---- PUT : on stocke TOUJOURS une chaîne JSON
    if (event.httpMethod === "PUT") {
      let body = event.body;

      // event.body est normalement une string
      if (typeof body === "string") {
        body = JSON.parse(body);
      }

      if (!body || !Array.isArray(body.expenses)) {
        return json(400, { error: "Bad payload" });
      }

      await store.set(key, JSON.stringify(body)); // ✅ IMPORTANT : string uniquement
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    return json(500, { error: String(e), stack: e?.stack });
  }
};
