<?php

namespace App\Security;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Records a security event (append-only table) AND writes it to the `security` log channel, which
 * production ships to CloudWatch/the SIEM for alerting (SECURITY-PLAN §5).
 */
final class SecurityEvents
{
    public static function record(string $type, ?string $userId = null, array $detail = [], ?string $action = null, ?string $email = null): void
    {
        $ip = request()?->ip();
        try {
            DB::table('security_events')->insert([
                'id' => (string) Str::ulid(), 'user_id' => $userId, 'email' => $email ? mb_substr($email, 0, 254) : null, 'type' => $type,
                'detail' => json_encode($detail), 'ip' => $ip, 'action_taken' => $action, 'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            // Never let event recording break the request; the log line below still goes out.
            Log::channel('security')->error('security event not stored', ['error' => $e->getMessage()]);
        }
        Log::channel('security')->warning($type, ['user_id' => $userId, 'ip' => $ip, 'action' => $action, 'detail' => $detail, 'request_id' => request()?->attributes->get('request_id')]);
    }
}
