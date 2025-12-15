const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  const json = (statusCode, obj) => ({
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj)
  });

  try {
    const user = context?.clientContext?.user;
    if (!user) return json(401, { error: "Unauthorized", hint: "Missing/invalid Netlify Identity token" });

    const store = getStore("lab-budget");
    const key = "data.json";

    if (event.httpMethod === "GET") {
      const raw = await store.get(key, { type: "json" });
      return json(200, raw || { budgets: { Fonctionnement: 0, Investissement: 0 }, expenses: [] });
    }

    if (event.httpMethod === "PUT") {
      const body = event.body ? JSON.parse(event.body) : null;
      if (!body || !Array.isArray(body.expenses)) {
        return json(400, { error: "Bad payload", got: body });
      }
      await store.set(key, body);
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed", method: event.httpMethod });
  } catch (e) {
    return json(500, {
      error: String(e),
      name: e?.name,
      stack: e?.stack,
      hint:
        "Très probable: Blobs pas activé/autorisé sur ce site, ou erreur de contexte Blobs. Va sur Netlify > ton site > Blobs."
    });
  }
};
