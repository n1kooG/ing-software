import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, alPerderSesion, token } from './api.js';

const Ctx = createContext(null);
export const useSesion = () => useContext(Ctx);

// Pantalla inicial por rol (la autorización real siempre se valida en el backend).
export const HOME = { ADMINISTRADOR: '/dashboard', BODEGA: '/bodega', CHOFER: '/ruta' };

export function SesionProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(!!token.get());
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    alPerderSesion((codigo) => {
      token.clear();
      setUsuario(null);
      setAviso(codigo === 'SESION_EXPIRADA' ? 'Tu sesión expiró. Ingresa nuevamente.' : 'Tu sesión no es válida. Ingresa nuevamente.');
    });
    if (!token.get()) return;
    api('/auth/me').then(({ data }) => setUsuario(data)).catch(() => token.clear()).finally(() => setCargando(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api('/auth/login', { metodo: 'POST', cuerpo: { email, password }, publica: true });
    token.set(data.token);
    setAviso('');
    setUsuario(data.usuario);
    return data.usuario;
  }, []);

  const logout = useCallback(() => { token.clear(); setAviso(''); setUsuario(null); }, []);
  const puede = useCallback((permiso) => !!usuario?.permisos?.includes(permiso), [usuario]);

  return <Ctx.Provider value={{ usuario, cargando, aviso, login, logout, puede }}>{children}</Ctx.Provider>;
}
