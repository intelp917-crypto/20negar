export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
let deferredInstallPrompt: InstallPromptEvent | null = null;
export function canInstall(): boolean { return !!deferredInstallPrompt; }
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event as InstallPromptEvent;
  window.dispatchEvent(new Event('20negar:install-available'));
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  window.dispatchEvent(new Event('20negar:install-available'));
});
export async function promptInstall(): Promise<boolean> {
  if (!deferredInstallPrompt) return false;
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  try {
    await prompt.prompt();
    return (await prompt.userChoice).outcome === 'accepted';
  } finally {
    window.dispatchEvent(new Event('20negar:install-available'));
  }
}
