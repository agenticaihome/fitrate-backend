/**
 * SECURITY MONITORING & LOGGING SERVICE
 *
 * Comprehensive security event tracking and alerting system
 * Monitors all Security Fortress verifications and suspicious activities
 *
 * Created: December 19, 2025
 */

import { redis, isRedisAvailable } from './redisClient.js';

/**
 * Security Event Types
 */
export const SecurityEventType = {
  // Verification Events
  AUTH_FAILURE: 'auth_failure',
  SCAN_LIMIT_EXCEEDED: 'scan_limit_exceeded',
  ABUSE_DETECTED: 'abuse_detected',
  BOT_DETECTED: 'bot_detected',
  TIER_VIOLATION: 'tier_violation',

  // Success Events
  FORTRESS_PASSED: 'fortress_passed',
  AI_ANALYSIS_SUCCESS: 'ai_analysis_success',

  // Suspicious Activities
  MULTI_ACCOUNT_ATTEMPT: 'multi_account_attempt',
  RAPID_REQUESTS: 'rapid_requests',
  INVALID_IMAGE_SPAM: 'invalid_image_spam',
  REFERRAL_FRAUD: 'referral_fraud',

  // Critical Security Events
  FINGERPRINT_SPOOFING: 'fingerprint_spoofing',
  API_KEY_VIOLATION: 'api_key_violation',
  PERMANENT_BAN: 'permanent_ban'
};

/**
 * Security Severity Levels
 */
export const SecuritySeverity = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
  EMERGENCY: 'emergency'
};

/**
 * Security Monitor Class
 */
class SecurityMonitor {
  constructor() {
    this.memoryLog = []; // In-memory fallback when Redis unavailable
    this.maxMemoryLogs = 1000;
    this.alertThresholds = {
      abuse_detected: 5, // Alert after 5 abuse detections in 1 hour
      bot_detected: 10,
      tier_violation: 20,
      fingerprint_spoofing: 3
    };
  }

  /**
   * Log a security event
   */
  async logEvent(eventType, severity, details = {}) {
    const event = {
      type: eventType,
      severity,
      timestamp: Date.now(),
      date: new Date().toISOString(),
      ...details
    };

    // Mask sensitive data
    if (event.userId) {
      event.userId = this.maskSensitiveData(event.userId);
    }
    if (event.email) {
      event.email = this.maskEmail(event.email);
    }
    if (event.fingerprint) {
      event.fingerprint = event.fingerprint.substring(0, 16) + '...';
    }

    // Console logging with severity colors
    this.logToConsole(event);

    // Store in Redis
    if (isRedisAvailable()) {
      await this.logToRedis(event);
    } else {
      this.logToMemory(event);
    }

    // Check if alert threshold reached
    await this.checkAlertThresholds(eventType, event);

    return event;
  }

  /**
   * Log to console with severity formatting
   */
  logToConsole(event) {
    const timestamp = new Date(event.timestamp).toISOString();
    const prefix = this.getSeverityPrefix(event.severity);

    const logData = {
      type: event.type,
      severity: event.severity,
      ...event
    };
    delete logData.timestamp;
    delete logData.date;

    switch (event.severity) {
      case SecuritySeverity.EMERGENCY:
      case SecuritySeverity.CRITICAL:
        console.error(`${prefix} [Security Monitor] ${timestamp}`, logData);
        break;
      case SecuritySeverity.WARNING:
        console.warn(`${prefix} [Security Monitor] ${timestamp}`, logData);
        break;
      default:
        console.log(`${prefix} [Security Monitor] ${timestamp}`, logData);
    }
  }

  /**
   * Get severity prefix emoji
   */
  getSeverityPrefix(severity) {
    switch (severity) {
      case SecuritySeverity.EMERGENCY:
        return '🚨';
      case SecuritySeverity.CRITICAL:
        return '❌';
      case SecuritySeverity.WARNING:
        return '⚠️';
      default:
        return 'ℹ️';
    }
  }

  /**
   * Log to Redis with time-series storage
   */
  async logToRedis(event) {
    try {
      const key = `fitrate:security:logs`;
      const eventStr = JSON.stringify(event);

      // Add to time-series list
      await redis.lpush(key, eventStr);

      // Keep last 10,000 events
      await redis.ltrim(key, 0, 9999);

      // Also store by event type for analytics
      const typeKey = `fitrate:security:type:${event.type}`;
      await redis.lpush(typeKey, eventStr);
      await redis.ltrim(typeKey, 0, 999);
      await redis.expire(typeKey, 7 * 24 * 60 * 60); // 7 days

      // Store hourly counts for threshold checking
      const hourKey = `fitrate:security:count:${event.type}:${this.getCurrentHour()}`;
      await redis.incr(hourKey);
      await redis.expire(hourKey, 2 * 60 * 60); // 2 hours

    } catch (error) {
      console.error('Failed to log to Redis:', error);
      this.logToMemory(event);
    }
  }

  /**
   * Log to in-memory fallback
   */
  logToMemory(event) {
    this.memoryLog.unshift(event);
    if (this.memoryLog.length > this.maxMemoryLogs) {
      this.memoryLog.pop();
    }
  }

  /**
   * Check if alert thresholds are exceeded
   */
  async checkAlertThresholds(eventType, event) {
    if (!this.alertThresholds[eventType]) return;

    const threshold = this.alertThresholds[eventType];
    const hourKey = `fitrate:security:count:${eventType}:${this.getCurrentHour()}`;

    let count;
    if (isRedisAvailable()) {
      count = await redis.get(hourKey);
      count = parseInt(count) || 0;
    } else {
      // Count from memory log
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      count = this.memoryLog.filter(
        e => e.type === eventType && e.timestamp > oneHourAgo
      ).length;
    }

    if (count >= threshold) {
      await this.triggerAlert(eventType, count, event);
    }
  }

  /**
   * Trigger security alert
   */
  async triggerAlert(eventType, count, event) {
    console.error(`🚨 [SECURITY ALERT] Event type "${eventType}" exceeded threshold: ${count} occurrences in the last hour`);
    console.error('Last event:', event);

    // In production, this would:
    // - Send email to admin
    // - Post to Slack/Discord webhook
    // - Trigger PagerDuty alert
    // - etc.

    // Store alert
    if (isRedisAvailable()) {
      const alertKey = 'fitrate:security:alerts';
      const alert = {
        eventType,
        count,
        timestamp: Date.now(),
        triggeredBy: event
      };
      await redis.lpush(alertKey, JSON.stringify(alert));
      await redis.ltrim(alertKey, 0, 99); // Keep last 100 alerts
    }
  }

  /**
   * Get current hour key for time-series grouping
   */
  getCurrentHour() {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}`;
  }

  /**
   * Mask sensitive user data
   */
  maskSensitiveData(data) {
    if (!data || data === 'anonymous') return data;
    if (data.length <= 8) return data.substring(0, 4) + '***';
    return data.substring(0, 8) + '...';
  }

  /**
   * Mask email addresses
   */
  maskEmail(email) {
    if (!email) return email;
    const [local, domain] = email.split('@');
    if (!domain) return email.substring(0, 4) + '***';
    return local.substring(0, 3) + '***@' + domain;
  }

  /**
   * Log Security Fortress verification
   */
  async logFortressVerification(verificationLog, passed, reason = null) {
    const event = {
      verificationSteps: verificationLog.length,
      passed,
      reason,
      steps: verificationLog.map(step => ({
        step: step.step,
        name: step.name,
        passed: step.passed
      }))
    };

    const eventType = passed ? SecurityEventType.FORTRESS_PASSED : SecurityEventType.AUTH_FAILURE;
    const severity = passed ? SecuritySeverity.INFO : SecuritySeverity.WARNING;

    await this.logEvent(eventType, severity, event);
  }

  /**
   * Log AI analysis result
   */
  async logAIAnalysis(userId, mode, aiModel, success, duration, error = null) {
    await this.logEvent(
      SecurityEventType.AI_ANALYSIS_SUCCESS,
      SecuritySeverity.INFO,
      {
        userId,
        mode,
        aiModel,
        success,
        durationMs: duration,
        error: error ? error.substring(0, 100) : null
      }
    );
  }

  /**
   * Log abuse detection
   */
  async logAbuseDetection(type, fingerprint, userId, details = {}) {
    await this.logEvent(
      SecurityEventType.ABUSE_DETECTED,
      SecuritySeverity.WARNING,
      {
        abuseType: type,
        fingerprint,
        userId,
        ...details
      }
    );
  }

  /**
   * Log bot detection
   */
  async logBotDetection(fingerprint, userAgent) {
    await this.logEvent(
      SecurityEventType.BOT_DETECTED,
      SecuritySeverity.WARNING,
      {
        fingerprint,
        userAgent: userAgent ? userAgent.substring(0, 100) : 'unknown'
      }
    );
  }

  /**
   * Log tier violation
   */
  async logTierViolation(userId, requestedMode, userTier) {
    await this.logEvent(
      SecurityEventType.TIER_VIOLATION,
      SecuritySeverity.WARNING,
      {
        userId,
        requestedMode,
        userTier
      }
    );
  }

  /**
   * Get security statistics
   */
  async getSecurityStats(hours = 24) {
    const stats = {
      totalEvents: 0,
      eventsByType: {},
      eventsBySeverity: {},
      recentAlerts: []
    };

    if (isRedisAvailable()) {
      // Get total events
      const logs = await redis.lrange('fitrate:security:logs', 0, -1);
      stats.totalEvents = logs.length;

      // Parse and categorize
      logs.forEach(logStr => {
        try {
          const event = JSON.parse(logStr);

          // Count by type
          stats.eventsByType[event.type] = (stats.eventsByType[event.type] || 0) + 1;

          // Count by severity
          stats.eventsBySeverity[event.severity] = (stats.eventsBySeverity[event.severity] || 0) + 1;
        } catch (e) {
          // Skip malformed entries
        }
      });

      // Get recent alerts
      const alerts = await redis.lrange('fitrate:security:alerts', 0, 9);
      stats.recentAlerts = alerts.map(a => JSON.parse(a));
    } else {
      // Use memory log
      stats.totalEvents = this.memoryLog.length;

      this.memoryLog.forEach(event => {
        stats.eventsByType[event.type] = (stats.eventsByType[event.type] || 0) + 1;
        stats.eventsBySeverity[event.severity] = (stats.eventsBySeverity[event.severity] || 0) + 1;
      });
    }

    return stats;
  }

  /**
   * Clear old logs (maintenance task)
   */
  async clearOldLogs(daysToKeep = 30) {
    if (!isRedisAvailable()) return;

    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

    try {
      const logs = await redis.lrange('fitrate:security:logs', 0, -1);
      const validLogs = logs.filter(logStr => {
        try {
          const event = JSON.parse(logStr);
          return event.timestamp > cutoffTime;
        } catch {
          return false;
        }
      });

      // Replace with filtered logs
      await redis.del('fitrate:security:logs');
      if (validLogs.length > 0) {
        await redis.rpush('fitrate:security:logs', ...validLogs);
      }

      console.log(`🧹 Security Monitor: Cleaned logs, kept ${validLogs.length}/${logs.length} events`);
    } catch (error) {
      console.error('Failed to clean old logs:', error);
    }
  }
}

// Singleton instance
const securityMonitor = new SecurityMonitor();

// Export singleton and class
export { securityMonitor, SecurityMonitor };
export default securityMonitor;
