import { create } from 'zustand';
import { api, clearSession, loadTokens, saveSession, setSessionLostHandler, getRefreshToken } from '../api/client';
import type { Session, User } from '../api/types';

type Status = 'loading' | 'guest' | 'authed';
interface AuthState {
  status: Status; user: User | null;
  bootstrap: () => Promise<void>; signIn: (s: Session) => Promise<void>; signOut: () => Promise<void>; setUser: (u: User) => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading', user: null,
  async bootstrap() {
    setSessionLostHandler(() => set({ status: 'guest', user: null }));
    if (!(await loadTokens())) return set({ status: 'guest' });
    try {
      set({ user: await api<User>('/me'), status: 'authed' });
    } catch (e) {
      // Çevrimdışı açılışta oturum korunur; kullanıcı bilgisi ilk başarılı istekle gelir.
      const offline = (e as { isNetwork?: boolean }).isNetwork;
      set({ status: offline && (await getRefreshToken()) ? 'authed' : 'guest' });
    }
  },
  async signIn(s) {
    await saveSession(s);
    set({ user: s.user, status: 'authed' });
  },
  async signOut() {
    const refreshToken = await getRefreshToken();
    if (refreshToken) await api('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(() => undefined);
    await clearSession();
    set({ user: null, status: 'guest' });
  },
  setUser: (user) => set({ user }),
}));
