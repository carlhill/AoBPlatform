/**
 * WHERE A TABLET IS, IN ONE LINE — shared by `/practice/devices` and
 * `/practice/tablet` (Carl, 4–5 Sep 2026; TODO.md "Tablet heartbeat and
 * Return to Begin").
 *
 * ONE BUILDER, TWO PAGES, for the same reason `pushDesk.tsx` exists at all: a
 * second copy of "what is that tablet doing" is a second place for it to be
 * wrong, and the two pages would drift within a week. Both read the same
 * string-table branch (`strings.devices.activity`, REQ-LANG-01), so the line
 * can be reworded in one place.
 *
 * WHAT THE LINE MAY CONTAIN, AND WHAT IT MAY NOT. A screen NAME from the fixed
 * list the heartbeat carries, an opaque session tag, and a coarse age. NEVER a
 * patient: no name is looked up to decorate a device row, because reception
 * already has the name on the session row beside it and a second copy is a
 * second place a person's name sits on a monitor at the front counter
 * (REQ-VER-04, hard rule 9, and Carl's ruling of 5 Sep 2026 — "the session id
 * is enough; reception can match it to the tablet row").
 *
 * STALENESS IS THE SERVER'S ANSWER. `stale` arrives on the row, computed
 * against the cadence the server is currently handing out; this file never
 * decides how long is too long. The age it renders is only for reading — a
 * console that also guessed the threshold would be a second place for the
 * cadence to be wrong, in the direction that calls a live tablet dead.
 *
 * IT SAYS NOTHING ABOUT A TABLET WITH NOTHING TO SAY. A revoked device holds
 * no credential and an unpaired one has never called in; both already carry a
 * chip that states exactly that, and a "not seen" line under it would be a
 * second sentence saying the same thing more alarmingly.
 */

import type { DeviceRow } from '@aobplatform/domain';
import { strings } from '../strings';

/** The same eight characters the tablet's own footer shows. */
export function shortDeviceSessionId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

/**
 * "4 s", "3 min", "2 hours", "over a day" — deliberately coarse. Nobody
 * reading a device row needs a decimal, and a precise number invites a person
 * to watch it tick instead of getting on with the morning.
 */
export function deviceSeenAgo(lastSeenAt: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(lastSeenAt).getTime());
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return strings.devices.activity.agoSeconds(seconds);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return strings.devices.activity.agoMinutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return strings.devices.activity.agoHours(hours);
  return strings.devices.activity.agoDays;
}

/**
 * The line itself, or `null` where there is honestly nothing to say.
 *
 * THE ORDER OF THE BRANCHES IS THE MESSAGE. Stale first, because "this tablet
 * is not answering" outranks whatever it was doing when it stopped. Then a
 * pushed session, which reception can act on. Then a walk-up, which is the
 * case that was invisible before the heartbeat existed and is the reason the
 * whole feature was built. Then the ordinary between-patients line.
 */
export function deviceActivityLine(device: DeviceRow, now: number = Date.now()): string | null {
  if (device.state === 'revoked' || device.state === 'awaiting_pairing') return null;

  const activity = strings.devices.activity;
  if (!device.lastSeenAt) return activity.neverSeen;
  if (device.stale) return activity.notSeen(deviceSeenAgo(device.lastSeenAt, now));

  const screen = device.currentScreen ?? 'begin';
  const where = activity.screens[screen] ?? screen;

  if (device.currentSessionId) {
    return activity.inSession(where, shortDeviceSessionId(device.currentSessionId));
  }
  /*
   * A CEREMONY WITH NO SESSION IS A WALK-UP — somebody typed three details
   * into the tablet themselves, so there is no push and no session id, and
   * before the heartbeat this state was invisible from the console entirely
   * (recall reaches a pushed session; the session poll is off during a
   * walk-up). This line is what reception now sees instead of "Ready".
   */
  if (screen !== 'begin' && screen !== 'list') return activity.walkUp(where);

  return activity.seen(where, deviceSeenAgo(device.lastSeenAt, now));
}
