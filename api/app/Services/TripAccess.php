<?php

namespace App\Services;

use App\Models\User;
use App\Security\AnomalyDetector;
use App\Support\Clean;
use Illuminate\Support\Facades\DB;

/**
 * THE place that decides who may see or change a trip (port of the helpers at the top of
 * firestore.rules). Controllers call `need*()`, which returns the trip row or ends the request.
 *
 * Access comes only from `trip_members` (written by Membership) or the HOST profile; controllers
 * see LIVE trips' basic details and messages. A trip the caller may not see answers 404, not 403,
 * so ids cannot be probed for existence (SECURITY-PLAN T6); every refusal is reported to the
 * anomaly detector.
 */
final class TripAccess
{
    public static function find(string $tripId): ?object
    {
        if (!Clean::isId($tripId)) {
            return null;
        }
        $t = DB::table('trips')->where('id', $tripId)->first();
        if ($t) {
            $t->roles = json_decode($t->roles, true) ?: [];
        }
        return $t;
    }

    public static function isMember(User $u, string $tripId): bool
    {
        return DB::table('trip_members')->where('trip_id', $tripId)->where('user_id', $u->id)->exists();
    }

    public static function canView(User $u, object $trip): bool
    {
        return $u->is_host || self::isMember($u, $trip->id);
    }

    public static function controllerSees(User $u, object $trip): bool
    {
        return $u->is_controller && Clean::isLive($trip->status, $trip->start_date);
    }

    /** HOST or this trip's Team Leader: moves status, reads every vaccination declaration. */
    public static function isLead(User $u, object $trip): bool
    {
        return $u->is_host || (($trip->roles['teamLeader']['uid'] ?? null) === $u->id);
    }

    /** The trip's named SPC, or anyone with the SPC profile who can see the trip — never HOST as such. */
    public static function isSpc(User $u, object $trip): bool
    {
        return (($trip->roles['spc']['uid'] ?? null) === $u->id) || ($u->is_spc && self::canView($u, $trip));
    }

    /** Trip the caller is on (or HOST). */
    public static function needView(User $u, string $tripId): object
    {
        $t = self::find($tripId);
        if (!$t || !self::canView($u, $t)) {
            self::deny($u, "trip:{$tripId}");
        }
        return $t;
    }

    /** Trip whose basic details and messages the caller may use: on the trip, HOST, or controller while live. */
    public static function needMessages(User $u, string $tripId): object
    {
        $t = self::find($tripId);
        if (!$t || !(self::canView($u, $t) || self::controllerSees($u, $t))) {
            self::deny($u, "messages:{$tripId}");
        }
        return $t;
    }

    public static function needLead(User $u, object $trip): void
    {
        if (!self::isLead($u, $trip)) {
            self::deny($u, "lead:{$trip->id}", 403);
        }
    }

    public static function needSpc(User $u, object $trip): void
    {
        if (!self::isSpc($u, $trip)) {
            self::deny($u, "spc:{$trip->id}", 403);
        }
    }

    public static function needHost(User $u): void
    {
        if (!$u->is_host) {
            self::deny($u, 'host', 403);
        }
    }

    public static function needAdmin(User $u): void
    {
        if (!$u->is_admin) {
            self::deny($u, 'admin', 403);
        }
    }

    /** @return never */
    public static function deny(User $u, string $resource, int $status = 404): never
    {
        app(AnomalyDetector::class)->denied($u, $resource);
        abort($status, $status === 404 ? 'Not found.' : "You can't do that.");
    }
}
