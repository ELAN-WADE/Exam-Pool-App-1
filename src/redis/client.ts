import Redis from "ioredis";
import { config } from "../config";

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  maxRetriesPerRequest: number;
  retryStrategy?: (times: number) => number | null;
  enableReadyCheck: boolean;
  lazyConnect: boolean;
}

let redisClient: Redis | null = null;
let isShuttingDown = false;

export function createRedisClient(customConfig?: Partial<RedisConfig>): Redis {
  const env = config.env;
  
  const defaultConfig: RedisConfig = {
    host: env.REDIS_HOST || "127.0.0.1",
    port: parseInt(env.REDIS_PORT || "6379", 10),
    password: env.REDIS_PASSWORD,
    db: parseInt(env.REDIS_DB || "0", 10),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: (times: number) => {
      if (times > 10) return null;
      return Math.min(times * 100, 3000);
    },
  };

  const finalConfig = { ...defaultConfig, ...customConfig };
  
  const client = new Redis(finalConfig);
  
  client.on("connect", () => {
    console.log("[Redis] Connected");
  });
  
  client.on("ready", () => {
    console.log("[Redis] Ready");
  });
  
  client.on("error", (err) => {
    console.error("[Redis] Error:", err.message);
  });
  
  client.on("close", () => {
    console.warn("[Redis] Connection closed");
  });
  
  client.on("reconnecting", () => {
    console.log("[Redis] Reconnecting...");
  });

  return client;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedisClient();
  if (client.status === "wait") {
    await client.connect();
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  isShuttingDown = true;
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export function isRedisConnected(): boolean {
  return redisClient?.status === "ready";
}

export function getRedisStatus(): string {
  return redisClient?.status || "disconnected";
}

export interface RedisHealthCheck {
  status: "healthy" | "degraded" | "unhealthy";
  latency?: number;
  details: string;
}

export async function checkRedisHealth(): Promise<RedisHealthCheck> {
  const client = getRedisClient();
  
  if (client.status !== "ready") {
    return {
      status: "unhealthy",
      details: `Redis client status: ${client.status}`
    };
  }

  const start = Date.now();
  try {
    await client.ping();
    const latency = Date.now() - start;
    
    if (latency > 100) {
      return {
        status: "degraded",
        latency,
        details: `Redis ping took ${latency}ms`
      };
    }
    
    return {
      status: "healthy",
      latency,
      details: "Redis responding normally"
    };
  } catch (error) {
    return {
      status: "unhealthy",
      details: `Redis ping failed: ${error instanceof Error ? error.message : "unknown"}`
    };
  }
}