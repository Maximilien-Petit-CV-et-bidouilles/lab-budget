import { getStore } from "@netlify/blobs";

export default async (request, context) => {
  try {
    // Auth: nécessite un utilisateur Netlify Identity connecté
    const user = context?.clientContext?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    }

    const store = getStore("lab-budget"); // nom du store
    const key = "data.json";

    if (request.method === "GET") {
      const raw = await store.get(key, { type: "json" });
      return new Response(JSON.stringify(raw ?? { expenses: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (request.method === "PUT") {
      const body = await request.json();
      // minimal validation
      if (!body || !Array.isArray(body.expenses)) {
        return new Response(JSON.stringify({ error: "Bad payload" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
      await store.set(key, body);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
};
