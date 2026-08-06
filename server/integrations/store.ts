import { one, query } from '../db.js';
import { open, randomId, seal } from '../crypto.js';
import { PUBLIC_BASE_URL } from '../baseUrl.js';

export type Kind = 'telegram' | 'slack' | 'discord';
export const KINDS: Kind[] = ['telegram', 'slack', 'discord'];

/** What each provider needs us to hold. Never leaves the server. */
export interface Secrets {
  telegram: { botToken: string; webhookSecret: string };
  slack: { signingSecret: string };
  discord: { publicKey: string; botToken: string };
}

export interface IntegrationRow {
  id: string;
  board_id: string;
  kind: Kind;
  enabled: boolean;
  secret_ciphertext: Buffer | null;
  secret_nonce: Buffer | null;
  secret_tag: Buffer | null;
  webhook_path_id: string | null;
  external_id: string | null;
  channel_filter: string | null;
  status: string;
  status_detail: string | null;
  last_event_at: Date | null;
}

const COLUMNS = `id, board_id, kind, enabled, secret_ciphertext, secret_nonce, secret_tag,
  webhook_path_id, external_id, channel_filter, status, status_detail, last_event_at`;

/** AAD ties a ciphertext to this exact row, so it can't be relocated. */
const aadFor = (row: { id: string; kind: string }) => `${row.id}:${row.kind}`;

export function webhookUrl(kind: Kind, pathId: string): string {
  return `${PUBLIC_BASE_URL}/hooks/${kind}/${pathId}`;
}

export function listForBoard(boardId: string) {
  return query<IntegrationRow>(
    `select ${COLUMNS} from board_integrations where board_id = $1`,
    [boardId],
  ).then((r) => r.rows);
}

export function getByPathId(kind: Kind, pathId: string) {
  return one<IntegrationRow>(
    `select ${COLUMNS} from board_integrations where kind = $1 and webhook_path_id = $2`,
    [kind, pathId],
  );
}

/** Create the row if absent so it always has an id (needed for the AAD). */
export async function ensure(boardId: string, kind: Kind): Promise<IntegrationRow> {
  const existing = await one<IntegrationRow>(
    `select ${COLUMNS} from board_integrations where board_id = $1 and kind = $2`,
    [boardId, kind],
  );
  if (existing) return existing;
  const created = await one<IntegrationRow>(
    `insert into board_integrations (board_id, kind, webhook_path_id)
          values ($1, $2, $3)
       returning ${COLUMNS}`,
    [boardId, kind, randomId()],
  );
  return created!;
}

export function readSecrets<K extends Kind>(row: IntegrationRow): Secrets[K] | null {
  if (!row.secret_ciphertext || !row.secret_nonce || !row.secret_tag) return null;
  try {
    return open<Secrets[K]>(
      { ciphertext: row.secret_ciphertext, nonce: row.secret_nonce, tag: row.secret_tag },
      aadFor(row),
    );
  } catch (err) {
    // A decrypt failure means TOKEN_ENC_KEY changed under us; say so plainly
    // rather than looking like an invalid token.
    console.error(`[integrations] could not decrypt ${row.kind} secrets:`, (err as Error).message);
    return null;
  }
}

export async function writeSecrets(
  row: IntegrationRow,
  secrets: Secrets[Kind],
  patch: {
    enabled?: boolean;
    externalId?: string | null;
    channelFilter?: string | null;
    status?: string;
    statusDetail?: string | null;
  } = {},
): Promise<void> {
  const sealed = seal(secrets, aadFor(row));
  await query(
    `update board_integrations
        set secret_ciphertext = $2, secret_nonce = $3, secret_tag = $4, key_version = $5,
            enabled = coalesce($6, enabled),
            external_id = coalesce($7, external_id),
            channel_filter = $8,
            status = coalesce($9, status),
            status_detail = $10,
            updated_at = now()
      where id = $1`,
    [
      row.id,
      sealed.ciphertext,
      sealed.nonce,
      sealed.tag,
      sealed.keyVersion,
      patch.enabled ?? null,
      patch.externalId ?? null,
      patch.channelFilter ?? null,
      patch.status ?? null,
      patch.statusDetail ?? null,
    ],
  );
}

export async function setStatus(
  id: string,
  status: string,
  detail: string | null = null,
): Promise<void> {
  await query(
    `update board_integrations set status = $2, status_detail = $3, updated_at = now()
      where id = $1`,
    [id, status, detail],
  );
}

export async function markEvent(id: string): Promise<void> {
  await query('update board_integrations set last_event_at = now() where id = $1', [id]);
}

export async function remove(boardId: string, kind: Kind): Promise<IntegrationRow | null> {
  return one<IntegrationRow>(
    `delete from board_integrations where board_id = $1 and kind = $2 returning ${COLUMNS}`,
    [boardId, kind],
  );
}

/**
 * Safe view for the client: whether it is configured and working, plus the URL
 * the user needs to paste. Never the credentials themselves — there is no
 * "masked value" round-trip to get wrong.
 */
export function publicView(row: IntegrationRow) {
  return {
    kind: row.kind,
    enabled: row.enabled,
    configured: !!row.secret_ciphertext,
    status: row.status,
    statusDetail: row.status_detail,
    channelFilter: row.channel_filter,
    externalId: row.external_id,
    lastEventAt: row.last_event_at,
    webhookUrl: row.webhook_path_id ? webhookUrl(row.kind, row.webhook_path_id) : null,
  };
}
