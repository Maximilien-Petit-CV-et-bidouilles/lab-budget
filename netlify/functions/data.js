const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  try {
    // Auth: nécessite Netlify Identity connecté
    const user = context && context.clientContext && context.clientContext.user;
    if (!user) {
      return {
        statusCode: 401,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" })
      };
    }

    const store = getStore("lab-budget");
    const key = "data.json";

    if (event.httpMethod === "GET") {
      const raw = await store.get(key, { type: "json" });
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(raw || { budgets: { Fonctionnement: 0, Investissement: 0 }, expenses: [] })
      };
    }

    if (event.httpMethod === "PUT") {
      const body = event.body ? JSON.parse(event.body) : null;

      if (!body || !Array.isArray(body.expenses)) {
        return {
          statusCode: 400,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "Bad payload" })
        };
      }

      await store.set(key, body);

      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true })
      };
    }

    return {
      statusCode: 405,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String(e) })
    };
  }
};
