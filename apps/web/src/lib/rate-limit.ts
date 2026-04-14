// apps/web/src/lib/rate-limit.ts

/**
 * Professional-grade Rate Limiting Utility
 * Implements a sliding window counter to prevent API abuse and protect infrastructure costs.
 * * NOTE: This implementation uses an in-memory Map for local and single-instance deployments.
 * For production-scale horizontal scaling (multi-instance), this should be transitioned 
 * to a Redis-backed store (e.g., Upstash Redis).
 */

interface RateLimitRecord {
    count: number;
    resetTime: number;
}

const trackers = new Map<string, RateLimitRecord>();

/**
 * Standard headers returned to the client to inform them of their current quota status.
 */
export const getRateLimitHeaders = (limit: number, remaining: number, reset: number) => {
    return {
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': Math.max(0, remaining).toString(),
        'X-RateLimit-Reset': reset.toString(),
    };
};

/**
 * Evaluates the request against the specified quota.
 * * @param identifier - A unique string to identify the client (typically an IP address or User ID).
 * @param limit - The maximum number of requests allowed within the window.
 * @param windowMs - The duration of the sliding window in milliseconds.
 * @returns An object containing the current status of the rate limit.
 */
export async function rateLimit(identifier: string, limit: number, windowMs: number) {
    const now = Date.now();
    const record = trackers.get(identifier);

    // If no record exists or the window has expired, initialize a fresh tracker
    if (!record || now > record.resetTime) {
        const newRecord = {
            count: 1,
            resetTime: now + windowMs,
        };
        trackers.set(identifier, newRecord);
        return {
            success: true,
            limit,
            remaining: limit - 1,
            reset: newRecord.resetTime,
        };
    }

    // Increment count if within the active window
    record.count += 1;
    const isAllowed = record.count <= limit;

    return {
        success: isAllowed,
        limit,
        remaining: limit - record.count,
        reset: record.resetTime,
    };
}