let csrfToken = "";

export async function api(path, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: "same-origin", signal: signal || AbortSignal.timeout(90000),
      headers: { ...(method !== "GET" ? { "Content-Type": "application/json", "X-CSRF-Token": csrfToken } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw Object.assign(new Error("The server could not be reached. Refresh to check whether your request completed before trying again."), { status: 0 });
  }
  const data = await response.json().catch(() => ({}));
  if (data.csrfToken) csrfToken = data.csrfToken;
  if (!response.ok) throw Object.assign(new Error(data.error || "The request could not be completed."), { status: response.status, code: data.code });
  return data;
}
