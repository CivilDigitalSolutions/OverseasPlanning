<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Terms + privacy agreement, recorded for EVERY sign-in (spec §2). Append-only table; the versions
 * are the server's own (config/voyager.php), never taken from the client.
 */
final class Agreements
{
    public static function record(User $u, string $method, Request $request): void
    {
        $terms = (string) config('voyager.terms_version');
        $privacy = (string) config('voyager.privacy_version');
        DB::table('agreements')->insert([
            'id' => (string) Str::ulid(), 'user_id' => $u->id, 'email' => $u->email, 'terms_version' => $terms, 'privacy_version' => $privacy,
            'method' => $method, 'ip' => (string) $request->ip(), 'user_agent' => mb_substr((string) $request->userAgent(), 0, 400), 'accepted_at' => now(),
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'last_agreement_at' => now(), 'terms_version' => $terms, 'privacy_version' => $privacy, 'last_login_at' => now(),
        ]);
    }
}
