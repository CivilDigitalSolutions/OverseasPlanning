<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * SPC outstanding work (owner decision 2026-11-12): what waits for an SPC on a trip, who its SPCs
 * are (the named SPC plus SPC-profile holders on the trip), and telling them. Port of
 * functions/src/spcQueue.ts.
 */
final class SpcQueue
{
    /** @return array{requests: int, flights: int} */
    public static function counts(string $tripId): array
    {
        return [
            'requests' => DB::table('tl_requests')->where('trip_id', $tripId)->where('status', 'pending')->count(),
            'flights' => DB::table('trip_items')->where('trip_id', $tripId)->where('kind', 'flights')->whereNull('spc_decision')->count(),
        ];
    }

    /** @return list<string> */
    public static function spcsOf(object $trip): array
    {
        $roles = is_array($trip->roles) ? $trip->roles : (json_decode($trip->roles, true) ?: []);
        $named = $roles['spc']['uid'] ?? null;
        $profiles = DB::table('trip_members')->join('users', 'users.id', '=', 'trip_members.user_id')
            ->where('trip_members.trip_id', $trip->id)->where('users.is_spc', true)->whereNull('users.disabled_at')
            ->pluck('users.id')->all();
        return array_values(array_unique(array_filter([$named, ...$profiles])));
    }

    public static function tell(object $trip, ?string $actor, string $body, string $tab): void
    {
        Notifier::send(
            Notifier::recipients(self::spcsOf($trip), $actor), 'spc_pending', 'Awaiting your approval',
            mb_substr($body, 0, 300) . ' — ' . ($trip->name ?: $trip->team_name), $trip->id, "/trips/{$trip->id}/{$tab}",
        );
    }

    public static function label(array $c): string
    {
        $part = fn (int $n, string $one) => $n ? "{$n} {$one}" . ($n === 1 ? '' : 's') : '';
        return implode(' · ', array_filter([$part($c['requests'], 'request'), $part($c['flights'], 'flight')]));
    }
}
