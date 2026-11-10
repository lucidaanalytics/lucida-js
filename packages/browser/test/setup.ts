// Clients wait for GET /v1/config (project consent mode) before storing or sending; tests without their own fetch get an answer with no project mode.
globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
