<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

abstract class Controller
{
    protected function me(Request $request): User
    {
        /** @var User $u */
        $u = $request->user();
        return $u;
    }

    /** A plain error the PWA shows as-is (no internals). */
    protected function fail(int $status, string $message): JsonResponse
    {
        return response()->json(['message' => $message], $status);
    }

    /** Milliseconds since epoch for a DB timestamp (0 when empty), the shape the PWA uses. */
    protected static function ms(mixed $t): int
    {
        if ($t === null || $t === '') {
            return 0;
        }
        return (int) round(\Illuminate\Support\Carbon::parse($t)->getPreciseTimestamp(3));
    }

    /** Short display name for stamps ("created by …"). */
    protected static function nameOf(User $u): string
    {
        return mb_substr($u->name !== '' ? $u->name : $u->email, 0, 80);
    }
}
