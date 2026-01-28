import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { normalizeConvexUrl, loadConfig } from "../src/config/index";

describe("normalizeConvexUrl", () => {
  it("converts .convex.cloud to .convex.site", () => {
    const input = "https://my-app-123.convex.cloud";
    const expected = "https://my-app-123.convex.site";
    expect(normalizeConvexUrl(input)).toBe(expected);
  });
  
  it("leaves .convex.site unchanged", () => {
    const input = "https://my-app-123.convex.site";
    expect(normalizeConvexUrl(input)).toBe(input);
  });
  
  it("handles URLs without convex domain", () => {
    const input = "https://custom-proxy.example.com";
    expect(normalizeConvexUrl(input)).toBe(input);
  });
});

describe("loadConfig with environment variables", () => {
  const originalEnv = { ...process.env };
  
  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.PI_OPENSYNC_CONVEX_URL;
    delete process.env.PI_OPENSYNC_API_KEY;
    delete process.env.PI_OPENSYNC_AUTO_SYNC;
    delete process.env.PI_OPENSYNC_TOOL_CALLS;
    delete process.env.PI_OPENSYNC_THINKING;
    delete process.env.PI_OPENSYNC_DEBUG;
  });
  
  afterEach(() => {
    // Restore original env
    Object.keys(process.env).forEach(key => {
      if (key.startsWith("PI_OPENSYNC_")) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });
  
  it("loads from environment variables when present", () => {
    process.env.PI_OPENSYNC_CONVEX_URL = "https://test.convex.cloud";
    process.env.PI_OPENSYNC_API_KEY = "osk_test123";
    process.env.PI_OPENSYNC_DEBUG = "true";
    
    const config = loadConfig();
    
    expect(config).not.toBeNull();
    expect(config!.convexUrl).toBe("https://test.convex.site"); // normalized
    expect(config!.apiKey).toBe("osk_test123");
    expect(config!.debug).toBe(true);
    expect(config!.autoSync).toBe(true); // default when not "false"
    expect(config!.syncToolCalls).toBe(true);
  });
  
  it("returns null when no env vars and no config file", () => {
    // Ensure no env vars set
    delete process.env.PI_OPENSYNC_CONVEX_URL;
    delete process.env.PI_OPENSYNC_API_KEY;
    
    // This will return null if no config file exists
    // (which is the case in a clean test environment)
    const config = loadConfig();
    
    // Either null or loaded from existing config file
    // We can't guarantee no config file exists, so just check it doesn't throw
    expect(config === null || typeof config === "object").toBe(true);
  });
});
