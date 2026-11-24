export const preferenceStorage = {
  getItem(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // WARNING: Browsers can deny preference writes even after a successful read.
    }
  },
  removeItem(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      // WARNING: Browsers can deny storage removal in private sessions.
    }
  },
};
