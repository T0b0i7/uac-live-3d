/**
 * Service de notifications — apps/server/src/modules/notifications/notifications.service.ts
 *
 * Les notifications sont persistées (source de vérité) puis diffusées en temps
 * réel sur la room privée de l'utilisateur. La diffusion est un confort : si le
 * socket est absent, la notification reste consultable via `GET /api/v1/notifications`.
 *
 * Règle : jamais de contenu sensible dans une notification. Pas de coordonnées,
 * pas de matricule complet — seulement des libellés et un lien interne.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@uac/database";
import { notifications } from "@uac/database";
import { AuthorizationError, type NotificationType } from "@uac/shared";
import type { Notification } from "@uac/contracts";

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export class NotificationsService {
  constructor(private readonly db: Database) {}

  /** Persiste une notification et renvoie son DTO (à diffuser ensuite). */
  async notify(input: NotifyInput): Promise<Notification> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        actionUrl: input.actionUrl ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      })
      .returning();

    return toDto(row!);
  }

  /** Diffuse à plusieurs destinataires ; renvoie les notifications créées. */
  async notifyMany(userIds: string[], input: Omit<NotifyInput, "userId">): Promise<Notification[]> {
    const created: Notification[] = [];
    for (const userId of userIds) {
      created.push(await this.notify({ ...input, userId }));
    }
    return created;
  }

  async list(
    userId: string,
    options: { page: number; limit: number; unreadOnly: boolean; type?: NotificationType },
  ): Promise<{ items: Notification[]; total: number }> {
    const conditions = [eq(notifications.userId, userId)];
    if (options.unreadOnly) conditions.push(eq(notifications.read, false));
    if (options.type) conditions.push(eq(notifications.type, options.type));

    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      // Tri en base sur (created_at DESC) : index notifications_user_idx le couvre,
      // aucun index composite supplémentaire n'est nécessaire.
      .orderBy(desc(notifications.createdAt))
      .limit(options.limit)
      .offset((options.page - 1) * options.limit);

    const counted = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(...conditions));

    return { items: rows.map(toDto), total: counted[0]?.c ?? 0 };
  }

  async unreadCount(userId: string): Promise<number> {
    const rows = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
    return rows[0]?.c ?? 0;
  }

  /** Marque une notification comme lue — uniquement la sienne. */
  async markRead(notificationId: string, userId: string): Promise<void> {
    const rows = await this.db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1);

    const row = rows[0];
    if (!row) return;
    if (row.userId !== userId) {
      // On ne révèle pas l'existence de la notification d'autrui.
      throw new AuthorizationError("Cette notification ne vous appartient pas.");
    }

    await this.db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(eq(notifications.id, notificationId));
  }

  async markAllRead(userId: string): Promise<number> {
    const updated = await this.db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
      .returning({ id: notifications.id });
    return updated.length;
  }
}

function toDto(row: typeof notifications.$inferSelect): Notification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    read: row.read,
    actionUrl: row.actionUrl,
    createdAt: row.createdAt.toISOString(),
  };
}
