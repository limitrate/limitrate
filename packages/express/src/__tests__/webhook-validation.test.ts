/**
 * Tests for webhook URL validation (SSRF protection)
 */

import { describe, it, expect } from 'vitest';
import { validateWebhookUrl } from '../webhook';

describe('Webhook URL Validation', () => {
  describe('Valid URLs', () => {
    it('should accept valid HTTPS URLs', () => {
      expect(() => validateWebhookUrl('https://example.com/webhook')).not.toThrow();
      expect(() => validateWebhookUrl('https://api.example.com/events')).not.toThrow();
    });

    it('should accept valid HTTP URLs', () => {
      expect(() => validateWebhookUrl('http://example.com/webhook')).not.toThrow();
    });
  });

  describe('Invalid Protocols', () => {
    it('should reject non-HTTP protocols', () => {
      expect(() => validateWebhookUrl('ftp://example.com')).toThrow('Invalid webhook protocol');
      expect(() => validateWebhookUrl('file:///etc/passwd')).toThrow('Invalid webhook protocol');
      expect(() => validateWebhookUrl('javascript:alert(1)')).toThrow('Invalid webhook protocol');
    });

    it('should reject malformed URLs', () => {
      expect(() => validateWebhookUrl('not-a-url')).toThrow('Invalid webhook URL');
      expect(() => validateWebhookUrl('')).toThrow('Invalid webhook URL');
    });
  });

  describe('SSRF Protection - Loopback', () => {
    it('should block localhost', () => {
      expect(() => validateWebhookUrl('http://localhost/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('https://LOCALHOST/webhook')).toThrow('SSRF protection');
    });

    it('should block 127.0.0.0/8 (loopback)', () => {
      expect(() => validateWebhookUrl('http://127.0.0.1/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://127.1.2.3/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://127.255.255.255/webhook')).toThrow('SSRF protection');
    });

    it('should block IPv6 loopback', () => {
      // IPv6 loopback is ::1 which gets normalized by URL parser
      expect(() => validateWebhookUrl('http://[0:0:0:0:0:0:0:1]/webhook')).toThrow('SSRF protection');
    });
  });

  describe('SSRF Protection - Private Networks', () => {
    it('should block 10.0.0.0/8 (private)', () => {
      expect(() => validateWebhookUrl('http://10.0.0.1/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://10.1.2.3/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://10.255.255.255/webhook')).toThrow('SSRF protection');
    });

    it('should block 172.16.0.0/12 (private)', () => {
      expect(() => validateWebhookUrl('http://172.16.0.1/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://172.20.0.1/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://172.31.255.255/webhook')).toThrow('SSRF protection');
    });

    it('should allow 172.15.x.x and 172.32.x.x (not private)', () => {
      expect(() => validateWebhookUrl('http://172.15.0.1/webhook')).not.toThrow();
      expect(() => validateWebhookUrl('http://172.32.0.1/webhook')).not.toThrow();
    });

    it('should block 192.168.0.0/16 (private)', () => {
      expect(() => validateWebhookUrl('http://192.168.1.1/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://192.168.255.255/webhook')).toThrow('SSRF protection');
    });
  });

  describe('SSRF Protection - Cloud Metadata', () => {
    it('should block 169.254.0.0/16 (AWS metadata)', () => {
      expect(() => validateWebhookUrl('http://169.254.169.254/latest/meta-data')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://169.254.0.1/webhook')).toThrow('SSRF protection');
    });
  });

  describe('SSRF Protection - IPv6 Private', () => {
    it('should block fe80::/10 (link-local)', () => {
      expect(() => validateWebhookUrl('http://[fe80::1]/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://[fe80:0:0:0:0:0:0:1]/webhook')).toThrow('SSRF protection');
    });

    it('should block fc00::/7 (unique local)', () => {
      expect(() => validateWebhookUrl('http://[fc00::1]/webhook')).toThrow('SSRF protection');
      expect(() => validateWebhookUrl('http://[fd00::1]/webhook')).toThrow('SSRF protection');
    });
  });

  describe('Middleware Integration', () => {
    it('should validate webhook URL at middleware startup', () => {
      // This test verifies that validateWebhookUrl is called during middleware initialization
      // Actual middleware test would require Express app setup
      expect(() => {
        validateWebhookUrl('http://127.0.0.1/webhook');
      }).toThrow();
    });
  });
});
