import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { PushDevicePlatform } from '@entity/PushDevice';

/** An Expo push token: `ExponentPushToken[...]` (or the newer `ExpoPushToken[...]`). */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[\w-]{8,200}\]$/u;

/** A person keeps at most this many devices; registering one more drops the one seen longest ago. */
export const MAX_PUSH_DEVICES_PER_USER = 10;

export interface LivePushDevice {
  pushDeviceKey: number;
  token: string;
}

export interface PushDeviceRegistration {
  appVersion?: null | string;
  platform: PushDevicePlatform;
  token: string;
}

export class PushDeviceService {
  private get em(): EntityManager {
    return this.injectedEm ?? DI.em;
  }

  constructor(private readonly injectedEm?: EntityManager) {}

  /** Stops sending to these devices until the app registers their tokens again. */
  async disable(pushDeviceKeys: readonly number[], now = new Date()): Promise<void> {
    if (pushDeviceKeys.length === 0) return;
    await this.em.getConnection().execute(
      'update "push_device" set "disabled_at" = ?, "updated_at" = ? where "push_device_key" in (?) and "disabled_at" is null',
      [now, now, [...pushDeviceKeys]],
    );
  }

  /**
   * The devices a notification for this person goes to: registered, not disabled, and still signed
   * in. A device whose session has ended (signed out, revoked, expired) is removed here, so a phone
   * that signed out without reaching the server stops receiving at the next send.
   */
  async liveDevices(appuserKey: number, now = new Date()): Promise<LivePushDevice[]> {
    const rows = await this.em.getConnection().execute<{ live: boolean; pushDeviceKey: number; token: string }[]>(
      `select device."push_device_key" as "pushDeviceKey", device."token",
              (session."id" is not null and session."expiresAt" > ?) as "live"
       from "push_device" device
       left join better_auth."session" session on session."id" = device."session_id"
       where device."appuser_key" = ? and device."disabled_at" is null
       order by device."push_device_key"`,
      [now, appuserKey],
    );
    const ended = rows.filter((row) => !row.live).map((row) => row.pushDeviceKey);
    if (ended.length > 0) {
      await this.em.getConnection().execute('delete from "push_device" where "push_device_key" in (?)', [ended]);
    }
    return rows.filter((row) => row.live).map(({ pushDeviceKey, token }) => ({ pushDeviceKey, token }));
  }

  /**
   * Registers (or refreshes) this phone's token for `appuserKey` and the session it signed in with.
   * A token is one install, so a token another person registered moves to whoever registers it now:
   * the phone shows the notifications of the person signed in on it.
   */
  async register(appuserKey: number, sessionId: string, device: PushDeviceRegistration, now = new Date()): Promise<void> {
    await this.em.getConnection().execute(
      `insert into "push_device" ("appuser_key", "token", "platform", "app_version", "session_id", "last_seen_at", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict ("token") do update set "appuser_key" = excluded."appuser_key", "platform" = excluded."platform",
         "app_version" = excluded."app_version", "session_id" = excluded."session_id", "last_seen_at" = excluded."last_seen_at",
         "disabled_at" = null, "deleted_at" = null, "updated_at" = excluded."updated_at"`,
      [appuserKey, device.token, device.platform, device.appVersion ?? null, sessionId, now, now, now],
    );
    await this.em.getConnection().execute(
      `delete from "push_device" where "appuser_key" = ? and "push_device_key" not in (
         select "push_device_key" from "push_device" where "appuser_key" = ? order by "last_seen_at" desc, "push_device_key" desc limit ?
       )`,
      [appuserKey, appuserKey, MAX_PUSH_DEVICES_PER_USER],
    );
  }

  /** Removes this person's device with this token; another person's device with it is left alone. */
  async unregister(appuserKey: number, token: string): Promise<void> {
    await this.em.getConnection().execute('delete from "push_device" where "appuser_key" = ? and "token" = ?', [appuserKey, token]);
  }
}

export const pushDeviceService = new PushDeviceService();
