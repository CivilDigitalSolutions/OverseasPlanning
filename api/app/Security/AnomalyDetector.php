<?php

namespace App\Security;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * In-app runtime self-protection (SECURITY-PLAN §5, layer 2). Per user, per 10-minute window, it
 * counts DISTINCT refused resources and DISTINCT trips opened. Distinct, so a screen still polling
 * a trip the person was just removed from cannot look like an attack (plan review item 5).
 *
 * Over a threshold it records a security event; in `protect` mode it also disables the account
 * and ends all of its sessions until an administrator re-enables it.
 */
class AnomalyDetector
{
    private const WINDOW = 600;

    public function denied(User $u, string $resource): void
    {
        $n = $this->distinct("deny:{$u->id}", $resource);
        if ($n === (int) config('security.rasp.max_denials')) {
            $this->trip($u, 'access_denials_threshold', ['distinct_refused' => $n]);
        }
    }

    public function openedTrip(User $u, string $tripId): void
    {
        $limit = (int) config($u->is_host || $u->is_controller ? 'security.rasp.max_trips_privileged' : 'security.rasp.max_trips');
        $n = $this->distinct("trips:{$u->id}", $tripId);
        if ($n === $limit) {
            $this->trip($u, 'trip_read_threshold', ['distinct_trips' => $n]);
        }
    }

    /** Add $item to a per-window set and return its size. */
    private function distinct(string $key, string $item): int
    {
        $bucket = 'rasp:' . $key . ':' . intdiv(time(), self::WINDOW);
        $set = Cache::get($bucket, []);
        if (!in_array($item, $set, true)) {
            $set[] = $item;
            Cache::put($bucket, $set, self::WINDOW * 2);
        }
        return count($set);
    }

    private function trip(User $u, string $type, array $detail): void
    {
        $protect = config('security.rasp.mode') === 'protect';
        if ($protect) {
            DB::table('users')->where('id', $u->id)->update(['disabled_at' => now()]);
            DB::table('sessions')->where('user_id', $u->id)->delete();
        }
        SecurityEvents::record($type, $u->id, $detail, $protect ? 'account_disabled' : 'alert_only', $u->email);
    }
}
