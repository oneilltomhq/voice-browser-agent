/**
 * Options page — save API keys to chrome.storage
 * Keys are stored for future LLM + voice phases
 */

interface Settings {
  anthropicApiKey: string;
  deepgramApiKey: string;
}

async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get([
    'anthropicApiKey',
    'deepgramApiKey',
  ]);
  return {
    anthropicApiKey: (result.anthropicApiKey as string) || '',
    deepgramApiKey: (result.deepgramApiKey as string) || '',
  };
}

async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set(settings);
}

document.addEventListener('DOMContentLoaded', async () => {
  const anthropicInput = document.getElementById(
    'anthropic-key'
  ) as HTMLInputElement;
  const deepgramInput = document.getElementById(
    'deepgram-key'
  ) as HTMLInputElement;
  const saveBtn = document.getElementById('btn-save') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLSpanElement;

  const settings = await loadSettings();
  anthropicInput.value = settings.anthropicApiKey;
  deepgramInput.value = settings.deepgramApiKey;

  saveBtn.addEventListener('click', async () => {
    await saveSettings({
      anthropicApiKey: anthropicInput.value.trim(),
      deepgramApiKey: deepgramInput.value.trim(),
    });
    status.textContent = 'Saved';
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  });
});
