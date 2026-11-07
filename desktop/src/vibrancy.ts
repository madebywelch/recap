export function startVibrancy(check: () => Promise<boolean | null>, setEnabled: (enabled: boolean) => void) {
  let pending = false;
  const update = async () => {
    if (pending) return false;
    pending = true;
    try {
      const enabled = await check();
      setEnabled(enabled === true);
      return enabled !== null;
    } catch {
      setEnabled(false);
      return false;
    } finally {
      pending = false;
    }
  };
  void update().then((supported) => {
    if (supported) window.setInterval(update, 1000);
  });
}
