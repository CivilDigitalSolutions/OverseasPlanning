<?php

namespace App\Services;

use App\Support\Clean;
use Illuminate\Support\Facades\DB;

/**
 * Who is part of a trip — the ONLY writer of `trip_members` and `trip_pending_emails`. Port of
 * functions/src/lib/membership.ts (computeAccess + recomputeTripAccess):
 *   the requester, everyone named in a role, everyone booked on a flight, and everyone given
 *   additional access. Emails without a confirmed account wait as pending until that person
 *   confirms their address. Recomputed after every change, so someone taken off a role or flight
 *   loses access unless they are still on the trip some other way.
 */
final class Membership
{
    /**
     * Pure calculation (unit-tested).
     * @param array{uid: string, name: string, email: string}|null $requester
     * @param array<string, array{name?: string, email?: string, uid?: ?string}> $roles
     * @param list<array{flight: string, name: string, uid: string, email?: string}> $passengers
     * @param list<array{uid: string, name: string, email: string}> $extraUids
     * @param list<string> $extraEmails
     * @return array{members: array<string, array{name: string, email: string, reasons: list<string>}>, pending: list<string>}
     */
    public static function compute(?array $requester, array $roles, array $passengers, array $extraUids, array $extraEmails): array
    {
        $members = [];
        $add = function (?string $uid, string $name, string $email, string $reason) use (&$members) {
            if (!$uid) {
                return;
            }
            $m = $members[$uid] ?? ['name' => '', 'email' => '', 'reasons' => []];
            if ($m['name'] === '' && $name !== '') {
                $m['name'] = $name;
            }
            if ($m['email'] === '' && $email !== '') {
                $m['email'] = $email;
            }
            if (!in_array($reason, $m['reasons'], true)) {
                $m['reasons'][] = $reason;
            }
            $members[$uid] = $m;
        };
        $pending = [];
        if ($requester) {
            $add($requester['uid'], $requester['name'], $requester['email'], 'Requester');
        }
        foreach ($roles as $key => $r) {
            if (!empty($r['uid'])) {
                $add($r['uid'], $r['name'] ?? '', $r['email'] ?? '', Clean::ROLE_LABELS[$key] ?? $key);
            } elseif (!empty($r['email'])) {
                $pending[strtolower($r['email'])] = true;
            }
        }
        foreach ($passengers as $p) {
            $add($p['uid'], $p['name'], $p['email'] ?? '', trim("On flight {$p['flight']}"));
        }
        foreach ($extraUids as $x) {
            $add($x['uid'], $x['name'], $x['email'], 'Additional access');
        }
        foreach ($extraEmails as $e) {
            $pending[strtolower($e)] = true;
        }
        ksort($members);
        $pending = array_keys($pending);
        sort($pending);
        return ['members' => $members, 'pending' => $pending];
    }

    public static function flightLabel(array $v): string
    {
        $label = trim(implode(' ', array_filter([$v['airline'] ?? '', $v['flightNumber'] ?? ''])));
        return $label !== '' ? $label : 'flight';
    }

    /**
     * Recompute and store a trip's membership, then tell newly added people.
     * @param list<string> $skipNotify people the caller notifies itself (e.g. "booked on a flight")
     * @return array{members: array<string, mixed>, pending: list<string>, added: list<string>}|null
     */
    public static function recompute(string $tripId, ?string $actor = null, array $skipNotify = []): ?array
    {
        $result = DB::transaction(function () use ($tripId) {
            $t = DB::table('trips')->where('id', $tripId)->lockForUpdate()->first();
            if (!$t) {
                return null;
            }
            $roles = json_decode($t->roles, true) ?: [];
            $known = DB::table('trip_members')->where('trip_id', $tripId)->get()->keyBy('user_id');
            $users = fn (array $ids) => DB::table('users')->whereIn('id', $ids)->get(['id', 'name', 'email'])->keyBy('id');

            $requester = null;
            if ($t->requester_id) {
                $r = $t->request_id ? DB::table('trip_requests')->where('id', $t->request_id)->first() : null;
                $u = $users([$t->requester_id])->get($t->requester_id);
                if ($u) {
                    $requester = ['uid' => $u->id, 'name' => $r->requester_name ?? $u->name, 'email' => $r->requester_email ?? $u->email];
                }
            }

            // Only accounts that still exist can be members (deleted accounts drop out).
            $passengers = [];
            foreach (DB::table('trip_items')->where('trip_id', $tripId)->where('kind', 'flights')->get() as $f) {
                $v = json_decode($f->values, true) ?: [];
                foreach ($v['passengers'] ?? [] as $p) {
                    if (!empty($p['uid'])) {
                        $passengers[] = ['flight' => self::flightLabel($v), 'name' => (string) ($p['name'] ?? ''), 'uid' => $p['uid'], 'email' => (string) ($p['email'] ?? '')];
                    }
                }
            }
            $extraUidList = json_decode($t->extra_access_uids, true) ?: [];
            $extraEmails = json_decode($t->extra_access_emails, true) ?: [];
            $candidateIds = array_values(array_unique(array_filter(array_merge(
                array_map(fn ($r) => $r['uid'] ?? null, $roles),
                array_column($passengers, 'uid'),
                $extraUidList,
            ))));
            // Only confirmed, enabled accounts gain access through a role, flight or invitation.
            $existing = DB::table('users')->whereIn('id', $candidateIds)->whereNotNull('email_verified_at')->whereNull('disabled_at')
                ->get(['id', 'name', 'email'])->keyBy('id');
            $roles = array_map(fn ($r) => !empty($r['uid']) && !$existing->has($r['uid']) ? [...$r, 'uid' => null] : $r, $roles);
            $passengers = array_values(array_filter($passengers, fn ($p) => $existing->has($p['uid'])));
            $extra = [];
            foreach ($extraUidList as $uid) {
                if ($u = $existing->get($uid)) {
                    $extra[] = ['uid' => $uid, 'name' => $known->get($uid)->name ?? $u->name, 'email' => $u->email];
                }
            }

            $res = self::compute($requester, $roles, $passengers, $extra, $extraEmails);
            $before = $known->keys()->all();

            DB::table('trip_members')->where('trip_id', $tripId)->whereNotIn('user_id', array_keys($res['members']) ?: [''])->delete();
            foreach ($res['members'] as $uid => $m) {
                DB::table('trip_members')->upsert(
                    [['trip_id' => $tripId, 'user_id' => $uid, 'name' => mb_substr($m['name'], 0, 80), 'email' => mb_substr($m['email'], 0, 254), 'reasons' => json_encode($m['reasons'])]],
                    ['trip_id', 'user_id'],
                    ['name', 'email', 'reasons'],
                );
            }
            DB::table('trip_pending_emails')->where('trip_id', $tripId)->delete();
            if ($res['pending']) {
                DB::table('trip_pending_emails')->insert(array_map(fn ($e) => ['trip_id' => $tripId, 'email' => $e], $res['pending']));
            }
            return [...$res, 'added' => array_values(array_diff(array_keys($res['members']), $before)), 'trip' => $t];
        });
        if (!$result) {
            return null;
        }
        $tell = Notifier::recipients(array_diff($result['added'], $skipNotify), $actor);
        if ($tell) {
            $t = $result['trip'];
            Notifier::send($tell, 'trip_added', 'Added to a trip', "You've been added to " . ($t->name ?: $t->team_name) . " ({$t->location}).", $tripId, "/trips/{$tripId}");
        }
        unset($result['trip']);
        return $result;
    }

    /** After someone confirms their email, every trip waiting for that address becomes theirs. */
    public static function claimPending(string $uid, string $email): int
    {
        $email = strtolower($email);
        $tripIds = DB::table('trip_pending_emails')->where('email', $email)->limit(100)->pluck('trip_id');
        foreach ($tripIds as $tripId) {
            DB::transaction(function () use ($tripId, $uid, $email) {
                $t = DB::table('trips')->where('id', $tripId)->lockForUpdate()->first();
                $roles = json_decode($t->roles, true) ?: [];
                foreach ($roles as $k => $r) {
                    if (strtolower($r['email'] ?? '') === $email) {
                        $roles[$k]['uid'] = $uid;
                    }
                }
                $extraEmails = json_decode($t->extra_access_emails, true) ?: [];
                $extraUids = json_decode($t->extra_access_uids, true) ?: [];
                if (in_array($email, $extraEmails, true)) {
                    $extraEmails = array_values(array_diff($extraEmails, [$email]));
                    $extraUids = array_values(array_unique([...$extraUids, $uid]));
                }
                DB::table('trips')->where('id', $tripId)->update([
                    'roles' => json_encode($roles, JSON_FORCE_OBJECT), 'extra_access_emails' => json_encode($extraEmails), 'extra_access_uids' => json_encode($extraUids),
                ]);
            });
            self::recompute($tripId);
        }
        return count($tripIds);
    }
}
