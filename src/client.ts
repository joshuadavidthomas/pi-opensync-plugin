import type { SessionPayload, MessagePayload, SyncResult } from "./types";
import { debugLog } from "./debug";

export interface ClientConfig {
  convexUrl: string;
  apiKey: string;
  debug?: boolean;
}

export class SyncClient {
  private siteUrl: string;
  private apiKey: string;
  private debug: boolean;

  constructor(config: ClientConfig) {
    this.siteUrl = config.convexUrl;
    this.apiKey = config.apiKey;
    this.debug = config.debug ?? false;
  }

  private log(entry: Record<string, unknown>): void {
    if (this.debug) {
      debugLog(entry);
    }
  }

  private async request<T>(endpoint: string, data: unknown): Promise<SyncResult & { data?: T }> {
    const url = `${this.siteUrl}${endpoint}`;

    this.log({
      type: "request",
      endpoint,
      payload: data,
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const text = await response.text();
        this.log({
          type: "error",
          endpoint,
          status: response.status,
          error: text,
        });
        return { success: false, error: `${response.status}: ${text}` };
      }

      const result = await response.json() as T;
      this.log({
        type: "success",
        endpoint,
        response: result,
      });
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log({
        type: "exception",
        endpoint,
        error: message,
      });
      return { success: false, error: message };
    }
  }

  /**
   * Sync a session to OpenSync
   */
  async syncSession(session: SessionPayload): Promise<SyncResult> {
    return this.request("/sync/session", session);
  }

  /**
   * Sync a message to OpenSync
   */
  async syncMessage(message: MessagePayload): Promise<SyncResult> {
    return this.request("/sync/message", message);
  }

  /**
   * Batch sync sessions and messages
   */
  async syncBatch(sessions: SessionPayload[], messages: MessagePayload[]): Promise<SyncResult> {
    return this.request("/sync/batch", { sessions, messages });
  }

  /**
   * Test connection to OpenSync
   */
  async testConnection(): Promise<SyncResult> {
    try {
      const response = await fetch(`${this.siteUrl}/health`);
      if (response.ok) {
        return { success: true };
      }
      return { success: false, error: `Health check failed: ${response.status}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
}
