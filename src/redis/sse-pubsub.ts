import { getRedisClient, connectRedis } from "./client";

export interface SSEMessage {
  userId: number;
  type: string;
  payload: any;
  timestamp: number;
}

export interface SSEConnection {
  userId: number;
  controller: ReadableStreamDefaultController;
  connectedAt: number;
}

const CHANNEL_PREFIX = "exampool:sse";
const MAX_CONNECTIONS_PER_USER = 5;
const MAX_TOTAL_CONNECTIONS = 500;

let subscriber: ReturnType<typeof getRedisClient> | null = null;
let publisher: ReturnType<typeof getRedisClient> | null = null;
let isInitialized = false;

export async function initializeSSEPubSub(): Promise<void> {
  if (isInitialized) return;
  
  publisher = getRedisClient();
  subscriber = publisher.duplicate();
  
  await connectRedis();
  
  subscriber.on("message", (channel, message) => {
    try {
      const data: SSEMessage = JSON.parse(message);
      localMessageHandler(data);
    } catch (error) {
      console.error("[SSE PubSub] Error parsing message:", error);
    }
  });
  
  isInitialized = true;
  console.log("[SSE PubSub] Initialized");
}

const localConnections = new Map<number, Set<ReadableStreamDefaultController>>();

function localMessageHandler(message: SSEMessage): void {
  const userConnections = localConnections.get(message.userId);
  if (!userConnections || userConnections.size === 0) return;

  const payload = `data: ${JSON.stringify(message.payload)}\n\n`;
  
  for (const controller of userConnections) {
    try {
      controller.enqueue(payload);
    } catch {
      // Controller might be closed
    }
  }
}

export function addLocalConnection(userId: number, controller: ReadableStreamDefaultController): boolean {
  let userConnections = localConnections.get(userId);
  if (!userConnections) {
    userConnections = new Set();
    localConnections.set(userId, userConnections);
  }

  if (userConnections.size >= MAX_CONNECTIONS_PER_USER) {
    const oldest = userConnections.values().next().value;
    if (oldest) {
      try { oldest.close(); } catch {}
      userConnections.delete(oldest);
    }
  }

  const totalConnections = getTotalLocalConnections();
  if (totalConnections >= MAX_TOTAL_CONNECTIONS) {
    return false;
  }

  userConnections.add(controller);
  return true;
}

export function removeLocalConnection(userId: number, controller: ReadableStreamDefaultController): void {
  const userConnections = localConnections.get(userId);
  if (userConnections) {
    userConnections.delete(controller);
    if (userConnections.size === 0) {
      localConnections.delete(userId);
    }
  }
}

export function getTotalLocalConnections(): number {
  let total = 0;
  for (const connections of localConnections.values()) {
    total += connections.size;
  }
  return total;
}

export function getLocalConnectionStats(): { totalConnections: number; usersConnected: number } {
  return {
    totalConnections: getTotalLocalConnections(),
    usersConnected: localConnections.size,
  };
}

export async function publishSSEMessage(message: SSEMessage): Promise<void> {
  if (!publisher) {
    await initializeSSEPubSub();
  }
  
  const channel = `${CHANNEL_PREFIX}:${message.userId}`;
  try {
    await publisher!.publish(channel, JSON.stringify(message));
  } catch (error) {
    console.error("[SSE PubSub] Error publishing:", error);
  }
}

export async function publishToUser(userId: number, type: string, payload: any): Promise<void> {
  const message: SSEMessage = {
    userId,
    type,
    payload,
    timestamp: Date.now(),
  };
  await publishSSEMessage(message);
}

export async function publishToOperators(type: string, payload: any): Promise<void> {
  if (!publisher) {
    await initializeSSEPubSub();
  }
  
  const channel = `${CHANNEL_PREFIX}:operators`;
  const message: SSEMessage = {
    userId: 0,
    type,
    payload,
    timestamp: Date.now(),
  };
  
  try {
    await publisher!.publish(channel, JSON.stringify(message));
  } catch (error) {
    console.error("[SSE PubSub] Error publishing to operators:", error);
  }
}

export async function subscribeToUser(userId: number): Promise<void> {
  if (!subscriber) {
    await initializeSSEPubSub();
  }
  
  const channel = `${CHANNEL_PREFIX}:${userId}`;
  try {
    await subscriber!.subscribe(channel);
  } catch (error) {
    console.error("[SSE PubSub] Error subscribing:", error);
  }
}

export async function subscribeToOperators(): Promise<void> {
  if (!subscriber) {
    await initializeSSEPubSub();
  }
  
  const channel = `${CHANNEL_PREFIX}:operators`;
  try {
    await subscriber!.subscribe(channel);
  } catch (error) {
    console.error("[SSE PubSub] Error subscribing to operators:", error);
  }
}

export async function unsubscribeFromUser(userId: number): Promise<void> {
  if (!subscriber) return;
  
  const channel = `${CHANNEL_PREFIX}:${userId}`;
  try {
    await subscriber!.unsubscribe(channel);
  } catch (error) {
    console.error("[SSE PubSub] Error unsubscribing:", error);
  }
}

export async function getGlobalSSEStats(): Promise<{
  totalLocalConnections: number;
  localUsersConnected: number;
  redisConnected: boolean;
}> {
  const { totalConnections, usersConnected } = getLocalConnectionStats();
  
  return {
    totalLocalConnections: totalConnections,
    localUsersConnected: usersConnected,
    redisConnected: publisher?.status === "ready" && subscriber?.status === "ready",
  };
}

export async function shutdownSSEPubSub(): Promise<void> {
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
  if (publisher && publisher !== subscriber) {
    await publisher.quit();
    publisher = null;
  }
  localConnections.clear();
  isInitialized = false;
}