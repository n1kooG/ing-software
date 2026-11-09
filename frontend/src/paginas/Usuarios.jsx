import { useCallback, useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, Modal, Tabla, useAviso } from '../componentes/ui.jsx';
import { ROL } from '../componentes/Layouts.jsx';
import { useSesion } from '../sesion.jsx';

const ROLES = Object.entries(ROL);

export default function Usuarios() {
  const { usuario: yo } = useSesion();
  const avisar = useAviso();
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [dlg, setDlg] = useState(null); // { tipo: 'crear' | 'rol' | 'baja' | 'reactivar', u? }

  const cargar = useCallback(async () => {
    try { setLista((await api('/usuarios')).data.sort((a, b) => a.id_usuario - b.id_usuario)); setError(''); }
    catch (e) { setError(mensajeError(e)); } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const cerrar = useCallback(() => setDlg(null), []);
  const hecho = (texto) => { avisar(texto); cargar(); cerrar(); };

  return (
    <>
      <div className="cabecera">
        <div>
          <h1>Administración de Usuarios y Roles</h1>
          <p>Gestión de accesos y restricción estricta de costos y márgenes al personal operativo.</p>
        </div>
        <Boton variante="primario" icono="plus" onClick={() => setDlg({ tipo: 'crear' })}>Crear usuario</Boton>
      </div>
      <Alerta>{error}</Alerta>
      <Tabla columnas={['Nombre', 'Correo electrónico', 'Rol asignado', 'Acceso a márgenes y costos', 'Estado', 'Acciones']} vacio={cargando ? 'Cargando…' : null}>
        {lista.map((u) => (
          <tr key={u.id_usuario}>
            <td>{u.nombre_completo}<div className="dato celda-sec">{u.rut}</div></td>
            <td>{u.email}</td>
            <td><Badge tono={u.rol === 'ADMINISTRADOR' ? 'ink' : ''}>{ROL[u.rol] ?? u.rol}</Badge></td>
            <td><Badge tono={u.acceso_costos ? 'ok' : 'mal'}>{u.acceso_costos ? 'Permitido (total)' : 'Bloqueado / oculto'}</Badge></td>
            <td><Badge tono={u.activo ? 'ok' : 'mal'}>{u.activo ? 'Activo' : 'Baja'}</Badge></td>
            <td>
              <Boton variante="enlace" onClick={() => setDlg({ tipo: 'rol', u })}>Cambiar rol</Boton>{' '}
              {u.id_usuario === yo.id ? <span className="tenue">Cuenta propia</span>
                : u.activo ? <Boton variante="enlace" onClick={() => setDlg({ tipo: 'baja', u })}>Dar de baja</Boton>
                : <Boton variante="enlace" onClick={() => setDlg({ tipo: 'reactivar', u })}>Reactivar</Boton>}
            </td>
          </tr>
        ))}
      </Tabla>
      <p className="tenue" style={{ marginTop: 20 }}>La baja impide el ingreso de la cuenta sin borrar su historial. No se puede dar de baja a la propia cuenta ni al último administrador.</p>

      {dlg?.tipo === 'crear' && <Crear onClose={cerrar} onHecho={() => hecho('Usuario creado')} />}
      {dlg?.tipo === 'rol' && <CambiarRol u={dlg.u} onClose={cerrar} onHecho={() => hecho('Rol actualizado')} />}
      {(dlg?.tipo === 'baja' || dlg?.tipo === 'reactivar') && <Estado tipo={dlg.tipo} u={dlg.u} onClose={cerrar} onHecho={() => hecho(dlg.tipo === 'baja' ? 'Usuario dado de baja' : 'Usuario reactivado')} />}
    </>
  );
}

function Crear({ onClose, onHecho }) {
  const [f, setF] = useState({ rut: '', nombre_completo: '', email: '', rol: '', password: '' });
  const [err, setErr] = useState({});
  const [alerta, setAlerta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr({ ...err, [k]: undefined }); };

  async function enviar(ev) {
    ev.preventDefault();
    setAlerta('');
    const e = {};
    for (const k of Object.keys(f)) if (!f[k].trim()) e[k] = k === 'rol' ? 'Selecciona un rol' : 'Campo obligatorio';
    if (!e.password && f.password.length < 8) e.password = 'Mínimo 8 caracteres';
    setErr(e);
    if (Object.keys(e).length) return;
    setEnviando(true);
    try { await api('/usuarios', { metodo: 'POST', cuerpo: f }); onHecho(); }
    catch (x) { x.codigo === 'DUPLICADO' && /correo/.test(x.message) ? setErr({ email: x.message }) : setAlerta(mensajeError(x)); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo="Crear usuario" subtitulo="Se guardará en el registro de auditoría." onClose={onClose}
      pie={<><Boton onClick={onClose}>Cancelar</Boton><Boton variante="primario" type="submit" form="form-usuario" disabled={enviando}>Crear usuario</Boton></>}>
      <form id="form-usuario" onSubmit={enviar} noValidate>
        <Alerta>{alerta}</Alerta>
        <Campo etiqueta="RUT" placeholder="Ej. 11.111.111-1" value={f.rut} onChange={set('rut')} error={err.rut} />
        <Campo etiqueta="Nombre completo" placeholder="Nombre y apellido" value={f.nombre_completo} onChange={set('nombre_completo')} error={err.nombre_completo} />
        <Campo etiqueta="Correo electrónico" type="email" placeholder="nombre@tiendaoregon.cl" value={f.email} onChange={set('email')} error={err.email} />
        <Campo etiqueta="Rol" como="select" value={f.rol} onChange={set('rol')} error={err.rol}>
          <option value="">Seleccione un rol</option>
          {ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </Campo>
        <Campo etiqueta="Contraseña inicial" type="password" autoComplete="new-password" placeholder="Ingrese la contraseña inicial" value={f.password} onChange={set('password')} error={err.password} />
      </form>
    </Modal>
  );
}

function CambiarRol({ u, onClose, onHecho }) {
  const [rol, setRol] = useState(u.rol);
  const [alerta, setAlerta] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function enviar(ev) {
    ev.preventDefault();
    setEnviando(true);
    try { await api(`/usuarios/${u.id_usuario}/rol`, { metodo: 'PATCH', cuerpo: { rol } }); onHecho(); }
    catch (x) { setAlerta(mensajeError(x)); } finally { setEnviando(false); }
  }
  return (
    <Modal chico titulo="Cambiar rol" subtitulo={`Cuenta de ${u.nombre_completo}`} onClose={onClose}
      pie={<><Boton onClick={onClose}>Cancelar</Boton><Boton variante="primario" type="submit" form="form-rol" disabled={enviando}>Guardar</Boton></>}>
      <form id="form-rol" onSubmit={enviar}>
        <Alerta>{alerta}</Alerta>
        <Campo etiqueta="Rol" como="select" value={rol} onChange={(e) => setRol(e.target.value)}>
          {ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </Campo>
      </form>
    </Modal>
  );
}

function Estado({ tipo, u, onClose, onHecho }) {
  const baja = tipo === 'baja';
  const [alerta, setAlerta] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    setEnviando(true);
    try { await api(`/usuarios/${u.id_usuario}/${baja ? 'baja' : 'reactivar'}`, { metodo: 'POST' }); onHecho(); }
    catch (x) { setAlerta(mensajeError(x)); } finally { setEnviando(false); }
  }
  return (
    <Modal chico titulo={baja ? 'Dar de baja' : 'Reactivar cuenta'} onClose={onClose}
      subtitulo={baja ? `La cuenta de ${u.nombre_completo} dejará de poder iniciar sesión.` : `La cuenta de ${u.nombre_completo} podrá volver a iniciar sesión.`}
      pie={<><Boton onClick={onClose}>Cancelar</Boton><Boton variante={baja ? 'peligro' : 'primario'} onClick={confirmar} disabled={enviando}>{baja ? 'Dar de baja' : 'Reactivar'}</Boton></>}>
      <Alerta>{alerta}</Alerta>
      <p>{baja ? 'El historial de la cuenta se conserva y se registra la baja en la bitácora de auditoría. Podrás reactivarla después.' : 'La reactivación se registra en la bitácora de auditoría.'}</p>
    </Modal>
  );
}
