import { Database } from "bun:sqlite";
import { NotificationRepository } from "../repositories/notification.repository";
import { 
  addLocalConnection, 
  removeLocalConnection, 
  getLocalConnectionStats,
  publishToUser,
  publishToOperators,
  subscribeToUser,
  subscribeToOperators,
  getGlobalSSEStats,
  initializeSSEPubSub
} from "../redis";
import { log, logSSEEvent } from "../logging";
import type { Notification } from "../types";

const SSE_MAX_CONNECTIONS_PER_USER = 5;
const SSE_TOTAL_MAX_CONNECTIONS = 500;

export class NotificationService {
  private notificationRepo: NotificationRepository;
  private sseInitialized = false;

  constructor(db: Database) {
    this.notificationRepo = new NotificationRepository(db);
  }

  async initialize(): Promise<void> {
    if (!this.sseInitialized) {
      await initializeSSEPubSub();
      await subscribeToOperators();
      this.sseInitialized = true;
    }
  }

  getNotifications(userId: number): { items: Notification[]; unreadCount: number } {
    const items = this.notificationRepo.findByUser(userId);
    const unreadCount = this.notificationRepo.findUnreadCount(userId);
    return { items, unreadCount };
  }

  markAllRead(userId: number): void {
    this.notificationRepo.markAllRead(userId);
  }

  createForUser(userId: number, type: string, message: string, link?: string): Notification {
    return this.notificationRepo.createForUser(userId, type, message, link);
  }

  createForOperators(type: string, message: string, link?: string): void {
    this.notificationRepo.createForOperators(type, message, link);
  }

  createSSEStream(userId: number): ReadableStream {
    let controller: ReadableStreamDefaultController | null = null;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
      },
      cancel() {
        if (controller) {
          removeLocalConnection(userId, controller);
        }
      }
    });

    if (!controller) throw new Error("Failed to create stream controller");

    const added = addLocalConnection(userId, controller);
    if (!added) {
      controller.error(new Error("Too many SSE connections"));
      throw new Error("Too many SSE connections");
    }

    if (!this.sseInitialized) {
      this.initialize();
    }

    logSSEEvent("connect", userId, { totalConnections: getLocalConnectionStats().totalConnections });

    subscribeToUser(userId).catch(err => log.error({ err, userId }, "Failed to subscribe to user SSE channel"));

    const keepAlive = setInterval(() => {
      try {
        controller?.enqueue(": keepalive\n\n");
      } catch {
        clearInterval(keepAlive);
        removeLocalConnection(userId, controller!);
      }
    }, 15000);

    return stream;
  }

  async notifyUser(userId: number, eventData: { type: string; message: string; link?: string }): Promise<void> {
    const notification = this.createForUser(userId, eventData.type, eventData.message, eventData.link);

    await publishToUser(userId, eventData.type, notification);
    
    log.debug({ userId, type: eventData.type }, "Notification sent via Redis Pub/Sub");
  }

  async notifyOperators(eventData: { type: string; message: string; link?: string }): Promise<void> {
    this.createForOperators(eventData.type, eventData.message, eventData.link);

    await publishToOperators(eventData.type, { 
      type: eventData.type, 
      message: eventData.message, 
      link: eventData.link 
    });

    log.debug({ type: eventData.type }, "Operator notification sent via Redis Pub/Sub");
  }

  async getSSEStats(): Promise<{ totalConnections: number; usersConnected: number; redisConnected: boolean }> {
    return getGlobalSSEStats();
  }
}

export const notificationService = new NotificationService(null as any);