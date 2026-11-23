const fragment = new URLSearchParams(location.hash.slice(1));
const project = fragment.get("project") ?? "";
const key = fragment.get("key") ?? "";
const token = fragment.get("token") ?? "";
const form = document.querySelector("#comment");
const message = document.querySelector("#message");
const button = form.querySelector("button");
const feedback = document.querySelector("#feedback");
const base = /^[a-z0-9]{20}$/.test(project) ? "https://" + project + ".supabase.co/rest/v1/rpc/" : null;

async function rpc(name, body) {
  if (!base || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("El enlace está incompleto.");
  const response = await fetch(base + name,{
    method:"POST", redirect:"error", signal:AbortSignal.timeout(12000),
    headers:{ apikey:key,"Content-Type":"application/json" },body:JSON.stringify({ token,...body }),
  });
  if (!response.ok) throw new Error("El servicio no está disponible. Inténtalo de nuevo en unos minutos.");
  return response.json();
}

async function load() {
  try {
    const version = await rpc("capricorn_review",{});
    if (!version) throw new Error("Este enlace venció o ya no está disponible. Pídele uno nuevo al editor.");
    document.querySelector("#title").textContent = version.title;
    const details = document.querySelector("#details");
    details.textContent = "Versión " + version.version + " · " + version.status;
    details.hidden = false;
    if (version.videoUrl) {
      try {
        const url = new URL(version.videoUrl);
        if (["http:","https:"].includes(url.protocol) && !url.username && !url.password) {
          const video = document.querySelector("#video");
          video.href = url.href;
          video.hidden = false;
        }
      } catch { /* An invalid URL does not block comments. */ }
    }
    feedback.textContent = "";
    form.hidden = false;
  } catch (error) { feedback.textContent = error.message; }
}

form.addEventListener("submit",async (event) => {
  event.preventDefault();
  const value = message.value.trim();
  if (!value || button.disabled) return;
  button.disabled = true;
  feedback.textContent = "Enviando comentario…";
  try {
    if (!await rpc("capricorn_comment",{ message:value }))
      throw new Error("No se pudo recibir el comentario. El enlace pudo vencer o alcanzar su límite.");
    message.value = "";
    feedback.textContent = "Comentario enviado al editor.";
  } catch (error) { feedback.textContent = error.message; }
  finally { button.disabled = false; }
});
void load();
