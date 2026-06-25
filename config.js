/**
 * config.js — Configuración de Supabase para FinanzasApp
 * =====================================================
 *
 * INSTRUCCIONES DE CONFIGURACIÓN:
 * ================================
 * 1. Crea una cuenta gratuita en https://supabase.com
 * 2. Crea un nuevo proyecto
 * 3. Ve a Settings → API
 * 4. Copia la "Project URL" y la "anon public key"
 * 5. Pégalas en las variables SUPABASE_URL y SUPABASE_ANON_KEY abajo
 *
 * Si dejas las claves vacías, la app funciona en modo OFFLINE
 * usando localStorage (sin sincronización en la nube).
 *
 * =====================================================
 * SETUP DE BASE DE DATOS (ejecutar en Supabase SQL Editor)
 * =====================================================
 *
 * -- Tabla principal de transacciones
 * CREATE TABLE transactions (
 *   id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id     UUID        REFERENCES auth.users NOT NULL,
 *   type        TEXT        NOT NULL CHECK (type IN ('income','expense')),
 *   description TEXT        NOT NULL,
 *   category    TEXT        NOT NULL,
 *   amount      INTEGER     NOT NULL CHECK (amount > 0),
 *   date        DATE        NOT NULL,
 *   note        TEXT        DEFAULT '',
 *   created_at  TIMESTAMPTZ DEFAULT now(),
 *   updated_at  TIMESTAMPTZ DEFAULT now()
 * );
 *
 * -- Índices para consultas eficientes
 * CREATE INDEX idx_transactions_user_date ON transactions(user_id, date DESC);
 * CREATE INDEX idx_transactions_user_type ON transactions(user_id, type);
 *
 * -- Habilitar Row Level Security (RLS) - cada usuario solo ve SUS datos
 * ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
 *
 * -- Política de seguridad: CRUD completo solo para el propietario
 * CREATE POLICY "Usuarios solo acceden a sus propias transacciones"
 *   ON transactions
 *   FOR ALL
 *   USING      (auth.uid() = user_id)
 *   WITH CHECK (auth.uid() = user_id);
 *
 * -- Trigger para actualizar updated_at automáticamente
 * CREATE OR REPLACE FUNCTION update_updated_at()
 * RETURNS TRIGGER LANGUAGE plpgsql AS $$
 * BEGIN
 *   NEW.updated_at = now();
 *   RETURN NEW;
 * END;
 * $$;
 *
 * CREATE TRIGGER trg_transactions_updated_at
 *   BEFORE UPDATE ON transactions
 *   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
 * =====================================================
 */

// ▼ EDITAR ESTAS DOS LÍNEAS CON TUS CREDENCIALES ▼
const SUPABASE_URL      = '';  // Ej: 'https://abcxyz123.supabase.co'
const SUPABASE_ANON_KEY = '';  // Ej: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
// ▲ EDITAR ESTAS DOS LÍNEAS CON TUS CREDENCIALES ▲
