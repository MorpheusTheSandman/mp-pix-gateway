CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('PF', 'PJ')),
  name text NOT NULL,
  cpf_cnpj text NOT NULL,
  address text,
  contact text,
  email text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS charges (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES customers(id),
  amount numeric NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'CANCELED')),
  due_at timestamptz,
  expires_at timestamptz,
  public_token text,
  public_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS charges_public_token_idx
  ON charges(public_token)
  WHERE public_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY,
  charge_id uuid REFERENCES charges(id),
  provider text NOT NULL,
  provider_order_id text,
  provider_payment_id text,
  method text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  qr_code text,
  qr_code_base64 text,
  copy_paste text,
  raw_payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_payment_id_idx
  ON payment_transactions(provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  event_type text,
  external_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'received'
);
