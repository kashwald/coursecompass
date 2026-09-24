// ===================================================================
// Cave Hill Room Locator — Worker entry point
// Handles /api/* routes directly, and falls through to static assets
// (served via the `assets` binding) for everything else.
// ===================================================================

async function handleGetBuildings(env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const headers = { "Content-Type": "application/json" };

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: "Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars." }),
      { status: 500, headers }
    );
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    const url = `${SUPABASE_URL}/rest/v1/buildings?select=id,name,short_name,image_path,rooms(count)&order=short_name.asc`;
    const res = await fetch(url, { headers: sbHeaders });
    if (!res.ok) throw new Error(`Supabase error: ${res.status}`);

    const raw = await res.json();
    const buildings = raw.map((b) => ({
      id: b.id,
      name: b.name,
      short_name: b.short_name,
      image_path: b.image_path,
      room_count: (b.rooms && b.rooms[0] && b.rooms[0].count) || 0,
    }));

    return new Response(JSON.stringify({ buildings }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

async function handleGetRoom(env, requestUrl) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const headers = { "Content-Type": "application/json" };

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: "Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars." }),
      { status: 500, headers }
    );
  }

  const q = requestUrl.searchParams.get("q");
  if (!q || q.trim().length < 1) {
    return new Response(JSON.stringify({ rooms: [] }), { status: 200, headers });
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    const url = `${SUPABASE_URL}/rest/v1/rooms?room_name=ilike.*${encodeURIComponent(q)}*&select=*,buildings(name,short_name)&limit=15`;
    const res = await fetch(url, { headers: sbHeaders });
    if (!res.ok) throw new Error(`Supabase error: ${res.status}`);

    const rooms = await res.json();
    return new Response(JSON.stringify({ rooms }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

async function handleGetRooms(env, requestUrl) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const headers = { "Content-Type": "application/json" };

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: "Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars." }),
      { status: 500, headers }
    );
  }

  const buildingId = requestUrl.searchParams.get("buildingId");
  if (!buildingId) {
    return new Response(JSON.stringify({ error: "buildingId is required" }), { status: 400, headers });
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    const [buildingRes, roomsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/buildings?id=eq.${encodeURIComponent(buildingId)}&select=*`, { headers: sbHeaders }),
      fetch(`${SUPABASE_URL}/rest/v1/rooms?building_id=eq.${encodeURIComponent(buildingId)}&select=*&order=room_name.asc`, { headers: sbHeaders }),
    ]);

    if (!buildingRes.ok || !roomsRes.ok) {
      throw new Error(`Supabase error: buildings=${buildingRes.status} rooms=${roomsRes.status}`);
    }

    const [buildings, rooms] = await Promise.all([buildingRes.json(), roomsRes.json()]);

    if (!buildings.length) {
      return new Response(JSON.stringify({ error: "Building not found" }), { status: 404, headers });
    }

    return new Response(JSON.stringify({ building: buildings[0], rooms }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/get-buildings") {
      return handleGetBuildings(env);
    }
    if (url.pathname === "/api/get-room") {
      return handleGetRoom(env, url);
    }
    if (url.pathname === "/api/get-rooms") {
      return handleGetRooms(env, url);
    }

    // Not an API route — serve static assets (index.html, app.js, images, etc.)
    return env.ASSETS.fetch(request);
  },
};
