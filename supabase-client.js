/**
 * supabase-client.js — Capa de datos de FinanzasApp
 * ==================================================
 * Gestiona autenticación y CRUD de transacciones.
 * Incluye fallback automático a localStorage cuando
 * Supabase no está configurado o no hay conexión.
 */

/* ============================================================
   INICIALIZACIÓN
   ============================================================ */

/** @type {import('@supabase/supabase-js').SupabaseClient|null} */
let _supabaseClient = null;

/** @type {import('@supabase/supabase-js').Session|null} */
let _currentSession = null;

/** true si las credenciales están configuradas y el cliente fue creado */
let _isConfigured = false;

/** Clave de localStorage para caché de transacciones */
const LOCAL_TXN_KEY  = 'finanzas-transactions-v2';
/** Clave de localStorage para ID del archivo de Drive (legado, ignorado) */
const LOCAL_MODE_KEY = 'finanzas-offline-mode';

/**
 * Inicializa el cliente de Supabase.
 * Debe llamarse antes de cualquier otra función.
 * @returns {boolean} true si Supabase quedó disponible
 */
function initSupabase() {
  // Verificar que las credenciales estén configuradas
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.info('[DB] Credenciales de Supabase no configuradas → modo offline activado.');
    return false;
  }

  // Verificar que el SDK esté cargado (CDN) — el UMD puede exponerlo de dos formas
  const supabaseLib = window.supabase ?? window.Supabase ?? null;
  if (!supabaseLib || typeof supabaseLib.createClient !== 'function') {
    console.error('[DB] SDK de Supabase no cargado. Verifica la conexión a internet.');
    return false;
  }

  try {
    _supabaseClient = supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,      // Mantiene sesión entre recargas
        autoRefreshToken: true,    // Renueva tokens automáticamente
        detectSessionInUrl: true,  // Para magic links (si se habilitan)
      },
    });
    _isConfigured = true;
    console.info('[DB] Supabase inicializado correctamente.');
    return true;
  } catch (err) {
    console.error('[DB] Error al inicializar Supabase:', err.message);
    return false;
  }
}

/** @returns {boolean} Si Supabase está disponible y configurado */
function isSupabaseAvailable() {
  return _isConfigured && _supabaseClient !== null;
}

/** @returns {boolean} Si hay una sesión activa con Supabase */
function isLoggedIn() {
  return Boolean(_currentSession?.user);
}

/* ============================================================
   AUTENTICACIÓN
   ============================================================ */

/**
 * Obtiene la sesión activa actual.
 * @returns {Promise<import('@supabase/supabase-js').Session|null>}
 */
async function getSession() {
  if (!isSupabaseAvailable()) return null;
  try {
    const { data, error } = await _supabaseClient.auth.getSession();
    if (error) throw error;
    _currentSession = data?.session ?? null;
    return _currentSession;
  } catch (err) {
    console.error('[Auth] Error obteniendo sesión:', err.message);
    return null;
  }
}

/**
 * Suscribe una función callback a cambios de estado de autenticación.
 * @param {(event: string, session: object|null) => void} callback
 */
function onAuthStateChange(callback) {
  if (!isSupabaseAvailable()) return;
  _supabaseClient.auth.onAuthStateChange((event, session) => {
    _currentSession = session;
    callback(event, session);
  });
}

/**
 * Inicia sesión con email y contraseña.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object|null, error: Error|null}>}
 */
async function signIn(email, password) {
  if (!isSupabaseAvailable()) {
    return { user: null, error: new Error('Supabase no está configurado. Usa el modo offline.') };
  }
  try {
    const { data, error } = await _supabaseClient.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    _currentSession = data.session;
    return { user: data.user, error: null };
  } catch (err) {
    return { user: null, error: err };
  }
}

/**
 * Registra un nuevo usuario con email y contraseña.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object|null, error: Error|null}>}
 */
async function signUp(email, password) {
  if (!isSupabaseAvailable()) {
    return { user: null, error: new Error('Supabase no está configurado.') };
  }
  try {
    const { data, error } = await _supabaseClient.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    return { user: data.user, error: null };
  } catch (err) {
    return { user: null, error: err };
  }
}

/**
 * Cierra la sesión del usuario actual.
 * @returns {Promise<void>}
 */
async function signOut() {
  if (isSupabaseAvailable()) {
    await _supabaseClient.auth.signOut();
  }
  _currentSession = null;
}

/**
 * Devuelve el objeto de usuario de la sesión activa.
 * @returns {object|null}
 */
function getCurrentUser() {
  return _currentSession?.user ?? null;
}

/* ============================================================
   TRANSACCIONES — CRUD
   ============================================================ */

/**
 * Carga todas las transacciones del usuario.
 * Prioriza Supabase; hace fallback a localStorage si no hay sesión.
 * @returns {Promise<Array>}
 */
async function loadTransactions() {
  if (isSupabaseAvailable() && isLoggedIn()) {
    try {
      const { data, error } = await _supabaseClient
        .from('transactions')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const transactions = data ?? [];
      // Actualizar caché local (para offline/fallback)
      localStorage.setItem(LOCAL_TXN_KEY, JSON.stringify(transactions));
      return transactions;

    } catch (err) {
      console.warn('[DB] Error cargando desde Supabase, usando caché local:', err.message);
      return _loadLocalTransactions();
    }
  }

  return _loadLocalTransactions();
}

/**
 * Guarda una nueva transacción.
 * @param {{type, description, category, amount, date, note}} txnData
 * @returns {Promise<{data: object|null, error: Error|null}>}
 */
async function saveTransaction(txnData) {
  // Validación básica
  const amount = Math.abs(Math.round(Number(txnData.amount)));
  if (!amount || amount <= 0) {
    return { data: null, error: new Error('El monto debe ser mayor a 0.') };
  }

  const payload = {
    type:        txnData.type,
    description: String(txnData.description).trim().slice(0, 80),
    category:    txnData.category,
    amount,
    date:        txnData.date,
    note:        String(txnData.note ?? '').trim().slice(0, 120),
  };

  if (isSupabaseAvailable() && isLoggedIn()) {
    try {
      const { data, error } = await _supabaseClient
        .from('transactions')
        .insert([{ ...payload, user_id: getCurrentUser().id }])
        .select()
        .single();

      if (error) throw error;

      // Actualizar caché
      const local = _loadLocalTransactions();
      local.unshift(data);
      localStorage.setItem(LOCAL_TXN_KEY, JSON.stringify(local));

      return { data, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  // Modo offline: guardar en localStorage
  const newTxn = {
    id:         crypto.randomUUID(),
    ...payload,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const local = _loadLocalTransactions();
  local.unshift(newTxn);
  localStorage.setItem(LOCAL_TXN_KEY, JSON.stringify(local));
  return { data: newTxn, error: null };
}

/**
 * Actualiza una transacción existente por su ID.
 * @param {string} id - UUID de la transacción
 * @param {{type, description, category, amount, date, note}} txnData
 * @returns {Promise<{data: object|null, error: Error|null}>}
 */
async function updateTransaction(id, txnData) {
  const amount = Math.abs(Math.round(Number(txnData.amount)));
  if (!amount || amount <= 0) {
    return { data: null, error: new Error('El monto debe ser mayor a 0.') };
  }

  const payload = {
    type:        txnData.type,
    description: String(txnData.description).trim().slice(0, 80),
    category:    txnData.category,
    amount,
    date:        txnData.date,
    note:        String(txnData.note ?? '').trim().slice(0, 120),
    updated_at:  new Date().toISOString(),
  };

  if (isSupabaseAvailable() && isLoggedIn()) {
    try {
      const { data, error } = await _supabaseClient
        .from('transactions')
        .update(payload)
        .eq('id', id)
        .eq('user_id', getCurrentUser().id)
        .select()
        .single();

      if (error) throw error;

      // Actualizar caché local
      const local = _loadLocalTransactions().map(t => t.id === id ? data : t);
      localStorage.setItem(LOCAL_TXN_KEY, JSON.stringify(local));

      return { data, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  // Modo offline: actualizar en localStorage
  const local = _loadLocalTransactions();
  const idx = local.findIndex(t => t.id === id);
  if (idx === -1) return { data: null, error: new Error('Transacción no encontrada.') };

  const updated = { ...local[idx], ...payload };
  local[idx] = updated;
  localStorage.setItem(LOCAL_TXN_KEY, JSON.stringify(local));
  return { data: updated, error: null };
}

/**
 * Elimina una transacción por su ID.
 * @param {string} id - UUID de la transacción
 * @returns {Promise<{error: Error|null}>}
 */
async function deleteTransaction(id) {
  if (isSupabaseAvailable() && isLoggedIn()) {
    try {
      const { error } = await _supabaseClient
        .from('transactions')
        .delete()
        .eq('id', id)
        .eq('user_id', getCurrentUser().id); // RLS extra: solo el propietario

      if (error) throw error;
    } catch (err) {
      return { error: err };
    }
  }

  // Siempre actualizar caché local
  const local = _loadLocalTransactions().filter(t => t.id !== id);
  localStorage.setItem(LOCAL_TXN_KEY, JSON.stringify(local));
  return { error: null };
}

/**
 * Importa las transacciones almacenadas localmente a Supabase.
 * Útil cuando el usuario se registra/inicia sesión después de usar offline.
 * @returns {Promise<{count: number, error: Error|null}>}
 */
async function importLocalToSupabase() {
  if (!isSupabaseAvailable() || !isLoggedIn()) {
    return { count: 0, error: new Error('No hay sesión activa de Supabase.') };
  }

  const local = _loadLocalTransactions();
  if (!local.length) return { count: 0, error: null };

  const userId = getCurrentUser().id;
  const payload = local.map(({ id, created_at, updated_at, ...rest }) => ({
    ...rest,
    user_id: userId,
    amount:  Math.abs(Math.round(Number(rest.amount))),
    note:    rest.note ?? '',
  }));

  try {
    const { data, error } = await _supabaseClient
      .from('transactions')
      .insert(payload)
      .select();

    if (error) throw error;

    // Limpiar localStorage (ya está en la nube)
    localStorage.removeItem(LOCAL_TXN_KEY);
    return { count: data?.length ?? 0, error: null };
  } catch (err) {
    return { count: 0, error: err };
  }
}

/* ============================================================
   HELPERS PRIVADOS
   ============================================================ */

/**
 * Lee transacciones desde localStorage.
 * @returns {Array}
 */
function _loadLocalTransactions() {
  try {
    const raw = localStorage.getItem(LOCAL_TXN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
