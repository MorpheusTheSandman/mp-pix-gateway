# API Mercado Pago (Pix e Cartao)

Sistema gratuito para iniciantes. API enxuta para criacao de cobrancas, pagamento via Pix/cartao,
reembolso e webhooks do Mercado Pago.

## Requisitos

- Node.js >= 18
- PostgreSQL

## Instalacao

```
npm install
```

## Configuracao

1) Copie o arquivo de exemplo

```
copy .env.example .env
```

2) Preencha o `.env`

```
PORT=3000
DATABASE_URL=
MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_WEBHOOK_SECRET=
MP_BASE_URL=https://api.mercadopago.com
MP_PAYMENT_ENDPOINT=/v1/payments
PUBLIC_BASE_URL=
PUBLIC_APP_URL=
MP_WEBHOOK_PATH_SECRET=
```

## Banco de dados

Execute o SQL abaixo para criar as tabelas:

```
psql "$env:DATABASE_URL" -f .\sql\001_init.sql
```

## Rodar a API

```
npm run dev
```

A API inicia em `http://localhost:3000`.

## Endpoints

### Config

- `GET /api/config`
  - Retorna `mpPublicKey` para uso no front-end.

### Cobrancas

- `POST /api/charges`
  - Cria uma cobranca.
  - Body:
    - `amount` (numero, obrigatorio)
    - `description` (string, opcional)
    - `due_at` (ISO datetime, opcional)
    - `expires_at` (ISO datetime, opcional)
    - `public_expires_at` (ISO datetime, opcional)
    - `customer` (opcional)
      - `name` (string, obrigatorio se enviar `customer`)
      - `docNumber` (string, obrigatorio se enviar `customer`)
      - `docType` (CPF/CNPJ, opcional)
      - `email` (string, opcional)
      - `phone` (string, opcional)

- `GET /api/charges`
  - Lista cobrancas (ultimas 200).

- `GET /api/charges/:id`
  - Detalhe da cobranca.

### Pagamentos

- `POST /api/charges/:id/pay/pix`
  - Gera pagamento Pix.

- `POST /api/charges/:id/pay/card`
  - Gera pagamento com cartao.
  - Body: payload do Mercado Pago (token, payment_method_id, installments, etc.).

### Reembolsos

- `POST /api/charges/:id/refund`
  - Reembolso total ou parcial.
  - Body opcional: `{ "amount": 10.50 }`

- `GET /api/charges/:id/refunds`
  - Lista reembolsos da cobranca.

- `GET /api/refunds`
  - Lista ultimos reembolsos.

### Checkout publico

- `GET /api/public/charges/:token`
  - Consulta cobranca publica.

- `POST /api/public/charges/:token/pay/pix`
  - Pagamento Pix via link publico.

- `POST /api/public/charges/:token/pay/card`
  - Pagamento cartao via link publico.

### Webhooks Mercado Pago

- `POST /api/v1/webhooks/mercadopago/:secret`
  - Endpoint de webhook.
  - Configure `MP_WEBHOOK_PATH_SECRET` e `MP_WEBHOOK_SECRET`.

## Exemplos

Criar cobranca:

```
curl -X POST http://localhost:3000/api/charges \
  -H "Content-Type: application/json" \
  -d "{\"amount\": 19.9, \"description\": \"Pedido 123\", \"customer\": {\"name\": \"Joao\", \"docNumber\": \"12345678900\"}}"
```

Pagar Pix:

```
curl -X POST http://localhost:3000/api/charges/{chargeId}/pay/pix
```

## Observacoes

- Esta API nao possui autenticacao. Se for expor em producao, proteja os endpoints.
- Preencha `PUBLIC_BASE_URL` e `PUBLIC_APP_URL` para gerar links publicos e webhook corretamente.

## Termos de responsabilidade e isencao

Este projeto e fornecido "como esta", sem garantias de qualquer tipo. O uso e por sua conta e risco.
Nao nos responsabilizamos por perdas financeiras, indisponibilidades, falhas de integracao, ou
quaisquer danos diretos ou indiretos decorrentes do uso desta API. Voce e o unico responsavel por
configurar, testar, validar e manter o ambiente, inclusive chaves do Mercado Pago e dados de clientes.
