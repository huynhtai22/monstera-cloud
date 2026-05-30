/**
 * Stateful Redis-backed Circuit Breaker
 * Monitors external API health (Meta, Google, Shopee, Lazada, TikTok)
 * Trips state to OPEN on failure thresholds to protect system resources.
 */

import { getRedis } from "./redis";
import { logger } from "@/lib/logger";

const CB_STATE_PREFIX = "cb:state:";
const CB_FAILURES_PREFIX = "cb:failures:";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreakerError extends Error {
  constructor(public serviceName: string) {
    super(`Circuit breaker is OPEN for service: ${serviceName}. Blocking requests.`);
    this.name = "CircuitBreakerError";
  }
}

export class CircuitBreaker {
  private redis = getRedis();
  private resetTimeoutMs = 300000; // 5 minutes standard trip time
  private failureThreshold = 5; // Trip after 5 failures

  constructor(
    private serviceName: string,
    options?: { failureThreshold?: number; resetTimeoutMs?: number }
  ) {
    if (options?.failureThreshold) this.failureThreshold = options.failureThreshold;
    if (options?.resetTimeoutMs) this.resetTimeoutMs = options.resetTimeoutMs;
  }

  private getStateKey(): string {
    return `${CB_STATE_PREFIX}${this.serviceName}`;
  }

  private getFailuresKey(): string {
    return `${CB_FAILURES_PREFIX}${this.serviceName}`;
  }

  /**
   * Get the current state of the circuit breaker
   */
  public async getState(): Promise<CircuitState> {
    try {
      const state = await this.redis.get(this.getStateKey());
      return (state as CircuitState) || "CLOSED";
    } catch (err) {
      logger.error(`[CircuitBreaker] Failed to fetch state for ${this.serviceName}`, err);
      return "CLOSED"; // Fallback to safe closed state
    }
  }

  /**
   * Check if requests are allowed to proceed
   */
  public async checkCall(): Promise<void> {
    const state = await this.getState();

    if (state === "OPEN") {
      logger.warn(`[CircuitBreaker] [${this.serviceName.toUpperCase()}] Request blocked (Circuit is OPEN)`);
      throw new CircuitBreakerError(this.serviceName);
    }
  }

  /**
   * Record a successful operation - resets failure metrics
   */
  public async recordSuccess(): Promise<void> {
    const state = await this.getState();

    if (state !== "CLOSED") {
      logger.info(`[CircuitBreaker] [${this.serviceName.toUpperCase()}] Recovery detected. Circuit is now CLOSED.`);
      await this.redis.set(this.getStateKey(), "CLOSED");
    }

    await this.redis.del(this.getFailuresKey());
  }

  /**
   * Record a failed operation - increments failures and trips if threshold met
   */
  public async recordFailure(error: any): Promise<void> {
    const failuresKey = this.getFailuresKey();
    const stateKey = this.getStateKey();

    try {
      const currentFailures = await this.redis.get(failuresKey);
      const newFailures = (currentFailures ? parseInt(currentFailures, 10) : 0) + 1;

      await this.redis.set(failuresKey, String(newFailures), { ex: 3600 }); // Keep metrics for 1 hour

      logger.warn(
        `[CircuitBreaker] [${this.serviceName.toUpperCase()}] Recorded failure (${newFailures}/${this.failureThreshold}). Error: ${error instanceof Error ? error.message : String(error)}`
      );

      if (newFailures >= this.failureThreshold) {
        logger.error(`[CircuitBreaker] [${this.serviceName.toUpperCase()}] Tripped! Circuit is now OPEN for ${this.resetTimeoutMs}ms`);
        await this.redis.set(stateKey, "OPEN", { px: this.resetTimeoutMs });
      }
    } catch (err) {
      logger.error(`[CircuitBreaker] Failed to record failure metrics for ${this.serviceName}`, err);
    }
  }

  /**
   * Wrap an operation execution in the circuit breaker context
   */
  public async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.checkCall();

    try {
      const result = await operation();
      await this.recordSuccess();
      return result;
    } catch (err) {
      await this.recordFailure(err);
      throw err;
    }
  }
}
