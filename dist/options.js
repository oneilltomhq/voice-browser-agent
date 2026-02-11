// src/options.ts
async function loadSettings() {
  const result = await chrome.storage.local.get([
    "anthropicApiKey",
    "deepgramApiKey"
  ]);
  return {
    anthropicApiKey: result.anthropicApiKey || "",
    deepgramApiKey: result.deepgramApiKey || ""
  };
}
async function saveSettings(settings) {
  await chrome.storage.local.set(settings);
}
document.addEventListener("DOMContentLoaded", async () => {
  const anthropicInput = document.getElementById(
    "anthropic-key"
  );
  const deepgramInput = document.getElementById(
    "deepgram-key"
  );
  const saveBtn = document.getElementById("btn-save");
  const status = document.getElementById("status");
  const settings = await loadSettings();
  anthropicInput.value = settings.anthropicApiKey;
  deepgramInput.value = settings.deepgramApiKey;
  saveBtn.addEventListener("click", async () => {
    await saveSettings({
      anthropicApiKey: anthropicInput.value.trim(),
      deepgramApiKey: deepgramInput.value.trim()
    });
    status.textContent = "Saved";
    setTimeout(() => {
      status.textContent = "";
    }, 2e3);
  });
});
