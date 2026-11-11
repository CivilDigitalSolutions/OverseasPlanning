<?php

namespace App\Services;

use App\Jobs\SendWebPush;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Notifications (owner decision 2026-11-10): added to a trip, booked on a flight, new message.
 * 1. In-app inbox (`app_notifications`) with the full text — always.
 * 2. Web push to every device the person switched on. The push carries a GENERIC title only
 *    (MIGRATION-PLAN §7 item 4): it passes through Google/Apple/Mozilla push servers, so no trip,
 *    person or message text goes in it.
 */
final class Notifier
{
    private const PUSH_TEXT = [
        'trip_added' => 'Added to a trip',
        'flight_added' => 'Booked on a flight',
        'message' => 'New message',
    ];

    /** Who to tell: the given people minus whoever caused it, without duplicates. */
    public static function recipients(iterable $uids, ?string $actor): array
    {
        $out = [];
        foreach ($uids as $u) {
            if ($u && $u !== $actor) {
                $out[$u] = true;
            }
        }
        return array_keys($out);
    }

    public static function send(array $uids, string $type, string $title, string $body, string $tripId, string $link): void
    {
        if (!$uids) {
            return;
        }
        $rows = array_map(fn ($uid) => [
            'id' => (string) Str::ulid(), 'user_id' => $uid, 'type' => $type, 'title' => mb_substr($title, 0, 200),
            'body' => mb_substr($body, 0, 400), 'trip_id' => $tripId, 'link' => $link, 'read' => false, 'created_at' => now(),
        ], $uids);
        DB::table('app_notifications')->insert($rows);
        SendWebPush::dispatch($uids, self::PUSH_TEXT[$type] ?? 'Voyager Trip Manager', $link, $type);
    }
}
